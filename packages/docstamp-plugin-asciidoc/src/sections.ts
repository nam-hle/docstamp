import asciidoctor, { type Asciidoctor } from '@asciidoctor/core';

import { trimBlanks } from './selector.ts';

export interface Heading {
  readonly level: number;
  readonly title: string;
  readonly anchor: string | undefined;
  readonly titleLine: number;
  readonly start: number;
}

interface ParsedBlock {
  getContext(): string;
  getBlocks(): ParsedBlock[];
}

interface ParsedSection extends ParsedBlock {
  getLevel(): number;
  getId(): string | null | undefined;
  getLineNumber(): number;
}

const isBlank = (character: string | undefined): boolean => character === ' ' || character === '\t';

let processor: Asciidoctor | undefined;

// The logger is global and prints to stderr; a plugin must not.
function engine(): Asciidoctor {
  if (processor === undefined) {
    processor = asciidoctor();
    processor.LoggerManager.setLogger(processor.NullLogger.create());
  }
  return processor;
}

// SPEC §5.3: the title of the line as written, without its marker and closing marker
export function titleText(line: string): string {
  const marker = line[0] === '=' || line[0] === '#' ? line[0] : undefined;
  let start = 0;
  while (marker !== undefined && line[start] === marker) start += 1;
  if (marker === undefined || !isBlank(line[start])) return trimBlanks(line);
  while (isBlank(line[start])) start += 1;
  let end = line.length;
  while (end > start && isBlank(line[end - 1])) end -= 1;
  let closing = end;
  while (closing > start && line[closing - 1] === marker) closing -= 1;
  if (closing < end && closing > start && isBlank(line[closing - 1])) end = closing - 1;
  while (end > start && isBlank(line[end - 1])) end -= 1;
  return line.slice(start, end);
}

// SPEC §5.4: a line of block attributes or an anchor, such as `[#id]` or `[[id]]`
const isAttributeLine = (line: string): boolean => {
  const text = trimBlanks(line);
  return text.length > 2 && text.startsWith('[') && text.endsWith(']');
};

function sectionsOf(block: ParsedBlock): ParsedSection[] {
  return block
    .getBlocks()
    .flatMap((child) =>
      child.getContext() === 'section' ? [child as ParsedSection, ...sectionsOf(child)] : [],
    );
}

// SPEC §5.2: every section of the source, in source order
export function headings(source: string): Heading[] {
  const document = engine().load(source, {
    safe: 'secure',
    sourcemap: true,
    attributes: { sectids: false },
  });
  const lines = source.split('\n');
  const parsed = sectionsOf(document as unknown as ParsedBlock);
  const found: Heading[] = [];
  for (const section of parsed) {
    const titleLine = section.getLineNumber();
    let start = titleLine;
    while (start > 1 && isAttributeLine(lines[start - 2] ?? '')) start -= 1;
    found.push({
      level: section.getLevel() + 1,
      title: titleText(lines[titleLine - 1] ?? ''),
      anchor: section.getId() ?? undefined,
      titleLine,
      start,
    });
  }
  return found;
}

// SPEC §5.5: the last line of the section of `all[index]`
export function sectionEnd(all: readonly Heading[], index: number, lastLine: number): number {
  const { level } = all[index]!;
  const next = all.slice(index + 1).find((heading) => heading.level <= level);
  return next === undefined ? lastLine : next.start - 1;
}
