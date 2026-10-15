import { definePlugin } from 'docstamp';

// A doc format of its own: `see: <path>` lines are links, relative to the doc, `use: <path>` lines
// are paths from Root. A `.txt` file has no section to select, so extract returns the whole text.
const read = (text: string, key: string): string[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith(`${key}: `))
    .map((line) => line.slice(key.length + 2).trim());

export default definePlugin({
  name: 'notes',
  apiVersion: 1,
  files: ['**/*.txt'],
  extract: ({ text }) => ({ parts: [{ content: text }] }),
  mentions: ({ text }) => ({ links: read(text, 'see'), words: read(text, 'use') }),
});
