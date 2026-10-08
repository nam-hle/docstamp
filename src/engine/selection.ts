import { Raised } from '../core/diagnostics.ts';
import { comparePaths } from '../core/order.ts';
import type { SelectionChange } from '../core/types.ts';
import { select } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';
import { expandPresets } from './presets.ts';

// SPEC §12.3 step 10: the files an edit of the own list added to or dropped from the selection
export function selectionChanges(
  file: string,
  then: { readonly dependencies: readonly string[]; readonly use: readonly string[] },
  presets: ReadonlyMap<string, readonly string[]>,
  universe: readonly string[],
  resolved: readonly string[],
): SelectionChange[] | null {
  let old: readonly string[];
  try {
    old = expandPresets({ file, ...then }, presets, true).dependencies;
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    return null;
  }
  const parsed = old.map((source) => parsePattern(source));
  if (parsed.some((p) => p === null)) return null;
  const before = new Set(
    select(
      parsed as ParsedPattern[],
      universe.filter((path) => path !== file),
    ),
  );
  const after = new Set(resolved);
  return [
    ...resolved
      .filter((path) => !before.has(path))
      .map((path) => ({ status: 'added' as const, path })),
    ...[...before]
      .filter((path) => !after.has(path))
      .map((path) => ({ status: 'removed' as const, path })),
  ].sort((a, b) => comparePaths(a.path, b.path));
}
