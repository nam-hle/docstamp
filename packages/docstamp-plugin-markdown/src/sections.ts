import { Lexer } from 'marked';

export interface Heading {
  readonly depth: number;
  readonly text: string;
  readonly start: number;
}

// SPEC §5.1
export function body(text: string): string {
  if (!text.startsWith('---\n')) return text;
  let offset = 4;
  while (offset <= text.length) {
    const end = text.indexOf('\n', offset);
    const line = text.slice(offset, end === -1 ? text.length : end);
    if (line === '---' || line === '...') return end === -1 ? '' : text.slice(end + 1);
    if (end === -1) return text;
    offset = end + 1;
  }
  return text;
}

// SPEC §5.2: the top-level blocks tile the source, so their `raw` strings give every offset
export function headings(source: string): Heading[] {
  const found: Heading[] = [];
  let offset = 0;
  for (const token of Lexer.lex(source, {
    gfm: true,
    pedantic: false,
    breaks: false,
  })) {
    if (token.type === 'heading')
      found.push({ depth: token.depth, text: token.text, start: offset });
    offset += token.raw.length;
  }
  if (offset !== source.length) throw new Error('The sections of the file could not be located.');
  return found;
}

// SPEC §5.3
export function sectionEnd(all: readonly Heading[], index: number, length: number): number {
  const { depth } = all[index]!;
  return all.slice(index + 1).find((next) => next.depth <= depth)?.start ?? length;
}
