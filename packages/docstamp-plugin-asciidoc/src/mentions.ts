import type { MentionsInput, MentionsResult } from 'docstamp';

import { trimBlanks } from './selector.ts';

const DELIMITERS = new Set(['-', '.', '/', '+']);
const MACROS = ['include::', 'image::', 'image:', 'link:', 'xref:'];
const SEPARATORS = new Set([' ', '\t', '`', '(', ')', '<', '>', '"', "'", '|', ';', '[', ']']);
const TRAILING = new Set(['.', ',', ';', ':', '!']);

const isBlank = (character: string | undefined): boolean => character === ' ' || character === '\t';

// SPEC §7.1 step 1: the code point of a delimiter line, else undefined
function delimiterOf(line: string): string | undefined {
  let end = line.length;
  while (end > 0 && isBlank(line[end - 1])) end -= 1;
  const first = line[0];
  if (end < 4 || first === undefined || !DELIMITERS.has(first)) return undefined;
  for (let index = 1; index < end; index += 1) if (line[index] !== first) return undefined;
  return line.slice(0, end);
}

// SPEC §7.1 step 2: the macros of a line, as links, and the line with each replaced by a blank
function macros(line: string): { links: string[]; rest: string } {
  const links: string[] = [];
  let rest = line;
  for (const name of MACROS) {
    let from = 0;
    for (;;) {
      const at = rest.indexOf(name, from);
      if (at === -1) break;
      from = at + name.length;
      if (at > 0 && !isBlank(rest[at - 1])) continue;
      const open = rest.indexOf('[', from);
      if (open === -1) continue;
      const target = rest.slice(from, open);
      const close = rest.indexOf(']', open);
      const stop = close === -1 ? rest.length : close + 1;
      if (target !== '' && !/[ \t{]/u.test(target)) links.push(target);
      rest = `${rest.slice(0, at)} ${rest.slice(stop)}`;
      from = at + 1;
    }
  }
  return { links, rest };
}

// SPEC §7.1 steps 3 and 4: the span words and the bare words of a line without macros
function words(line: string): string[] {
  const found: string[] = [];
  let prose = '';
  let from = 0;
  for (;;) {
    const open = line.indexOf('`', from);
    const close = open === -1 ? -1 : line.indexOf('`', open + 1);
    if (close === -1) {
      prose += line.slice(from);
      break;
    }
    prose += `${line.slice(from, open)} `;
    const content = trimBlanks(line.slice(open + 1, close));
    if (content !== '' && !/[ \t]/u.test(content)) found.push(content);
    from = close + 1;
  }
  let current = '';
  const flush = (): void => {
    if (current.includes('/') && !current.startsWith('*')) {
      let end = current.length;
      while (end > 0 && TRAILING.has(current[end - 1]!)) end -= 1;
      found.push(current.slice(0, end));
    }
    current = '';
  };
  for (const character of prose) {
    if (SEPARATORS.has(character)) flush();
    else current += character;
  }
  flush();
  return found;
}

// SPEC §7.1
export function mentions({ text }: MentionsInput): MentionsResult {
  const links: string[] = [];
  const found: string[] = [];
  let closing: string | undefined;
  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    const delimiter = delimiterOf(line);
    if (closing !== undefined) {
      if (delimiter === closing) closing = undefined;
      else if (closing[0] !== '/' && line.startsWith('include::'))
        links.push(...macros(line).links);
      continue;
    }
    if (delimiter !== undefined) {
      closing = delimiter;
      continue;
    }
    if (line.startsWith('//')) continue;
    const read = macros(line);
    links.push(...read.links);
    found.push(...words(read.rest));
  }
  return { links, words: found };
}
