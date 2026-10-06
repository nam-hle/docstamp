import { readFileSync, rmSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Both builds run in parallel, so tsup's own `clean` would race the other build.
rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node24',
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
    define: { VERSION: JSON.stringify(pkg.version) },
  },
  {
    entry: ['src/lib.ts'],
    format: ['esm'],
    target: 'node24',
    splitting: false,
  },
]);
