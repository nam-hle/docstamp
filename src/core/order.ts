// SPEC §3.3
export function comparePaths(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// SPEC §3.3
export function sortPaths(xs: readonly string[]): string[] {
  return [...xs].sort(comparePaths);
}
