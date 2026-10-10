import { rmSync } from 'node:fs';
import { defineConfig } from 'tsup';

// tsup's own `clean` would race the declarations tsc emits afterwards, so dist is emptied here.
rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  splitting: false,
  external: ['@babel/parser', 'docstamp'],
});
