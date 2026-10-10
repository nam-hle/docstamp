import { configDefaults, defineConfig } from 'vitest/config';

// e2e tests spawn the CLI and git; slower runners need more than the 5s default.
// Fixture trees are data copied into temp repos, never test files.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/e2e/fixtures/**'],
    testTimeout: 30_000,
  },
});
