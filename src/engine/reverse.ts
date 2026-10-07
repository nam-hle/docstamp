import type { Binding, Dependent, Diagnostic } from '../core/types.ts';
import { patternMatches, select } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';

// SPEC §13.8 step 3.2
export function dependentsOf(
  path: string,
  bindings: readonly Binding[],
  universe: ReadonlySet<string>,
  attached: readonly Diagnostic[],
): Dependent[] {
  if (!universe.has(path)) return [];
  const found: Dependent[] = [];
  for (const binding of bindings) {
    if (binding.dependent === path) continue;
    if (attached.some((d) => d.dependent === binding.dependent && d.code === 'E_PATTERN')) continue;
    const patterns = binding.dependencies.map((source) => parsePattern(source) as ParsedPattern);
    if (select(patterns, [path]).length === 0) continue;
    const via = binding.dependencies.filter(
      (_, i) => !patterns[i]!.negated && patternMatches(patterns[i]!, path),
    );
    found.push({ file: binding.dependent, via });
  }
  return found;
}
