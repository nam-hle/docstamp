
import { resolve } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import type { Diagnostic, Result, ReverseEntry } from '../core/types.ts';
import { dependentTree, dependentsOf } from '../engine/reverse.ts';
import { statistics, type FileStats } from '../engine/stats.ts';
import type { Host } from '../host/host.ts';
import { replay } from '../history/replay.ts';
import { stampFile } from '../inline/read-inline.ts';
import { lockExists, writeLock } from '../lock/lock.ts';
import { listJsonText, reverseJsonText, statsJsonText, type StatsWindow } from '../report/json.ts';
import {
  checkChunks,
  diagnosticsText,
  listText,
  reverseText,
  statsText,
  updateText,
} from '../report/text.ts';
import { determineRoot, existsUnderRoot, resolveCwd } from '../universe/walk.ts';
import { parseArgs, type Args } from './args.ts';
import { runCheck } from './check.ts';
import { emit, hasError, type Output } from './emit.ts';
import { evaluateAll, listAll } from './evaluate.ts';
import { helpText } from './help.ts';
import type { Io } from './io.ts';
import { resolutionMessage, selectResults, toRepoPath } from './paths.ts';
import { runSuggest } from './suggest.ts';
import { loadWorkspace } from './workspace.ts';

declare const VERSION: string | undefined;

// SPEC §13.2 step 2: an entry of any kind, not followed
function isEntry(host: Host, path: string): boolean {
  return host.fs.kind(path) !== null;
}

// SPEC §13.7
function runList(
  host: Host,
  args: { json: boolean; cwd?: string; paths: string[] },
  processCwd: string,
  io: Io,
): number {
  let selected: Result[] = [];
  let global: Diagnostic[] = [];
  let exitCode = 2;
  try {
    const cwd = resolveCwd(host, processCwd, args.cwd);
    const root = determineRoot(host, cwd);
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
  args: { json: boolean; cwd?: string; paths: string[]; transitive: boolean },
  processCwd: string,
  io: Io,
): number {
  let entries: ReverseEntry[] = [];
  let global: Diagnostic[] = [];
  let exitCode = 2;
  try {
    const cwd = resolveCwd(host, processCwd, args.cwd);
    const root = determineRoot(host, cwd);
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
function runStats(
  host: Host,
  args: Extract<Args, { mode: 'stats' }>,
  processCwd: string,
  io: Io,
): number {
  let exitCode = 2;
  let global: Diagnostic[] = [];
  let window: StatsWindow | null = null;
  let files: readonly FileStats[] = [];
  try {
    const cwd = resolveCwd(host, processCwd, args.cwd);
    const root = determineRoot(host, cwd);
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
export function run(host: Host, argv: readonly string[], processCwd: string, io: Io): number {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, (arg) => isEntry(host, resolve(processCwd, arg)));
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
  if (args.mode === 'list-dependencies') return runList(host, args, processCwd, io);
  if (args.mode === 'list-dependents') return runReverse(host, args, processCwd, io);
  if (args.mode === 'stats') return runStats(host, args, processCwd, io);
  if (args.mode === 'suggest') return runSuggest(host, args, processCwd, io);
  if (args.mode === 'check') return runCheck(host, args, processCwd, io);
  const empty: Output = {
    json: args.json,
    mode: 'update',
    evaluated: false,
    exitCode: 2,
    selected: [],
    global: [],
    text: '',
    written: new Set<string>(),
    removed: [],
  };
  try {
    const cwd = resolveCwd(host, processCwd, args.cwd);
    const root = determineRoot(host, cwd);
    const evaluated = evaluateAll(host, root, args.all ? 'discard-invalid' : 'strict');
    const selected = args.all
      ? evaluated.results
      : selectResults(args.paths, cwd, root, evaluated.results);
    const global = evaluated.global;
    const refused = hasError(global) || selected.some((r) => r.state === 'invalid');
    if (refused) {
      const chunks = checkChunks(selected, global, { cwd: args.cwd, next: false });
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
