import type { Declaration, ReverseDependent, Diagnostic } from '../core/types.ts';
import { patternMatches, select } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';

// SPEC §13.8 step 3.2
export function dependentsOf(
  path: string,
  declarations: readonly Declaration[],
  universe: ReadonlySet<string>,
  attached: readonly Diagnostic[],
): ReverseDependent[] {
  if (!universe.has(path)) return [];
  const found: ReverseDependent[] = [];
  for (const declaration of declarations) {
    if (declaration.file === path) continue;
    if (attached.some((d) => d.file === declaration.file)) continue;
    const patterns = declaration.dependencies.map(
      (source) => parsePattern(source) as ParsedPattern,
    );
    if (select(patterns, [path]).length === 0) continue;
    const via = declaration.dependencies.filter(
      (_, i) => !patterns[i]!.negated && patternMatches(patterns[i]!, path),
    );
    found.push({ file: declaration.file, via });
  }
  return found;
}

// SPEC §13.8 DependentTree
export function dependentTree(
  path: string,
  declarations: readonly Declaration[],
  universe: ReadonlySet<string>,
  attached: readonly Diagnostic[],
): ReverseDependent[] {
  const expanded = new Set<string>();
  const below = (current: string, chain: readonly string[]): ReverseDependent[] =>
    dependentsOf(current, declarations, universe, attached).map((d) => {
      if (chain.includes(d.file)) return { ...d, dependents: [], cycle: true, repeated: false };
      if (expanded.has(d.file)) return { ...d, dependents: [], cycle: false, repeated: true };
      expanded.add(d.file);
      const dependents = below(d.file, [...chain, d.file]);
      return { ...d, dependents, cycle: false, repeated: false };
    });
  return below(path, [path]);
}
