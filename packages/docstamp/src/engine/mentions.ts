import { posix } from 'node:path';
import { scanFrontmatter } from '../inline/frontmatter.ts';

const FENCE_OPEN = /^ {0,3}(?:(~{3,})|(`{3,})(?=[^`\r\n]*\r?\n?$))/u;
const FENCE_CLOSE = /^ {0,3}(`+|~+)[ \t]*\r?\n?$/u;
const SPAN = /(?<!`)(`+)(?!`)([^\n]*?)(?<!`)\1(?!`)/gu;
const INLINE_LINK = /\]\([ \t]*(?:<([^<>\r\n]*)>|([^\s()]*))/gu;
const DEFINITION = /^ {0,3}\[[^\]\r\n]+\]:[ \t]*(?:<([^<>\r\n]*)>|(\S+))/gmu;
const SEPARATORS = /[\s`()<>"'|;]+/u;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

// SPEC §12.6 step 1: the lines of the text that are neither the inline block nor fenced
function proseOf(text: string): string {
  const scan = scanFrontmatter(text);
  const all = scan?.lines ?? text.replace(/^﻿/u, '').split(/(?<=\n)/u);
  const lines = scan === null ? all : all.filter((_, i) => i < scan.marker || i > scan.last);
  const prose: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    if (fence === null) {
      const open = FENCE_OPEN.exec(line);
      if (open === null) prose.push(line);
      else fence = open[1] ?? open[2]!;
    } else {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close !== undefined && close[0] === fence[0] && close.length >= fence.length)
        fence = null;
    }
  }
  return prose.join('');
}

// SPEC §12.6 step 5, the part both kinds share
function finish(word: string): string | null {
  const segments = word.split('/');
  const bad =
    word === '' ||
    SCHEME.test(word) ||
    word.startsWith('!') ||
    word.includes('\\') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  return bad ? null : word.normalize('NFC');
}

// SPEC §12.6 step 5: NormalizeWord
function normalizeWord(word: string, bare: boolean): string | null {
  const unpunctuated = bare ? word.replace(/[.,;:!]+$/u, '') : word;
  const unlined = unpunctuated.replace(/:\d+(?::\d+)?$/u, '');
  const hash = unlined.indexOf('#');
  const cut = hash === -1 ? unlined : unlined.slice(0, hash);
  return finish(
    cut
      .replace(/^(?:\.\/)+/u, '')
      .replace(/^\//u, '')
      .replace(/\/+$/u, ''),
  );
}

// SPEC §12.6 step 5: NormalizeLink
function normalizeLink(target: string, docDir: string): string | null {
  const cut = target.search(/[#?]/u);
  const raw = cut === -1 ? target : target.slice(0, cut);
  if (raw === '' || raw.startsWith('//') || SCHEME.test(raw)) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // a malformed escape leaves the target as written
  }
  const resolved = decoded.startsWith('/')
    ? posix.normalize(decoded.slice(1))
    : posix.join(docDir, decoded);
  if (resolved === '.' || resolved === '..' || resolved.startsWith('../')) return null;
  return finish(resolved.replace(/\/+$/u, ''));
}

// SPEC §12.6 steps 1 to 5: the paths a text mentions, normalized, in no particular order
export function mentionedPaths(text: string, docDir: string): string[] {
  let prose = proseOf(text);
  const found = new Set<string>();
  const add = (candidate: string | null) => {
    if (candidate !== null) found.add(candidate);
  };
  prose = prose.replace(SPAN, (_, __, content: string) => {
    const word = content.trim();
    if (word !== '' && !/\s/u.test(word)) add(normalizeWord(word, false));
    return ' ';
  });
  const link = (_: string, angled: string | undefined, plain: string | undefined) => {
    add(normalizeLink(angled ?? plain ?? '', docDir));
    return ' ';
  };
  prose = prose.replace(INLINE_LINK, link).replace(DEFINITION, link);
  for (const word of prose.split(SEPARATORS)) {
    if (word.includes('/') && !word.startsWith('*')) add(normalizeWord(word, true));
  }
  return [...found];
}
