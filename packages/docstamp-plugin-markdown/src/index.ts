import { createHash } from 'node:crypto';
import type { DocstampPlugin, ExtractInput } from 'docstamp';

import { parseSelector } from './selector.ts';
import { body, headings, sectionEnd } from './sections.ts';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

// SPEC §6
function extract({ text, select }: ExtractInput): { hashes: string[] } {
  const selector = parseSelector(select);
  const source = body(text).replaceAll('\r\n', '\n');
  const all = headings(source);
  const hashes = all.flatMap((heading, index) => {
    if (heading.text !== selector.heading) return [];
    if (selector.level !== undefined && heading.depth !== selector.level) return [];
    return [sha256(source.slice(heading.start, sectionEnd(all, index, source.length)))];
  });
  return { hashes };
}

// SPEC §3
const plugin = {
  name: 'docstamp-plugin-markdown',
  apiVersion: 1,
  files: ['**/*.md', '**/*.markdown'],
  extract,
} satisfies DocstampPlugin;

export default plugin;
