// SPEC §13.11: plain text, LF, at most 100 columns
const WIDTH = 100;

export interface Example {
  readonly args: readonly string[];
  // standard output on the help-examples test tree, when the page shows it
  readonly out?: string;
  readonly exit?: number;
}

function wrap(text: string, indent: string, hanging = indent): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u).filter((w) => w !== '')) {
    if (line === '') line = indent + word;
    else if (line.length + 1 + word.length > WIDTH) {
      lines.push(line);
      line = hanging + word;
    } else line += ` ${word}`;
  }
  if (line !== '') lines.push(line);
  return lines;
}

// Paragraphs are separated by a blank line. An indented paragraph is kept verbatim, a paragraph
// of `- ` lines is a list with one item per line, any other paragraph is wrapped.
export function prose(body: string, indent = ''): string {
  return body
    .replace(/^\n+|\s+$/gu, '')
    .split(/\n\s*\n/u)
    .map((paragraph) => {
      const lines = paragraph.split('\n');
      if (lines.every((l) => l.startsWith(' '))) return lines.map((l) => indent + l).join('\n');
      if (lines.every((l) => l.startsWith('- '))) {
        return lines.flatMap((l) => wrap(l.slice(2), `${indent}- `, `${indent}  `)).join('\n');
      }
      return wrap(paragraph, indent).join('\n');
    })
    .join('\n\n');
}

export function table(rows: readonly (readonly [string, string])[], indent = '  '): string {
  const width = Math.max(...rows.map(([key]) => key.length));
  const pad = ' '.repeat(indent.length + width + 2);
  return rows
    .flatMap(([key, text]) => wrap(text, `${indent}${key.padEnd(width)}  `, pad))
    .join('\n');
}

export function examples(list: readonly Example[]): string {
  return list
    .map((e) => {
      const command = `  $ ${['docstamp', ...e.args].join(' ')}`;
      const out = (e.out ?? '').split('\n').filter((line, i, all) => i < all.length - 1 || line);
      return [command, ...out.map((line) => `  ${line}`)].join('\n');
    })
    .join('\n');
}
