import { comparePaths } from '../core/order.ts';
import type { Diagnostic } from '../core/types.ts';

// SPEC §12.4
export interface CommitRecord {
  readonly day: string;
  readonly paths: readonly string[];
}

export interface StatsInput {
  readonly file: string;
  readonly patterns: number;
  readonly resolved: readonly string[];
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

// SPEC §12.5
export function statistics(
  inputs: readonly StatsInput[],
  window: readonly CommitRecord[],
): Statistics {
  const owners = new Map<string, number[]>();
  inputs.forEach((input, index) => {
    for (const path of input.resolved) {
      const list = owners.get(path);
      if (list === undefined) owners.set(path, [index]);
      else list.push(index);
    }
  });
  const days = inputs.map(() => new Set<string>());
  const commits = inputs.map(() => 0);
  const sweeps = inputs.map(() => 0);
  let untouched = 0;
  for (const commit of window) {
    const distinct = new Set(commit.paths);
    const touched = new Set([...distinct].flatMap((path) => owners.get(path) ?? []));
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
