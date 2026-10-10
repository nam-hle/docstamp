import { basename, dirname, join, resolve } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import type { Json, SelectedEntry } from '../core/types.ts';
import type { Host } from '../host/host.ts';
import { canonicalJson } from '../plugin/canonical.ts';
import { claim, runExtract, type Extracted } from '../plugin/plugins.ts';
import { comparePaths, sortPaths } from '../core/order.ts';
import type { Declaration, Diagnostic, Lock, Result, ReverseEntry } from '../core/types.ts';
import { evaluate, orphans, type EngineFs } from '../engine/evaluate.ts';
import { dependentTree, dependentsOf } from '../engine/reverse.ts';
import { selectionChanges } from '../engine/selection.ts';
import { statistics, type FileStats } from '../engine/stats.ts';
import { fileHash, selectableText } from '../hash/hash.ts';
import { changedSince } from '../history/changes.ts';
import type { FragmentProbe } from '../history/fragments.ts';
import { renamedTo } from '../history/renamed.ts';
import { replay } from '../history/replay.ts';
import { stampFile } from '../inline/read-inline.ts';
import { lockExists, readLock, writeLock } from '../lock/lock.ts';
import {
  jsonText,
  listJsonText,
  reverseJsonText,
  statsJsonText,
  type StatsWindow,
} from '../report/json.ts';
import {
  checkChunks,
  type Chunk,
  diagnosticsText,
  listText,
  reverseText,
  statsText,
  updateText,
} from '../report/text.ts';
import { determineRoot, existsUnderRoot, isIgnoredPath, type Universe } from '../universe/walk.ts';
import { parseArgs, type Args } from './args.ts';
import { helpText } from './help.ts';
import { resolutionMessage, rootFromCwd, selectResults, toRepoPath } from './paths.ts';
import { runSuggest } from './suggest.ts';
import { loadWorkspace } from './workspace.ts';

export interface Io {
  stdout(s: string): void;
  stderr(s: string): void;
  isTty: boolean;
  env: NodeJS.ProcessEnv;
}

declare const VERSION: string | undefined;

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

// SPEC §13.2 step 2: an entry of any kind, not followed
function isEntry(host: Host, path: string): boolean {
  return host.fs.kind(path) !== null;
}

interface Evaluated {
  results: Result[];
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

function evaluateDeclarations(
  host: Host,
  root: string,
  readLockFor: () => Lock,
  hashFiles: boolean,
) {
  const { universe, declarations, attached, presets, defaultPresets, plugins } = loadWorkspace(
    host,
    root,
  );
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
  return { declarations, universe, presets, defaultPresets, results, lock, fragmentProbe };
}

// SPEC §12.2
function evaluateAll(host: Host, root: string, policy: 'strict' | 'discard-invalid'): Evaluated {
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
function listAll(host: Host, root: string): Result[] {
  return evaluateDeclarations(host, root, () => ({ entries: new Map() }), false).results;
}

// SPEC §12.3
function withChanges(
  host: Host,
  root: string,
  result: Result,
  evaluated: Evaluated,
  whitespace: Map<string, boolean>,
): Result {
  const declaration = evaluated.declarations.find((b) => b.file === result.file);
  const inline = declaration?.inline;
  const entry = inline ? inline.recorded : evaluated.lock.entries.get(result.file);
  if (result.state !== 'stale' || !result.reasons.includes('content-changed') || !entry) {
    return result;
  }
  const probe = declaration?.selected?.length
    ? evaluated.fragmentProbe(declaration.selected)
    : undefined;
  const report = changedSince(
    host.git(root),
    result,
    entry,
    inline !== undefined,
    whitespace,
    probe,
  );
  if (report === null) return { ...result, changes: null };
  const { universe, presets, defaultPresets } = evaluated;
  const { ownThen } = report;
  const selection =
    ownThen === undefined
      ? null
      : selectionChanges(
          result.file,
          ownThen,
          presets,
          defaultPresets,
          universe.paths,
          result.resolved,
        );
  return {
    ...result,
    changes: report.changes,
    base: report.base,
    ...(report.edited === undefined ? {} : { edited: report.edited }),
    ...(selection === null ? {} : { selection }),
    ...(report.fragments === undefined ? {} : { fragments: report.fragments }),
  };
}

const hasError = (ds: readonly Diagnostic[]) => ds.some((d) => d.severity === 'error');

interface Output {
  json: boolean;
  mode: 'check' | 'update';
  evaluated: boolean;
  onlyStale?: boolean;
  exitCode: number;
  selected: Result[];
  global: Diagnostic[];
  text: string;
  chunks?: Chunk[];
  written?: Set<string>;
  removed?: string[];
}

function emit(io: Io, o: Output): number {
  if (o.json) {
    io.stdout(
      jsonText({
        mode: o.mode,
        evaluated: o.evaluated,
        onlyStale: o.onlyStale === true,
        exitCode: o.exitCode,
        selected: o.selected,
        diagnostics: o.global,
        ...(o.written === undefined ? {} : { written: o.written }),
        ...(o.removed === undefined ? {} : { removed: o.removed }),
      }),
    );
  } else {
    const chunks = o.chunks ?? [
      { stream: 'stdout' as const, text: o.text },
      {
        stream: 'stderr' as const,
        text: diagnosticsText([...o.global, ...o.selected.flatMap((r) => r.diagnostics)]),
      },
    ];
    for (const { stream, text } of chunks) io[stream](text);
  }
  return o.exitCode;
}

// SPEC §13.7
function runList(
  host: Host,
  args: { json: boolean; root?: string; paths: string[] },
  cwd: string,
  io: Io,
): number {
  let selected: Result[] = [];
  let global: Diagnostic[] = [];
  let exitCode = 2;
  try {
    const root = determineRoot(host, cwd, args.root);
    selected = selectResults(args.paths, cwd, root, listAll(host, root));
    exitCode = selected.some((r) => r.state === 'invalid') ? 2 : 0;
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    global = e.diagnostics;
  }
  if (args.json) {
    io.stdout(listJsonText({ exitCode, selected, diagnostics: global }));
  } else {
    io.stdout(listText(selected));
    io.stderr(diagnosticsText([...global, ...selected.flatMap((r) => r.diagnostics)]));
  }
  return exitCode;
}

// SPEC §13.8
function reverseEntries(
  host: Host,
  root: string,
  cwd: string,
  paths: readonly string[],
  transitive: boolean,
  directFirst: boolean,
): { entries: ReverseEntry[]; attached: Diagnostic[] } {
  const { universe: walked, declarations, attached } = loadWorkspace(host, root);
  const universe = new Set(walked.paths);
  const keyed = new Map<string, string | null>();
  for (const arg of paths) keyed.set(toRepoPath(arg, cwd, root) ?? arg, toRepoPath(arg, cwd, root));
  const outside = sortPaths([...keyed.keys()].filter((key) => keyed.get(key) === null));
  if (outside.length > 0) {
    throw new Raised(
      outside.map((subject) =>
        diag('E_USAGE', { subject, message: resolutionMessage(subject, cwd, root) }),
      ),
    );
  }
  const entries = sortPaths([...keyed.keys()]).map((key): ReverseEntry => ({
    file: key,
    dependents: transitive
      ? dependentTree(key, declarations, universe, attached, directFirst)
      : dependentsOf(key, declarations, universe, attached),
    diagnostics:
      universe.has(key) || existsUnderRoot(host, root, key)
        ? []
        : [diag('W_UNKNOWN_PATH', { subject: key })],
  }));
  return { entries, attached };
}

// SPEC §13.8
function runReverse(
  host: Host,
  args: { json: boolean; root?: string; paths: string[]; transitive: boolean },
  cwd: string,
  io: Io,
): number {
  let entries: ReverseEntry[] = [];
  let global: Diagnostic[] = [];
  let exitCode = 2;
  try {
    const root = determineRoot(host, cwd, args.root);
    // SPEC §14.7: text prints DirectFirstTree, JSON DependentTree
    const found = reverseEntries(host, root, cwd, args.paths, args.transitive, !args.json);
    entries = found.entries;
    global = found.attached;
    exitCode = hasError(global) || entries.some((e) => hasError(e.diagnostics)) ? 2 : 0;
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    global = e.diagnostics;
  }
  if (args.json) {
    io.stdout(reverseJsonText({ exitCode, entries, diagnostics: global }));
  } else {
    io.stdout(reverseText(entries));
    io.stderr(diagnosticsText([...global, ...entries.flatMap((e) => e.diagnostics)]));
  }
  return exitCode;
}

// SPEC §13.9; the only read of the clock (§2)
function runStats(host: Host, args: Extract<Args, { mode: 'stats' }>, cwd: string, io: Io): number {
  let exitCode = 2;
  let global: Diagnostic[] = [];
  let window: StatsWindow | null = null;
  let files: readonly FileStats[] = [];
  try {
    const root = determineRoot(host, cwd, args.root);
    const selected = selectResults(args.paths, cwd, root, listAll(host, root));
    const invalid = selected.filter((r) => r.state === 'invalid');
    if (invalid.length > 0) throw new Raised(invalid.flatMap((r) => [...r.diagnostics]));
    const given = args.window;
    const replayed = replay(
      host.git(root),
      given.kind === 'days' ? given : { kind: 'from', value: given.value },
      Math.floor(host.clock.now() / 1000),
    );
    const computed = statistics(
      selected.map((r) => ({
        file: r.file,
        patterns: r.dependencies.length,
        resolved: r.resolved,
        diagnostics: r.diagnostics,
      })),
      replayed.commits,
    );
    files = computed.files;
    window = {
      kind: replayed.kind,
      value: given.value,
      commits: replayed.commits.length,
      untouched: computed.untouched,
    };
    exitCode = 0;
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    global = e.diagnostics;
  }
  if (args.json) {
    io.stdout(statsJsonText({ exitCode, window, files, diagnostics: global }));
  } else {
    if (window !== null) io.stdout(statsText(files, window));
    io.stderr(diagnosticsText([...global, ...files.flatMap((f) => f.diagnostics)]));
  }
  return exitCode;
}

// SPEC §13.5, §13.6, §13.7, §13.8, §13.9
export function run(host: Host, argv: readonly string[], cwd: string, io: Io): number {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, (arg) => isEntry(host, resolve(cwd, arg)));
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    io.stderr(diagnosticsText(e.diagnostics));
    return 2;
  }
  if (args.mode === 'help') {
    try {
      io.stdout(helpText(args.names));
      return 0;
    } catch (e) {
      if (!(e instanceof Raised)) throw e;
      io.stderr(diagnosticsText(e.diagnostics));
      return 2;
    }
  }
  if (args.mode === 'version') {
    io.stdout(`${typeof VERSION === 'string' ? VERSION : '0.0.0'}\n`);
    return 0;
  }
  if (args.mode === 'list-dependencies') return runList(host, args, cwd, io);
  if (args.mode === 'list-dependents') return runReverse(host, args, cwd, io);
  if (args.mode === 'stats') return runStats(host, args, cwd, io);
  if (args.mode === 'suggest') return runSuggest(host, args, cwd, io);
  const { mode, json } = args;
  const empty: Output = {
    json,
    mode,
    evaluated: false,
    exitCode: 2,
    selected: [],
    global: [],
    text: '',
    ...(mode === 'update' ? { written: new Set<string>(), removed: [] } : {}),
  };
  try {
    const root = determineRoot(host, cwd, args.root);
    const evaluated = evaluateAll(
      host,
      root,
      args.mode === 'update' && args.all ? 'discard-invalid' : 'strict',
    );
    const selected =
      args.mode === 'update' && args.all
        ? evaluated.results
        : selectResults(args.paths, cwd, root, evaluated.results);
    const global = evaluated.global;
    const refused = hasError(global) || selected.some((r) => r.state === 'invalid');
    if (mode === 'check') {
      const stale = selected.some((r) => r.state === 'stale');
      const exitCode = refused ? 2 : stale ? 1 : 0;
      const whitespace = new Map<string, boolean>();
      const reported = selected.map((r) => withChanges(host, root, r, evaluated, whitespace));
      const chunks = checkChunks(reported, global, {
        root: args.root,
        quiet: args.quiet,
        rootFromCwd: rootFromCwd(cwd, root),
        inline: new Set(evaluated.declarations.filter((b) => b.inline).map((b) => b.file)),
      });
      return emit(io, {
        ...empty,
        evaluated: true,
        onlyStale: args.onlyStale,
        exitCode,
        selected: reported,
        global,
        chunks,
      });
    }
    if (refused) {
      const chunks = checkChunks(selected, global, { root: args.root, next: false });
      return emit(io, { ...empty, evaluated: true, selected, global, chunks });
    }
    const inlineFiles = new Map(
      evaluated.declarations.filter((b) => b.inline).map((b) => [b.file, b.inline!.recorded]),
    );
    const entries = new Map(evaluated.lock.entries);
    for (const t of selected) if (!inlineFiles.has(t.file)) entries.set(t.file, t.current);
    const bound = new Set(evaluated.declarations.filter((b) => !b.inline).map((b) => b.file));
    const removed = sortPaths([...entries.keys()].filter((d) => !bound.has(d)));
    for (const d of removed) entries.delete(d);
    if (bound.size > 0 || lockExists(host, root)) writeLock(host, root, { entries });
    const written = selected
      .filter((r) =>
        inlineFiles.has(r.file)
          ? inlineFiles.get(r.file) !== r.current
          : evaluated.lock.entries.get(r.file) !== r.current,
      )
      .map((r) => r.file);
    for (const file of written.filter((f) => inlineFiles.has(f))) {
      stampFile(
        host,
        root,
        evaluated.universe,
        file,
        selected.find((r) => r.file === file)!.current,
      );
    }
    const unchanged = selected.map((r) => r.file).filter((file) => !written.includes(file));
    const text = updateText(written, unchanged, removed);
    const afterWrite = selected.map((r): Result => ({ ...r, state: 'ok', reasons: [] }));
    return emit(io, {
      ...empty,
      evaluated: true,
      exitCode: 0,
      selected: afterWrite,
      global: global.filter((d) => d.code !== 'W_ORPHAN'),
      text,
      written: new Set(written),
      removed,
    });
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    return emit(io, { ...empty, global: e.diagnostics });
  }
}
