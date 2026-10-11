import { comparePaths } from '../core/order.ts';
import type { Diagnostic, SelectedEntry } from '../core/types.ts';
import { patternMatches } from '../pattern/match.ts';
import type { ParsedPattern } from '../pattern/parse.ts';

// SPEC §12.4
export interface CommitRecord {
  readonly id: string;
  readonly day: string;
  readonly paths: readonly string[];
}

// SPEC §12.5: a dependency of a file, as the breakdown counts it
export type StatsDependency =
  | { readonly label: string; readonly preset: string | null; readonly pattern: ParsedPattern }
  | { readonly label: string; readonly preset: null; readonly entry: SelectedEntry };

export interface StatsInput {
  readonly file: string;
  readonly patterns: number;
  readonly resolved: readonly string[];
  // the resolved paths that the patterns select: any change of one makes the file stale
  readonly whole: readonly string[];
  readonly selected: readonly SelectedEntry[];
  readonly diagnostics: readonly Diagnostic[];
  // given only when the files are named (§13.9)
  readonly breakdown?: readonly StatsDependency[];
}

// SPEC §12.5: the sweep size
const SWEEP_SIZE = 200;

// SPEC §12.5
interface DependencyStats {
  readonly dependency: string;
  readonly preset: string | null;
  readonly commits: number;
  readonly only: number;
}

// SPEC §12.5; the ratios are integers of ten-thousandths
export interface FileStats {
  readonly file: string;
  readonly patterns: number;
  readonly resolvedCount: number;
  readonly staleCommits: number;
  readonly days: number;
  readonly sweepCommits: number;
  readonly staleRate: number;
  readonly sweepShare: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly dependencies?: readonly DependencyStats[];
}

export interface Statistics {
  readonly files: readonly FileStats[];
  readonly untouched: number;
}

// SPEC §12.5: n/d rounded half up to 4 decimals, in integers
export function ratio(n: number, d: number): number {
  return d === 0 ? 0 : Math.floor((20000 * n + d) / (2 * d));
}

// SPEC §12.5: whether the Fragment of a Selected Dependency differs across a commit
export type FragmentChanged = (entry: SelectedEntry, commit: CommitRecord) => boolean;

// SPEC §12.5
export function statistics(
  inputs: readonly StatsInput[],
  window: readonly CommitRecord[],
  fragmentChanged: FragmentChanged = () => false,
): Statistics {
  const owners = new Map<string, number[]>();
  const selectors = new Map<string, Array<{ index: number; entry: SelectedEntry }>>();
  inputs.forEach((input, index) => {
    for (const path of input.whole) {
      const list = owners.get(path);
      if (list === undefined) owners.set(path, [index]);
      else list.push(index);
    }
    const whole = new Set(input.whole);
    for (const entry of input.selected) {
      if (whole.has(entry.path)) continue;
      const list = selectors.get(entry.path) ?? [];
      list.push({ index, entry });
      selectors.set(entry.path, list);
    }
  });
  const days = inputs.map(() => new Set<string>());
  const commits = inputs.map(() => 0);
  const sweeps = inputs.map(() => 0);
  const counts = inputs.map((input) =>
    (input.breakdown ?? []).map(() => ({ commits: 0, only: 0 })),
  );
  let untouched = 0;
  for (const commit of window) {
    const distinct = new Set(commit.paths);
    const touched = new Set([...distinct].flatMap((path) => owners.get(path) ?? []));
    for (const path of distinct) {
      for (const { index, entry } of selectors.get(path) ?? []) {
        if (!touched.has(index) && fragmentChanged(entry, commit)) touched.add(index);
      }
    }
    if (touched.size === 0) untouched += 1;
    for (const index of touched) {
      commits[index]! += 1;
      days[index]!.add(commit.day);
      if (distinct.size > SWEEP_SIZE) sweeps[index]! += 1;
      const input = inputs[index]!;
      const whole = new Set(input.whole);
      const hit = (input.breakdown ?? []).flatMap((dependency, position) =>
        'pattern' in dependency
          ? [...distinct].some(
              (path) => whole.has(path) && patternMatches(dependency.pattern, path),
            )
            ? [position]
            : []
          : distinct.has(dependency.entry.path) && fragmentChanged(dependency.entry, commit)
            ? [position]
            : [],
      );
      for (const position of hit) counts[index]![position]!.commits += 1;
      if (hit.length === 1) counts[index]![hit[0]!]!.only += 1;
    }
  }
  const files = inputs
    .map((input, index): FileStats => ({
      file: input.file,
      patterns: input.patterns,
      resolvedCount: input.resolved.length,
      staleCommits: commits[index]!,
      days: days[index]!.size,
      sweepCommits: sweeps[index]!,
      staleRate: ratio(commits[index]!, window.length),
      sweepShare: ratio(sweeps[index]!, commits[index]!),
      diagnostics: input.diagnostics,
      ...(input.breakdown === undefined
        ? {}
        : { dependencies: breakdownOf(input.breakdown, counts[index]!) }),
    }))
    .sort((a, b) => b.staleRate - a.staleRate || comparePaths(a.file, b.file));
  return { files, untouched };
}

// SPEC §12.5: by Commits descending, then in the order the dependencies are declared
function breakdownOf(
  dependencies: readonly StatsDependency[],
  counts: ReadonlyArray<{ commits: number; only: number }>,
): DependencyStats[] {
  return dependencies
    .map((dependency, position) => ({
      dependency: dependency.label,
      preset: dependency.preset,
      ...counts[position]!,
      position,
    }))
    .sort((a, b) => b.commits - a.commits || a.position - b.position)
    .map(({ dependency, preset, commits, only }) => ({ dependency, preset, commits, only }));
}
