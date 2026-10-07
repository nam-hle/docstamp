import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run, type Io } from '../../src/cli/run.ts';
import { cleanupTrees, makeTree, type TreeSpec } from '../helpers/fixture.ts';

afterEach(cleanupTrees);

function exec(cwd: string, ...argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = { stdout: (s) => (out += s), stderr: (s) => (err += s), isTty: false, env: {} };
  return { code: run(argv, cwd, io), out, err };
}

const config = (files: Record<string, string[]>): string =>
  `version: 2\nfiles:\n${Object.entries(files)
    .map(([file, deps]) => `  ${file}:\n    dependencies: [${deps.join(', ')}]\n`)
    .join('')}`;

const tree = (files: Record<string, string[]>, extra: TreeSpec = {}) =>
  makeTree({
    'docstamp.yaml': config(files),
    'a.md': 'a',
    'b.md': 'b',
    'src/x.ts': 'x',
    'src/gen/y.ts': 'y',
    ...extra,
  });

describe('§13.8 list-dependents', () => {
  const cmd = 'list-dependents';

  it('matches through a directory pattern', () => {
    const root = tree({ 'a.md': ['src'] });
    expect(exec(root, cmd, 'src/x.ts')).toEqual({
      code: 0,
      out: 'src/x.ts\n  a.md   via src\n',
      err: '',
    });
  });

  it('lists every pattern that matched, and aligns the rows', () => {
    const root = tree({ 'a.md': ['src/**', '"src/*.ts"'], 'b.md': ['src/x.ts'] });
    expect(exec(root, cmd, 'src/x.ts').out).toBe(
      'src/x.ts\n  a.md   via src/**, src/*.ts\n  b.md   via src/x.ts\n',
    );
  });

  it('a negation excludes the file and is never listed in via', () => {
    const root = tree({ 'a.md': ['src/**', '"!src/gen/**"'] });
    expect(exec(root, cmd, 'src/gen/y.ts').out).toBe('src/gen/y.ts\n  (no dependents)\n');
    expect(exec(root, cmd, 'src/x.ts').out).toBe('src/x.ts\n  a.md   via src/**\n');
  });

  it('an ignored or absent file has no dependents, exit 0', () => {
    const root = tree({ 'a.md': ['src/**'] }, { '.gitignore': 'src/gen\n' });
    expect(exec(root, cmd, 'src/gen/y.ts')).toEqual({
      code: 0,
      out: 'src/gen/y.ts\n  (no dependents)\n',
      err: '',
    });
    expect(exec(root, cmd, 'nope/missing.ts').code).toBe(0);
  });

  it('a stamped file may be the argument, but never its own file', () => {
    const root = tree({ 'a.md': ['b.md', 'a.md'], 'b.md': ['src/**'] });
    expect(exec(root, cmd, 'b.md').out).toBe('b.md\n  a.md   via b.md\n');
    expect(exec(root, cmd, 'a.md').out).toBe('a.md\n  (no dependents)\n');
  });

  it('is direct only, no transitive closure', () => {
    const root = tree({ 'a.md': ['b.md'], 'b.md': ['src/**'] });
    expect(exec(root, cmd, 'src/x.ts').out).toBe('src/x.ts\n  b.md   via src/**\n');
  });

  it('resolves arguments against cwd, dedupes and sorts', () => {
    const root = tree({ 'a.md': ['src/**'] });
    const r = exec(join(root, 'src'), cmd, 'x.ts', '../src/x.ts', 'gen/y.ts', '--root', root);
    expect(r.out).toBe('src/gen/y.ts\n  a.md   via src/**\nsrc/x.ts\n  a.md   via src/**\n');
  });

  it('an argument outside the root is E_USAGE, exit 2', () => {
    const root = tree({ 'a.md': ['src/**'] });
    const r = exec(root, cmd, '../outside.ts');
    expect(r.code).toBe(2);
    expect(r.err).toContain('error: E_USAGE: ../outside.ts: ');
  });

  it('an invalid pattern is skipped for matching but surfaces E_PATTERN, exit 2', () => {
    const root = tree({ 'a.md': ['"/bad"'], 'b.md': ['src/**'] });
    const r = exec(root, cmd, 'src/x.ts');
    expect(r.code).toBe(2);
    expect(r.out).toBe('src/x.ts\n  b.md   via src/**\n');
    expect(r.err).toContain('error: E_PATTERN: a.md: /bad: ');
  });

  it('needs no lock and ignores a broken one', () => {
    const root = tree({ 'a.md': ['src/**'] });
    writeFileSync(join(root, 'docstamp-lock.yaml'), '<<<<<<< garbage\n');
    expect(exec(root, cmd, 'src/x.ts').code).toBe(0);
  });

  it('the old forward form with a stamped file now answers the reverse question', () => {
    const root = tree({ 'a.md': ['src/**'] });
    expect(exec(root, cmd, 'a.md').out).toBe('a.md\n  (no dependents)\n');
    expect(exec(root, 'list-dependencies', 'a.md').out).toContain('  depends   src/**\n');
  });

  it('--json has the reverse shape', () => {
    const root = tree({ 'a.md': ['src/**', '"!src/gen/**"'] });
    const r = exec(root, cmd, '--json', 'src/x.ts', 'src/gen/y.ts');
    expect(r.err).toBe('');
    const doc = JSON.parse(r.out);
    expect(doc).toEqual({
      version: 2,
      mode: 'list-dependents',
      exitCode: 0,
      files: [
        { file: 'src/gen/y.ts', dependents: [], diagnostics: [] },
        { file: 'src/x.ts', dependents: [{ file: 'a.md', via: ['src/**'] }], diagnostics: [] },
      ],
      diagnostics: [],
    });
    expect(Object.keys(doc.files[1])).toEqual(['file', 'dependents', 'diagnostics']);
  });

  it('--json on a raised error has empty files', () => {
    const doc = JSON.parse(exec(makeTree({}), cmd, '--json', '--root', '.', 'a').out);
    expect(doc.files).toEqual([]);
    expect(doc.diagnostics[0].code).toBe('E_CONFIG_MISSING');
  });
});
