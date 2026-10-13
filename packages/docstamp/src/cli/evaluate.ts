import { basename, dirname, join } from 'node:path';
import { Raised, withWritten } from '../core/diagnostics.ts';
import type { Json, SelectedEntry } from '../core/types.ts';
import type { Host } from '../host/host.ts';
import { canonicalJson } from '../core/canonical.ts';
import { claim, runExtract, runValidateSelect, type Extracted } from '../plugin/plugins.ts';
import type { DocstampPlugin } from '../plugin/types.ts';
import { comparePaths } from '../core/order.ts';
import type { Declaration, Diagnostic, Lock, Result } from '../core/types.ts';
import { evaluate, orphans, type EngineFs } from '../engine/evaluate.ts';
import { fileHash, selectableText } from '../hash/hash.ts';
import type { FragmentProbe } from '../history/fragments.ts';
import { renamedTo } from '../history/renamed.ts';
import { readLock } from '../lock/lock.ts';
import { isIgnoredPath, type Universe } from '../universe/walk.ts';
import { loadWorkspace } from './workspace.ts';

// SPEC §9.4: exact-name match in the parent's listing, and a file, not a link
function isStampedFile(host: Host, root: string, path: string): boolean {
  const dir = dirname(join(root, path));
  try {
    const entry = host.fs
      .readDir(dir)
      .find((e) => e.name.toString('utf8').normalize('NFC') === basename(path));
    return entry?.kind === 'file';
  } catch {
    return false;
  }
}

export interface Evaluated {
  results: Result[];
  plugins: readonly DocstampPlugin[];
  script?: string;
  fragmentProbe: (entries: readonly SelectedEntry[]) => FragmentProbe;
  declarations: Declaration[];
  universe: Universe;
  presets: ReadonlyMap<string, readonly string[]>;
  defaultPresets: readonly string[];
  lock: Lock;
  global: Diagnostic[];
}

function memoizeBy<K, V>(key: (arg: K) => string, fn: (arg: K) => V): (arg: K) => V {
  const cache = new Map<string, V | Raised>();
  return (arg) => {
    const id = key(arg);
    let cached = cache.get(id);
    if (cached === undefined) {
      try {
        cached = fn(arg);
      } catch (e) {
        if (!(e instanceof Raised)) throw e;
        cached = e;
      }
      cache.set(id, cached);
    }
    if (cached instanceof Raised) throw cached;
    return cached;
  };
}

export function memoizeHash(hash: (path: string) => string): (path: string) => string {
  return memoizeBy((path: string) => path, hash);
}

// SPEC §12.2 step 5: ValidateSelect of §8.7 for each remaining Declaration's Selected Dependencies
function validatedSelects(
  declarations: readonly Declaration[],
  plugins: readonly DocstampPlugin[],
): Diagnostic[] {
  return declarations.flatMap((declaration) =>
    (declaration.selected ?? []).flatMap((entry) => {
      try {
        const found = runValidateSelect(claim(plugins, entry.path), declaration.file, entry);
        return withWritten(found, entry);
      } catch (e) {
        if (e instanceof Raised) return []; // an unclaimed path is Fragments step 0's to report
        throw e;
      }
    }),
  );
}

function evaluateDeclarations(
  host: Host,
  root: string,
  readLockFor: () => Lock,
  hashFiles: boolean,
) {
  const workspace = loadWorkspace(host, root);
  const { universe, declarations, presets, defaultPresets, plugins, script } = workspace;
  const raised = new Set(workspace.attached.map((d) => d.file));
  const remaining = declarations.filter((d) => !raised.has(d.file));
  const attached = [...workspace.attached, ...validatedSelects(remaining, plugins)];
  const extract = memoizeBy(
    ([path, select]: readonly [string, Json]) => `${path}\u0000${canonicalJson(select)}`,
    ([path, select]: readonly [string, Json]) =>
      runExtract(claim(plugins, path), {
        path,
        select,
        text: selectableText(host, root, universe, path),
      }),
  );
  // SPEC §12.3 step 11: Fragments of §8.7, with null where it would raise
  const fragmentOf = (found: () => Extracted): Extracted | null => {
    try {
      return found();
    } catch (e) {
      if (e instanceof Raised) return null;
      throw e;
    }
  };
  const fragmentProbe = (entries: readonly SelectedEntry[]): FragmentProbe => ({
    entries: [...entries].sort(
      (a, b) =>
        comparePaths(a.path, b.path) ||
        comparePaths(canonicalJson(a.select), canonicalJson(b.select)),
    ),
    now: (entry) => fragmentOf(() => extract([entry.path, entry.select])),
    earlier: (entry, text) =>
      fragmentOf(() =>
        runExtract(claim(plugins, entry.path), { path: entry.path, select: entry.select, text }),
      ),
  });
  const lock = readLockFor();
  const renames = new Map<string, string | null>();
  const fs: EngineFs = {
    isStampedFile: (p) => isStampedFile(host, root, p),
    isIgnoredPath: (p) => isIgnoredPath(host, root, universe, p),
    renamedTo: (p) => {
      if (!renames.has(p)) renames.set(p, renamedTo(host.git(root), universe, p));
      return renames.get(p)!;
    },
    fileHash: hashFiles ? memoizeHash((p) => fileHash(host, root, universe, p)) : () => '',
    // list mode never calls a plugin (§13.7)
    extractParts: hashFiles
      ? (path, select) => extract([path, select])
      : () => ({ parts: [{ content: '' }], warnings: [] }),
  };
  const results = declarations.map((b) =>
    evaluate(
      b,
      universe.paths,
      lock,
      attached.filter((d) => d.file === b.file),
      fs,
    ),
  );
  return {
    declarations,
    universe,
    presets,
    defaultPresets,
    results,
    lock,
    fragmentProbe,
    plugins,
    ...(script === undefined ? {} : { script }),
  };
}

// SPEC §12.2
export function evaluateAll(
  host: Host,
  root: string,
  policy: 'strict' | 'discard-invalid',
): Evaluated {
  const readLockFor = (): Lock => {
    try {
      return readLock(host, root);
    } catch (e) {
      if (!(e instanceof Raised) || policy === 'strict') throw e;
      return { entries: new Map() };
    }
  };
  const evaluated = evaluateDeclarations(host, root, readLockFor, true);
  return { ...evaluated, global: orphans(evaluated.declarations, evaluated.lock) };
}

// SPEC §13.7
export function listWorkspace(host: Host, root: string) {
  return evaluateDeclarations(host, root, () => ({ entries: new Map() }), false);
}

export function listAll(host: Host, root: string): Result[] {
  return listWorkspace(host, root).results;
}
