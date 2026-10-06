import { lstatSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { readConfig } from '../config/read-config.ts';
import { Raised } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import type { Diagnostic, Lock, Result } from '../core/types.ts';
import { evaluate, orphans, type EngineFs } from '../engine/evaluate.ts';
import { fileHash } from '../hash/hash.ts';
import { changedSince } from '../history/changes.ts';
import { readLock, writeLock } from '../lock/lock.ts';
import { jsonText, listJsonText } from '../report/json.ts';
import { checkText, diagnosticsText, listText, updateText } from '../report/text.ts';
import { computeUniverse, determineRoot } from '../universe/walk.ts';
import { HELP, parseArgs } from './args.ts';
import { selectResults } from './paths.ts';

export interface Io {
  stdout(s: string): void;
  stderr(s: string): void;
  isTty: boolean;
  env: NodeJS.ProcessEnv;
}

declare const VERSION: string | undefined;

// SPEC §9.4: exact-name match in the parent's listing, and a file, not a link
function isDependentFile(root: string, path: string): boolean {
  const dir = dirname(join(root, path));
  try {
    const name = readdirSync(dir).find((n) => n.normalize('NFC') === basename(path));
    return name !== undefined && lstatSync(join(dir, name)).isFile();
  } catch {
    return false;
  }
}

interface Evaluated {
  results: Result[];
  lock: Lock;
  global: Diagnostic[];
}

export function memoizeHash(hash: (path: string) => string): (path: string) => string {
  const cache = new Map<string, string | Raised>();
  return (path) => {
    let cached = cache.get(path);
    if (cached === undefined) {
      try {
        cached = hash(path);
      } catch (e) {
        if (!(e instanceof Raised)) throw e;
        cached = e;
      }
      cache.set(path, cached);
    }
    if (cached instanceof Raised) throw cached;
    return cached;
  };
}

function evaluateBindings(root: string, readLockFor: () => Lock, hashFiles: boolean) {
  const { config, attached } = readConfig(root);
  const universe = computeUniverse(root, config);
  const lock = readLockFor();
  const fs: EngineFs = {
    isDependentFile: (p) => isDependentFile(root, p),
    fileHash: hashFiles ? memoizeHash((p) => fileHash(root, universe, p)) : () => '',
  };
  const results = config.bindings.map((b) =>
    evaluate(
      b,
      universe.paths,
      lock,
      attached.filter((d) => d.dependent === b.dependent),
      fs,
    ),
  );
  return { bindings: config.bindings, results, lock };
}

// SPEC §12.2
function evaluateAll(root: string, policy: 'strict' | 'discard-invalid'): Evaluated {
  const readLockFor = (): Lock => {
    try {
      return readLock(root);
    } catch (e) {
      if (!(e instanceof Raised) || policy === 'strict') throw e;
      return { entries: new Map() };
    }
  };
  const { bindings, results, lock } = evaluateBindings(root, readLockFor, true);
  return { results, lock, global: orphans(bindings, lock) };
}

// SPEC §13.7
function listAll(root: string): Result[] {
  return evaluateBindings(root, () => ({ entries: new Map() }), false).results;
}

// SPEC §12.3
function withChanges(root: string, result: Result, lock: Lock): Result {
  const entry = lock.entries.get(result.dependent);
  if (result.state !== 'stale' || !result.reasons.includes('content-changed') || !entry) {
    return result;
  }
  return { ...result, changes: changedSince(root, result, entry) };
}

const hasError = (ds: readonly Diagnostic[]) => ds.some((d) => d.severity === 'error');

interface Output {
  json: boolean;
  mode: 'check' | 'update';
  exitCode: number;
  selected: Result[];
  global: Diagnostic[];
  text: string;
  written?: Set<string>;
  removed?: string[];
}

function emit(io: Io, o: Output): number {
  if (o.json) {
    io.stdout(
      jsonText({
        mode: o.mode,
        exitCode: o.exitCode,
        selected: o.selected,
        diagnostics: o.global,
        ...(o.written === undefined ? {} : { written: o.written }),
        ...(o.removed === undefined ? {} : { removed: o.removed }),
      }),
    );
  } else {
    io.stdout(o.text);
    io.stderr(diagnosticsText([...o.global, ...o.selected.flatMap((r) => r.diagnostics)]));
  }
  return o.exitCode;
}

// SPEC §13.7
function runList(
  args: { json: boolean; root?: string; paths: string[] },
  cwd: string,
  io: Io,
): number {
  let selected: Result[] = [];
  let global: Diagnostic[] = [];
  let exitCode = 2;
  try {
    const root = determineRoot(cwd, args.root);
    const picked = selectResults(args.paths, cwd, root, listAll(root));
    selected = picked.selected;
    global = picked.errors;
    exitCode = hasError(global) || selected.some((r) => r.state === 'invalid') ? 2 : 0;
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

// SPEC §13.5, §13.6, §13.7
export function run(argv: readonly string[], cwd: string, io: Io): number {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    io.stderr(diagnosticsText(e.diagnostics));
    return 2;
  }
  if (args.mode === 'help') {
    io.stdout(HELP);
    return 0;
  }
  if (args.mode === 'version') {
    io.stdout(`${typeof VERSION === 'string' ? VERSION : '0.0.0'}\n`);
    return 0;
  }
  if (args.mode === 'list-dependents') return runList(args, cwd, io);
  const { mode, json } = args;
  const empty: Output = {
    json,
    mode,
    exitCode: 2,
    selected: [],
    global: [],
    text: checkText([]),
    ...(mode === 'update' ? { written: new Set<string>(), removed: [] } : {}),
  };
  try {
    const root = determineRoot(cwd, args.root);
    const evaluated = evaluateAll(
      root,
      args.mode === 'update' && args.all ? 'discard-invalid' : 'strict',
    );
    const picked =
      args.mode === 'update' && args.all
        ? { selected: evaluated.results, errors: [] }
        : selectResults(args.paths, cwd, root, evaluated.results);
    const { selected } = picked;
    const global = [...evaluated.global, ...picked.errors];
    const refused = hasError(global) || selected.some((r) => r.state === 'invalid');
    if (mode === 'check') {
      const stale = selected.some((r) => r.state === 'stale');
      const exitCode = refused ? 2 : stale ? 1 : 0;
      const reported = selected.map((r) => withChanges(root, r, evaluated.lock));
      const text = checkText(reported, args.root);
      return emit(io, { ...empty, exitCode, selected: reported, global, text });
    }
    if (refused) {
      const text = checkText(selected, args.root);
      return emit(io, { ...empty, selected, global, text });
    }
    const entries = new Map(evaluated.lock.entries);
    for (const t of selected) entries.set(t.dependent, t.current);
    const bound = new Set(evaluated.results.map((r) => r.dependent));
    const removed = sortPaths([...entries.keys()].filter((d) => !bound.has(d)));
    for (const d of removed) entries.delete(d);
    writeLock(root, { entries });
    const written = selected.map((r) => r.dependent);
    const text = updateText(written, removed);
    return emit(io, {
      ...empty,
      exitCode: 0,
      selected,
      global,
      text,
      written: new Set(written),
      removed,
    });
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    return emit(io, { ...empty, global: e.diagnostics });
  }
}
