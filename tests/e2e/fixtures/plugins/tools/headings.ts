import { createHash } from 'node:crypto';
import { definePlugin } from 'docstamp';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const levelOf = (line: string) => /^(#+)\s/u.exec(line)?.[1]?.length;

// Hashes the body of every "## <select>" section up to the next heading of the same or higher level.
export default definePlugin({
  name: 'headings',
  apiVersion: 1,
  files: ['**/*.md'],
  extract({ text, select }) {
    const lines = text.split('\n');
    const hashes: string[] = [];
    lines.forEach((line, index) => {
      const heading = /^(#{1,6})\s+(.*?)\s*$/u.exec(line);
      if (heading?.[2] !== select) return;
      const end = lines.findIndex(
        (next, i) => i > index && (levelOf(next) ?? Infinity) <= heading[1]!.length,
      );
      hashes.push(sha(lines.slice(index + 1, end === -1 ? undefined : end).join('\n')));
    });
    return { hashes };
  },
});
