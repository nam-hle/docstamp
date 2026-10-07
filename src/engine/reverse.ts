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
    if (declaration.dependent === path) continue;
    if (attached.some((d) => d.dependent === declaration.dependent && d.code === 'E_PATTERN'))
      continue;
    const patterns = declaration.dependencies.map(
      (source) => parsePattern(source) as ParsedPattern,
    );
    if (select(patterns, [path]).length === 0) continue;
    const via = declaration.dependencies.filter(
      (_, i) => !patterns[i]!.negated && patternMatches(patterns[i]!, path),
    );
    found.push({ file: declaration.dependent, via });
  }
  return found;
}
