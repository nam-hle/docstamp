import { defineConfig } from 'docstamp';
import headings from './tools/headings.ts';

export default defineConfig({
  version: 2,
  plugins: [headings],
  files: {
    'CLAUDE.md': {
      dependencies: ['src/**', { path: 'docs/guide.md', select: 'Install' }],
    },
  },
});
