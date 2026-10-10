import { createHash } from 'node:crypto';
import type { DocstampPlugin, ExtractInput, ExtractResult } from 'docstamp';

import { parseSelector } from './selector.ts';
import { body, headings, sectionEnd } from './sections.ts';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const countLines = (text: string): number => text.split('\n').length - 1;

// the 1-based line of the character at `offset` in `source`
const lineAt = (source: string, offset: number): number => 1 + countLines(source.slice(0, offset));

// SPEC §6
function extract({ text, select }: ExtractInput): ExtractResult {
  const selector = parseSelector(select);
  const stripped = body(text);
  const source = stripped.replaceAll('\r\n', '\n');
  const skipped = countLines(text.slice(0, text.length - stripped.length).replaceAll('\r\n', '\n'));
  const all = headings(source);
  const found = all.flatMap((heading, index) => {
    if (heading.text !== selector.heading) return [];
    if (selector.level !== undefined && heading.depth !== selector.level) return [];
    const end = sectionEnd(all, index, source.length);
    return [
      {
        hash: sha256(source.slice(heading.start, end)),
        focus: `section "${heading.text}" (level ${heading.depth})`,
        lines: {
          start: skipped + lineAt(source, heading.start),
          end: skipped + lineAt(source, end - 1),
        },
      },
    ];
  });
  return {
    hashes: found.map((part) => part.hash),
    ...(found.length === 0
      ? {}
      : { focus: found.map((part) => part.focus), lines: found.map((part) => part.lines) }),
  };
}

// SPEC §3
const plugin = {
  name: 'docstamp-plugin-markdown',
  apiVersion: 1,
  files: ['**/*.md', '**/*.markdown'],
  extract,
} satisfies DocstampPlugin;

export default plugin;
