import { createHash } from 'node:crypto';
import { definePlugin } from 'docstamp';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const parseHeading = (line: string) => {
  const [, marks = '', title = ''] = /^(#{1,6})\s+(.*?)\s*$/u.exec(line) ?? [];
  return marks === '' ? undefined : { level: marks.length, title };
};

// Hashes the body of every heading titled <select>, of any level, up to the next heading of
// the same or a higher level.
export default definePlugin({
  name: 'headings',
  apiVersion: 1,
  files: ['**/*.md'],
  extract({ text, select }) {
    const lines = text.split('\n');
    const hashes: string[] = [];
    lines.forEach((line, index) => {
      const heading = parseHeading(line);
      if (heading?.title !== select) return;
      const end = lines.findIndex(
        (next, i) => i > index && (parseHeading(next)?.level ?? Infinity) <= heading.level,
      );
      hashes.push(sha(lines.slice(index + 1, end === -1 ? undefined : end).join('\n')));
    });
    return { hashes };
  },
});
