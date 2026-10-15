import { defineConfig } from 'docstamp';
import notes from './tools/notes.ts';

export default defineConfig({
  version: 2,
  plugins: [notes],
  files: {
    'docs/notes.txt': { dependencies: ['src/b.ts'] },
    'README.md': { dependencies: ['src/b.ts'] },
  },
});
