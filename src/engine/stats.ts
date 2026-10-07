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

// SPEC §12.5; the ratios are integers of ten-thousandths
export interface FileStats {
  readonly file: string;
  readonly patterns: number;
  readonly resolvedCount: number;
  readonly commits: number;
  readonly days: number;
  readonly sweepCommits: number;
  readonly ratio: number;
  readonly sweepShare: number;
  readonly diagnostics: readonly Diagnostic[];
}

export interface Statistics {
  readonly files: readonly FileStats[];
  readonly firingNothing: number;
}

// SPEC §12.5: n/d rounded half up to 4 decimals, in integers
export function ratio(n: number, d: number): number {
  return d === 0 ? 0 : Math.floor((20000 * n + d) / (2 * d));
}

// SPEC §12.5
export function statistics(
  inputs: readonly StatsInput[],
  window: readonly CommitRecord[],
  threshold: number,
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
  let firingNothing = 0;
  for (const commit of window) {
    const distinct = new Set(commit.paths);
    const fired = new Set([...distinct].flatMap((path) => owners.get(path) ?? []));
    if (fired.size === 0) firingNothing += 1;
    for (const index of fired) {
      commits[index]! += 1;
      days[index]!.add(commit.day);
      if (distinct.size > threshold) sweeps[index]! += 1;
    }
  }
  const files = inputs
    .map((input, index): FileStats => ({
      file: input.file,
      patterns: input.patterns,
      resolvedCount: input.resolved.length,
      commits: commits[index]!,
      days: days[index]!.size,
      sweepCommits: sweeps[index]!,
      ratio: ratio(commits[index]!, window.length),
      sweepShare: ratio(sweeps[index]!, commits[index]!),
      diagnostics: input.diagnostics,
    }))
    .sort((a, b) => b.ratio - a.ratio || comparePaths(a.file, b.file));
  return { files, firingNothing };
}

// SPEC §13.9 step 7: `limit` is a validated decimal in 0..1; compared as exact decimals
export function exceeds(tenThousandths: number, limit: string): boolean {
  const [whole = '0', fraction = ''] = limit.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction);
  return BigInt(tenThousandths) * scale > numerator * 10000n;
}
