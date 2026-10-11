import { comparePaths } from '../core/order.ts';
import type { Diagnostic, SelectedEntry } from '../core/types.ts';

// SPEC §12.4
export interface CommitRecord {
  readonly id: string;
  readonly day: string;
  readonly paths: readonly string[];
}

export interface StatsInput {
  readonly file: string;
  readonly patterns: number;
  readonly resolved: readonly string[];
  // the resolved paths that the patterns select: any change of one makes the file stale
  readonly whole: readonly string[];
  readonly selected: readonly SelectedEntry[];
  readonly diagnostics: readonly Diagnostic[];
}

// SPEC §12.5: the sweep size
const SWEEP_SIZE = 200;

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
    }))
    .sort((a, b) => b.staleRate - a.staleRate || comparePaths(a.file, b.file));
  return { files, untouched };
}
