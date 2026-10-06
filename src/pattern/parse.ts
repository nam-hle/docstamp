export type Atom =
  | { kind: 'lit'; value: string }
  | { kind: 'star' }
  | { kind: 'any' }
  | { kind: 'class'; negated: boolean; items: Array<[string, string]> }
  | { kind: 'alt'; alts: Atom[][] };
export type Segment = { kind: 'globstar' } | { kind: 'parts'; atoms: Atom[] };
export interface ParsedPattern {
  negated: boolean;
  segments: Segment[];
}

class Invalid extends Error {}

class Reader {
  private i = 0;
  private readonly cps: string[];
  constructor(src: string) {
    // oxlint-disable-next-line typescript/no-misused-spread -- code point split is intended
    this.cps = [...src];
  }
  peek(): string | undefined {
    return this.cps[this.i];
  }
  next(): string {
    const c = this.cps[this.i++];
    if (c === undefined) throw new Invalid();
    return c;
  }
  done(): boolean {
    return this.i >= this.cps.length;
  }
}

const LITERAL_STOP = new Set(['*', '?', '[', ']', '{', '}', ',', '/', '\\']);

function readEscape(r: Reader): string {
  const c = r.next();
  if (c === '/') throw new Invalid();
  return c;
}

interface ClassChar {
  value: string;
  escaped: boolean;
}

function readClass(r: Reader): Atom {
  let negated = false;
  if (r.peek() === '!') {
    r.next();
    negated = true;
  }
  const chars: ClassChar[] = [];
  while (r.peek() !== ']') {
    const c = r.next();
    if (c === '/') throw new Invalid();
    chars.push(c === '\\' ? { value: readEscape(r), escaped: true } : { value: c, escaped: false });
  }
  r.next();
  if (chars.length === 0) throw new Invalid();
  const items: Array<[string, string]> = [];
  for (let k = 0; k < chars.length; k++) {
    const lo = chars[k]!.value;
    const dash = chars[k + 1];
    const hi = chars[k + 2];
    if (dash?.value === '-' && !dash.escaped && hi !== undefined) {
      if ((lo.codePointAt(0) ?? 0) > (hi.value.codePointAt(0) ?? 0)) throw new Invalid();
      items.push([lo, hi.value]);
      k += 2;
    } else {
      items.push([lo, lo]);
    }
  }
  return { kind: 'class', negated, items };
}

function readAtoms(r: Reader, inAlt: boolean, alternation: boolean): Atom[] {
  const atoms: Atom[] = [];
  for (;;) {
    const c = r.peek();
    if (c === undefined || c === '/') break;
    if (inAlt && (c === ',' || c === '}')) break;
    r.next();
    if (c === '*') {
      if (atoms.at(-1)?.kind === 'star') throw new Invalid();
      atoms.push({ kind: 'star' });
    } else if (c === '?') atoms.push({ kind: 'any' });
    else if (c === '[') atoms.push(readClass(r));
    else if (c === '{') {
      if (inAlt || !alternation) throw new Invalid();
      const alts: Atom[][] = [];
      for (;;) {
        const alt = readAtoms(r, true, alternation);
        if (alt.length === 0) throw new Invalid();
        alts.push(alt);
        const sep = r.next();
        if (sep === '}') break;
        if (sep !== ',') throw new Invalid();
      }
      if (alts.length < 2) throw new Invalid();
      atoms.push({ kind: 'alt', alts });
    } else if (c === '\\') atoms.push({ kind: 'lit', value: readEscape(r) });
    else if (LITERAL_STOP.has(c)) throw new Invalid();
    else atoms.push({ kind: 'lit', value: c });
  }
  return atoms;
}

function isDotSegment(atoms: Atom[]): boolean {
  const text = atoms.map((a) => (a.kind === 'lit' ? a.value : '\u0000')).join('');
  return text === '.' || text === '..';
}

// SPEC §8.1
export function parsePattern(
  src: string,
  opts: { alternation?: boolean } = {},
): ParsedPattern | null {
  if (src.normalize('NFC') !== src) return null;
  const alternation = opts.alternation ?? true;
  const negated = src.startsWith('!');
  const body = negated ? src.slice(1) : src;
  if (body === '' || body.startsWith('/') || body.endsWith('/')) return null;
  try {
    const segments: Segment[] = body.split('/').map((raw) => {
      if (raw === '**') return { kind: 'globstar' } as const;
      const r = new Reader(raw);
      const atoms = readAtoms(r, false, alternation);
      if (!r.done() || atoms.length === 0 || isDotSegment(atoms)) throw new Invalid();
      return { kind: 'parts', atoms } as const;
    });
    return { negated, segments };
  } catch (e) {
    if (e instanceof Invalid) return null;
    throw e;
  }
}
