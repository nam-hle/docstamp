import { createHash } from 'node:crypto';
import { definePlugin } from 'docstamp';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const parseHeading = (line: string) => {
  const [, marks = '', title = ''] = /^(#{1,6})\s+(.*?)\s*$/u.exec(line) ?? [];
  return marks === '' ? undefined : { level: marks.length, title };
};

// Hashes the body of every heading titled <select>, of any level, up to the next heading of
// the same or a higher level; focus and lines tell the report what and where that part is.
export default definePlugin({
  name: 'headings',
  apiVersion: 1,
  files: ['**/*.md'],
  extract({ text, select }) {
    const lines = text.split('\n');
    const hashes: string[] = [];
    const focus: string[] = [];
    const ranges: { start: number; end: number }[] = [];
    lines.forEach((line, index) => {
      const heading = parseHeading(line);
      if (heading?.title !== select) return;
      const end = lines.findIndex(
        (next, i) => i > index && (parseHeading(next)?.level ?? Infinity) <= heading.level,
      );
      const stop = end === -1 ? lines.length : end;
      hashes.push(sha(lines.slice(index + 1, stop).join('\n')));
      focus.push(`section "${heading.title}" (level ${heading.level})`);
      ranges.push({ start: index + 1, end: stop });
    });
    return { hashes, focus, lines: ranges };
  },
});
