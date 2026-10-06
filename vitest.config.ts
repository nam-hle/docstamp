import { defineConfig } from 'vitest/config';

// e2e tests spawn the CLI and git; slower runners need more than the 5s default.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 } });
