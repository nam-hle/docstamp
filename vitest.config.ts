import { defineConfig } from 'vitest/config';

// The Action's tests sit next to its code at the repository root; the packages have their own.
export default defineConfig({
  test: { include: ['action/**/*.test.ts'] },
});
