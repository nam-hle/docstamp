import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE = join(import.meta.dirname, '../..');

const PROSE_ONLY: Record<string, string> = {
  '1': 'scope: what docstamp is and is not',
  '3.1': 'notation of algorithms',
  '3.2': 'notation of data',
  '17.1': 'definitions of release and breaking',
  '17.2': 'catalogue of breaking changes, enforced through §17.7 vectors',
  '17.6': 'how versions and migration notes are announced',
};

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );

const textOf = (dir: string, extension: string): string =>
  filesUnder(join(PACKAGE, dir))
    .filter((file) => file.endsWith(extension) && !file.endsWith('spec-coverage.test.ts'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

const specClauses = (): string[] =>
  filesUnder(join(PACKAGE, 'docs/spec'))
    .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/^#{2,5} (\d+(?:\.\d+)*)\.? /gmu)])
    .map((match) => match[1]!.replace(/\.$/u, ''));

const leavesOf = (clauses: string[]): string[] =>
  clauses.filter((clause) => !clauses.some((other) => other.startsWith(`${clause}.`)));

const idsMatching = (text: string, pattern: RegExp): Set<string> =>
  new Set([...text.matchAll(pattern)].map((match) => match[1]!.replace(/\.$/u, '')));

const citedInSource = idsMatching(textOf('src', '.ts'), /§(\d+(?:\.\d+)*)/gu);
const namedByTest = idsMatching(
  textOf('tests', '.ts'),
  /\b(?:describe|scenario|it|test)(?:\.\w+)?\(\s*['"`]§(\d+(?:\.\d+)*)/gu,
);

const coveredBy = (ids: Set<string>, clause: string): boolean => ids.has(clause);

describe('SPEC clause coverage', () => {
  const clauses = specClauses();

  it('finds the clauses of the spec', () => {
    expect(clauses.length).toBeGreaterThan(80);
  });

  it('every clause is cited in src/ or names a test, or is allowed as prose', () => {
    const uncovered = leavesOf(clauses).filter(
      (clause) =>
        !(clause in PROSE_ONLY) &&
        !coveredBy(citedInSource, clause) &&
        !coveredBy(namedByTest, clause),
    );
    expect(uncovered).toEqual([]);
  });

  it('the allow-list names only clauses that exist and are not otherwise covered', () => {
    const stale = Object.keys(PROSE_ONLY).filter(
      (clause) =>
        !clauses.includes(clause) ||
        coveredBy(citedInSource, clause) ||
        coveredBy(namedByTest, clause),
    );
    expect(stale).toEqual([]);
  });
});
