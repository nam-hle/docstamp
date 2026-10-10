import { definePlugin, type Part } from 'docstamp';

const parseHeading = (line: string) => {
  const [, marks = '', title = ''] = /^(#{1,6})\s+(.*?)\s*$/u.exec(line) ?? [];
  return marks === '' ? undefined : { level: marks.length, title };
};

// The body of the heading titled <select>, of any level, up to the next heading of the same or a
// higher level. Two such headings are an error; an empty body is a warning.
export default definePlugin({
  name: 'headings',
  apiVersion: 1,
  files: ['**/*.md'],
  extract({ text, select }) {
    const lines = text.split('\n');
    const found: Array<Part & { level: number }> = [];
    lines.forEach((line, index) => {
      const heading = parseHeading(line);
      if (heading?.title !== select) return;
      const end = lines.findIndex(
        (next, i) => i > index && (parseHeading(next)?.level ?? Infinity) <= heading.level,
      );
      const stop = end === -1 ? lines.length : end;
      found.push({
        level: heading.level,
        content: lines.slice(index + 1, stop).join('\n'),
        focus: `section "${heading.title}" (level ${heading.level})`,
        lines: { start: index + 1, end: stop },
      });
    });
    if (found.length > 1) {
      const where = found.map((part) => part.lines!.start).join(', ');
      return {
        diagnostics: [
          { severity: 'error', message: `"${String(select)}" is a heading at lines ${where}; rename one.` },
        ],
      };
    }
    const [part] = found;
    if (part === undefined) return {};
    const { content, focus, lines: range } = part;
    const empty = content.trim() === '';
    return {
      parts: [{ content, focus, lines: range }],
      ...(empty
        ? {
            diagnostics: [
              { severity: 'warning', message: `The section "${String(select)}" is empty; write it.` },
            ],
          }
        : {}),
    };
  },
});
