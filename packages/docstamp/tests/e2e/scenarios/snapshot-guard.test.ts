import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { slugOf } from '../../harness/core.ts';
import { E2E_DIR } from '../harness/repo.ts';

// Both suites keep their snapshots in a folder per scenario: the real ones under tests/e2e, the
// in-process ones under tests/scenarios.
const suites = [
  { name: 'e2e', dir: join(E2E_DIR, 'scenarios'), snapshots: join(E2E_DIR, '__snapshots__') },
  {
    name: 'scenarios',
    dir: join(E2E_DIR, '..', 'scenarios'),
    snapshots: join(E2E_DIR, '..', 'scenarios', '__snapshots__'),
  },
];

const scenarioNames = (dir: string): string[] =>
  readdirSync(dir)
    .filter((file) => file.endsWith('.test.ts'))
    .flatMap((file) => {
      const source = readFileSync(join(dir, file), 'utf8');
      return [...source.matchAll(/\bscenario\(\s*'((?:[^'\\]|\\.)*)'/gu)].map((m) => m[1]!);
    });

const snapshotFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? snapshotFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );

describe.each(suites)('snapshots of the $name suite', ({ dir, snapshots }) => {
  it('hold no raw CR: .gitattributes eol=lf would strip it on checkout', () => {
    const raw = snapshotFiles(snapshots).filter((file) =>
      readFileSync(file, 'utf8').includes('\r'),
    );
    expect(raw, 'the harness must render CR as ␍ (U+240D) and the BOM as <BOM>').toEqual([]);
  });

  it('were not left behind by a removed or renamed scenario', () => {
    const known = new Set(scenarioNames(dir).map(slugOf));
    expect(known.size).toBeGreaterThan(5);
    const entries = existsSync(snapshots) ? readdirSync(snapshots) : [];
    const obsolete = entries.filter(
      (entry) => !known.has(entry) || !statSync(join(snapshots, entry)).isDirectory(),
    );
    expect(obsolete, `delete these under ${snapshots}`).toEqual([]);
  });
});

it('names every scenario once across both suites', () => {
  const all = suites.flatMap(({ dir }) => scenarioNames(dir).map(slugOf));
  expect(all.filter((slug, index) => all.indexOf(slug) !== index)).toEqual([]);
});
