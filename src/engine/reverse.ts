import type { Declaration, ReverseDependent, Diagnostic } from '../core/types.ts';
import { patternMatches, select } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';
import { canonicalJson } from '../plugin/canonical.ts';

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
    const selectedVia = (declaration.selected ?? [])
      .filter((entry) => entry.path === path)
      .map((entry) => `${entry.path}#${canonicalJson(entry.select)}`);
    if (select(patterns, [path]).length === 0 && selectedVia.length === 0) continue;
    const patternVia = declaration.dependencies.filter(
      (_, i) => !patterns[i]!.negated && patternMatches(patterns[i]!, path),
    );
    found.push({ file: declaration.file, via: [...patternVia, ...selectedVia] });
  }
  return found;
}

// SPEC §13.8 DependentTree, and DirectFirstTree when directFirst is true
export function dependentTree(
  path: string,
  declarations: readonly Declaration[],
  universe: ReadonlySet<string>,
  attached: readonly Diagnostic[],
  directFirst = false,
): ReverseDependent[] {
  const direct = dependentsOf(path, declarations, universe, attached);
  const reserved = new Set(directFirst ? direct.map((d) => d.file) : []);
  const built = new Set<string>();
  const expanded = new Set(reserved);
  const node = (d: ReverseDependent, chain: readonly string[], top: boolean): ReverseDependent => {
    if (chain.includes(d.file)) return { ...d, dependents: [], cycle: true, repeated: false };
    if (!top && expanded.has(d.file)) {
      const later = reserved.has(d.file) && !built.has(d.file);
      return { ...d, dependents: [], cycle: false, repeated: true, ...(later && { below: true }) };
    }
    expanded.add(d.file);
    built.add(d.file);
    const dependents = dependentsOf(d.file, declarations, universe, attached).map((child) =>
      node(child, [...chain, d.file], false),
    );
    return { ...d, dependents, cycle: false, repeated: false };
  };
  return direct.map((d) => node(d, [path], directFirst));
}
