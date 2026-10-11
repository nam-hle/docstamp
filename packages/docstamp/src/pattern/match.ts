import { sortPaths } from '../core/order.ts';
import type { Atom, ParsedPattern, Segment } from './parse.ts';

type Node =
  | { kind: 'char'; accepts: (cp: string) => boolean; next: number }
  | { kind: 'star'; next: number }
  | { kind: 'eps'; nexts: number[] }
  | { kind: 'match' };

export interface Glob {
  test(path: string): boolean;
}

const isSlash = (cp: string) => cp === '/';
const notSlash = (cp: string) => cp !== '/';

function classAccepts(atom: Extract<Atom, { kind: 'class' }>): (cp: string) => boolean {
  const inItems = (cp: string) => {
    const code = cp.codePointAt(0) ?? 0;
    return atom.items.some(
      ([lo, hi]) => code >= (lo.codePointAt(0) ?? 0) && code <= (hi.codePointAt(0) ?? 0),
    );
  };
  return (cp) => cp !== '/' && inItems(cp) !== atom.negated;
}

class Builder {
  readonly nodes: Node[] = [];
  add(node: Node): number {
    this.nodes.push(node);
    return this.nodes.length - 1;
  }
  atom(atom: Atom, next: number): number {
    switch (atom.kind) {
      case 'lit':
        return this.add({ kind: 'char', accepts: (cp) => cp === atom.value, next });
      case 'star':
        return this.add({ kind: 'star', next });
      case 'any':
        return this.add({ kind: 'char', accepts: notSlash, next });
      case 'class':
        return this.add({ kind: 'char', accepts: classAccepts(atom), next });
      case 'alt':
        return this.add({ kind: 'eps', nexts: atom.alts.map((alt) => this.atoms(alt, next)) });
    }
  }
  atoms(atoms: Atom[], next: number): number {
    return atoms.reduceRight((following, atom) => this.atom(atom, following), next);
  }
}

// SPEC §8.2: a position-set simulation, linear in the path for a pattern, never backtracking
export function compileGlob(segments: Segment[]): Glob {
  const b = new Builder();
  let next = b.add({ kind: 'match' });
  const slashTo = (target: number) => b.add({ kind: 'char', accepts: isSlash, next: target });
  segments.toReversed().forEach((segment, offset) => {
    const last = offset === 0;
    if (segment.kind === 'parts') {
      next = b.atoms(segment.atoms, last ? next : slashTo(next));
      return;
    }
    const body = b.add({ kind: 'eps', nexts: [] });
    const first = b.add({ kind: 'char', accepts: notSlash, next: body });
    const more = b.add({ kind: 'char', accepts: notSlash, next: body });
    if (last) {
      b.nodes[body] = { kind: 'eps', nexts: [more, next, slashTo(first)] };
      next = first;
      return;
    }
    const loop = b.add({ kind: 'eps', nexts: [next, first] });
    b.nodes[body] = { kind: 'eps', nexts: [more, slashTo(loop)] };
    next = loop;
  });
  const start = next;
  const { nodes } = b;
  const close = (into: Set<number>, id: number): void => {
    if (into.has(id)) return;
    into.add(id);
    const node = nodes[id]!;
    if (node.kind === 'eps') node.nexts.forEach((n) => close(into, n));
    else if (node.kind === 'star') close(into, node.next);
  };
  return {
    test(path) {
      let states = new Set<number>();
      close(states, start);
      for (const cp of path) {
        const advanced = new Set<number>();
        for (const id of states) {
          const node = nodes[id]!;
          if (node.kind === 'char' && node.accepts(cp)) close(advanced, node.next);
          else if (node.kind === 'star' && cp !== '/') close(advanced, id);
        }
        if (advanced.size === 0) return false;
        states = advanced;
      }
      return [...states].some((id) => nodes[id]!.kind === 'match');
    },
  };
}

const cache = new WeakMap<ParsedPattern, Glob>();
function regexOf(pattern: ParsedPattern): Glob {
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
