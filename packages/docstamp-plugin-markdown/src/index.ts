import type { DocstampPlugin, ExtractInput, ExtractResult, Part } from 'docstamp';

import { parseSelector, type Selector } from './selector.ts';
import { body, headings, sectionEnd } from './sections.ts';

const countLines = (text: string): number => text.split('\n').length - 1;

// the 1-based line of the character at `offset` in `source`
const lineAt = (source: string, offset: number): number => 1 + countLines(source.slice(0, offset));

const problem = (message: string): ExtractResult => ({
  diagnostics: [{ severity: 'error', message }],
});

// SPEC §8.7: a focus is one line
const oneLine = (text: string): string =>
  Array.from(text, (character) => {
    const code = character.codePointAt(0)!;
    return code < 0x20 || code === 0x7f ? ' ' : character;
  }).join('');

const BAD_SELECTOR =
  'The selector is not valid for headings; write the text of a heading, such as Install, or ' +
  '{ heading: Install, level: 2 } with a level from 1 to 6.';

// SPEC §6
function extract({ text, select }: ExtractInput): ExtractResult {
  let selector: Selector;
  try {
    selector = parseSelector(select);
  } catch {
    return problem(BAD_SELECTOR);
  }
  const stripped = body(text);
  const source = stripped.replaceAll('\r\n', '\n');
  const skipped = countLines(text.slice(0, text.length - stripped.length).replaceAll('\r\n', '\n'));
  const all = headings(source);
  const found = all.flatMap((heading, index) => {
    if (heading.text !== selector.heading) return [];
    if (selector.level !== undefined && heading.depth !== selector.level) return [];
    const end = sectionEnd(all, index, source.length);
    const part: Part = {
      content: source.slice(heading.start, end),
      focus: `section "${oneLine(heading.text)}" (level ${heading.depth})`,
      lines: {
        start: skipped + lineAt(source, heading.start),
        end: skipped + lineAt(source, end - 1),
      },
    };
    return [part];
  });
  if (found.length === 0) return {};
  if (found.length > 1) {
    const where = found.map((part) => part.lines!.start).join(', ');
    return problem(
      `The heading "${oneLine(selector.heading)}" appears at lines ${where}; ` +
        'add a level to the selector, or rename one of them.',
    );
  }
  return { parts: found };
}

// SPEC §3
const plugin = {
  name: 'docstamp-plugin-markdown',
  apiVersion: 1,
  files: ['**/*.md', '**/*.markdown'],
  extract,
} satisfies DocstampPlugin;

export default plugin;
