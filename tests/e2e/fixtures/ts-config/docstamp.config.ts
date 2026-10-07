import { defineConfig } from 'docstamp';

export default defineConfig({
  version: 2,
  files: { 'CLAUDE.md': { dependencies: ['src/**'] } },
});
