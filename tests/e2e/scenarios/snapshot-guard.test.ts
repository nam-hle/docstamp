import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { E2E_DIR } from '../harness/repo.ts';
import { slugOf } from '../harness/scenario.ts';

const scenarioNames = (): string[] =>
  readdirSync(join(E2E_DIR, 'scenarios'))
    .filter((file) => file.endsWith('.test.ts'))
    .flatMap((file) => {
      const source = readFileSync(join(E2E_DIR, 'scenarios', file), 'utf8');
      return [...source.matchAll(/\bscenario\(\s*'((?:[^'\\]|\\.)*)'/gu)].map((m) => m[1]!);
    });

it('no snapshot folder or file was left behind by a removed or renamed scenario', () => {
  const known = new Set(scenarioNames().map(slugOf));
  expect(known.size).toBeGreaterThan(50);
  const root = join(E2E_DIR, '__snapshots__');
  const entries = existsSync(root) ? readdirSync(root) : [];
  const obsolete = entries.filter(
    (entry) => !known.has(entry) || !statSync(join(root, entry)).isDirectory(),
  );
  expect(obsolete, 'delete these under tests/e2e/__snapshots__').toEqual([]);
});
