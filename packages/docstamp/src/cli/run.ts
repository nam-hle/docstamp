import { resolve } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import type { Diagnostic, Result, ReverseEntry } from '../core/types.ts';
import { resolveDependencies } from '../engine/evaluate.ts';
import { dependentTree, dependentsOf } from '../engine/reverse.ts';
import { statistics, type FileStats, type StatsDependency } from '../engine/stats.ts';
import type { Host } from '../host/host.ts';
import { parsePattern } from '../pattern/parse.ts';
import { canonicalJson } from '../core/canonical.ts';
import { fragmentChangedAt, type FragmentCache } from '../history/fragments.ts';
import { replay } from '../history/replay.ts';
import { listJsonText, reverseJsonText, statsJsonText, type StatsWindow } from '../report/json.ts';
import { diagnosticsText, listText, reverseText, statsText } from '../report/text.ts';
import { determineRoot, existsUnderRoot, resolveCwd } from '../universe/walk.ts';
import { parseArgs, type Args } from './args.ts';
import { runCheck } from './check.ts';
import { hasError } from './emit.ts';
import { listAll, listWorkspace } from './evaluate.ts';
import { helpText } from './help.ts';
import type { Io } from './io.ts';
import { resolutionMessage, selectResults, toRepoPath } from './paths.ts';
import { runSuggest } from './suggest.ts';
import { runUpdate } from './update.ts';
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
    selected = selectResults(args.paths, cwd, root, listAll(host, root), host.windows);
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
  for (const arg of paths) {
    const repoPath = toRepoPath(arg, cwd, root, host.windows);
    keyed.set(repoPath ?? arg, repoPath);
  }
  const outside = sortPaths([...keyed.keys()].filter((key) => keyed.get(key) === null));
  if (outside.length > 0) {
    throw new Raised(
      outside.map((subject) =>
        diag('E_USAGE', { subject, message: resolutionMessage(subject, cwd, root, host.windows) }),
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

// SPEC §12.5: the patterns that select, then the Selected Dependencies, as listed in §14.3
function breakdownOf(r: Result): StatsDependency[] {
  const patterns = r.dependencies.flatMap((label): StatsDependency[] => {
    const pattern = parsePattern(label)!;
    return pattern.negated ? [] : [{ label, pattern }];
  });
  const selected = (r.selected ?? []).map((entry) => ({
    label: `${entry.path}#${canonicalJson(entry.select)}`,
    entry,
  }));
  return [...patterns, ...selected];
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
    const workspace = listWorkspace(host, root);
    const selected = selectResults(args.paths, cwd, root, workspace.results, host.windows);
    const invalid = selected.filter((r) => r.state === 'invalid');
    if (invalid.length > 0) throw new Raised(invalid.flatMap((r) => [...r.diagnostics]));
    const given = args.window;
    const replayed = replay(
      host.git(root),
      given.kind === 'days' ? given : { kind: 'from', value: given.value },
      Math.floor(host.clock.now() / 1000),
    );
    const git = host.git(root);
    const { earlier } = workspace.fragmentProbe([]);
    const cache: FragmentCache = new Map();
    const computed = statistics(
      selected.map((r) => {
        const declaration = workspace.declarations.find((d) => d.file === r.file)!;
        return {
          file: r.file,
          // SPEC §12.5: the effective patterns and the Selected Dependencies
          patterns: r.dependencies.length + (r.selected?.length ?? 0),
          resolved: r.resolved,
          whole: resolveDependencies(declaration, workspace.universe.paths),
          selected: r.selected ?? [],
          diagnostics: r.diagnostics,
          ...(args.paths.length === 0 ? {} : { breakdown: breakdownOf(r) }),
        };
      }),
      replayed.commits,
      (entry, commit) => fragmentChangedAt(git, commit.id, entry, earlier, cache),
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
  return runUpdate(host, args, processCwd, io);
}
