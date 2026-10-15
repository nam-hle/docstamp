import type {
  DocstampPlugin,
  ExtractInput,
  ExtractResult,
  Json,
  JsonSchema,
  Part,
  ValidateSelectResult,
} from 'docstamp';

import { mentions } from './mentions.ts';
import { notFound } from './not-found.ts';
import { parseSelect } from './parse-select.ts';
import { parseSelector, type Selector } from './selector.ts';
import { headings, sectionEnd, type Heading } from './sections.ts';

const problem = (code: string, message: string): ExtractResult => ({
  diagnostics: [{ severity: 'error', code, message }],
});

// SPEC §8.7: a focus is one line
const oneLine = (text: string): string =>
  Array.from(text, (character) => {
    const code = character.codePointAt(0)!;
    return code < 0x20 || code === 0x7f ? ' ' : character;
  }).join('');

const BAD_SELECTOR =
  'The selector is not valid for sections; write the title of a section, such as Install, ' +
  '{ title: Install, level: 2 } with a level from 1 to 6, or { anchor: install }.';

const matches = (selector: Selector, heading: Heading): boolean =>
  selector.kind === 'anchor'
    ? heading.anchor === selector.anchor
    : heading.title === selector.title &&
      (selector.level === undefined || heading.level === selector.level);

// SPEC §6
function extract({ text, select }: ExtractInput): ExtractResult {
  let selector: Selector;
  try {
    selector = parseSelector(select);
  } catch {
    return problem('invalid-selector', BAD_SELECTOR);
  }
  const source = text.replaceAll('\r\n', '\n');
  let all: Heading[];
  try {
    all = headings(source);
  } catch {
    return problem('parse-failed', 'The file could not be parsed as AsciiDoc.');
  }
  const lines = source.split('\n');
  const found = all.flatMap((heading, index) => {
    if (!matches(selector, heading)) return [];
    const end = sectionEnd(all, index, lines.length);
    const content = lines.slice(heading.start - 1, end).join('\n');
    const lastLine = end === lines.length && lines[end - 1] === '' ? end - 1 : end;
    const part: Part = {
      content: end < lines.length ? `${content}\n` : content,
      focus: `section "${oneLine(heading.title)}" (level ${heading.level})`,
      lines: { start: heading.start, end: Math.max(heading.start, lastLine) },
    };
    return [part];
  });
  if (found.length === 0) {
    const located = all.map((heading) => ({ ...heading, line: heading.titleLine }));
    return notFound(selector, located, oneLine);
  }
  if (found.length > 1) {
    const where = found.map((part) => part.lines!.start).join(', ');
    const what =
      selector.kind === 'anchor'
        ? `The anchor "${oneLine(selector.anchor)}"`
        : `The title "${oneLine(selector.title)}"`;
    return problem(
      'ambiguous-section',
      `${what} selects sections at lines ${where}; ` +
        'add a level or an anchor to the selector, or rename one of them.',
    );
  }
  return { parts: found };
}

// SPEC §6.1
function validateSelect(select: Json): ValidateSelectResult {
  try {
    parseSelector(select);
    return {};
  } catch {
    return problem('invalid-selector', BAD_SELECTOR);
  }
}

// SPEC §3: the shape of a select, checked by docstamp before ValidateSelect
const schema: JsonSchema = {
  type: ['string', 'object'],
  minLength: 1,
  properties: {
    title: { type: 'string', minLength: 1 },
    level: { type: 'integer', minimum: 1, maximum: 6 },
    anchor: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

// SPEC §3
const plugin = {
  name: 'docstamp-plugin-asciidoc',
  apiVersion: 1,
  files: ['**/*.adoc', '**/*.asciidoc', '**/*.asc'],
  extract,
  validateSelect,
  parseSelect,
  mentions,
  meta: { schema },
} satisfies DocstampPlugin;

export default plugin;
