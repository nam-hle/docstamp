import { sortPaths } from '../core/order.ts';
import type { Atom, ParsedPattern, Segment } from './parse.ts';

const escapeLiteral = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/gu, '\\$&');
const escapeInClass = (s: string) => s.replace(/[\\^\]\-[/]/gu, '\\$&');

function atomSource(atom: Atom): string {
  switch (atom.kind) {
    case 'lit':
      return escapeLiteral(atom.value);
    case 'star':
      return '[^/]*';
    case 'any':
      return '[^/]';
    case 'class': {
      const body = atom.items
        .map(([lo, hi]) =>
          lo === hi ? escapeInClass(lo) : `${escapeInClass(lo)}-${escapeInClass(hi)}`,
        )
        .join('');
      return atom.negated ? `[^/${body}]` : `(?:(?!/)[${body}])`;
    }
    case 'alt':
      return `(?:${atom.alts.map((alt) => alt.map(atomSource).join('')).join('|')})`;
  }
}

// SPEC §8.2
export function compileGlob(segments: Segment[]): RegExp {
  let source = '';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment.kind === 'globstar') {
      source += last ? '[^/]+(?:/[^/]+)*' : '(?:[^/]+/)*';
      return;
    }
    source += segment.atoms.map(atomSource).join('') + (last ? '' : '/');
  });
  return new RegExp(`^${source}$`, 'u');
}

const cache = new WeakMap<ParsedPattern, RegExp>();
function regexOf(pattern: ParsedPattern): RegExp {
  let regex = cache.get(pattern);
  if (!regex) {
    regex = compileGlob(pattern.segments);
    cache.set(pattern, regex);
  }
  return regex;
}

// SPEC §8.3
export function patternMatches(pattern: ParsedPattern, path: string): boolean {
  const regex = regexOf(pattern);
  if (regex.test(path)) return true;
  for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
    if (regex.test(path.slice(0, i))) return true;
  }
  return false;
}

// SPEC §8.4
export function select(
  patterns: readonly ParsedPattern[],
  candidates: readonly string[],
): string[] {
  return sortPaths(candidates).filter((path) => {
    let selected = false;
    for (const pattern of patterns) {
      if (patternMatches(pattern, path)) selected = !pattern.negated;
    }
    return selected;
  });
}

// SPEC §12.3 step 6, §13.8 step 4.2
export function viaOf(
  dependencies: readonly string[],
  patterns: readonly ParsedPattern[],
  path: string,
): string[] {
  return dependencies.filter((_, i) => !patterns[i]!.negated && patternMatches(patterns[i]!, path));
}
