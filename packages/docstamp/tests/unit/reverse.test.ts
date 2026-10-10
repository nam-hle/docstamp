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

  it('§13.8 step 4.3: only a path that is neither tracked nor on disk is unknown', () => {
    const root = tree({ 'a.md': ['src/**'] }, { '.gitignore': 'src/gen\n' });
    const warned = exec(root, cmd, 'nope/missing.ts');
    expect(warned.code).toBe(0);
    expect(warned.out).toBe('nope/missing.ts\n  (no dependents)\n');
    expect(warned.err).toMatch(/^warning: W_UNKNOWN_PATH: nope\/missing\.ts: /u);
    for (const known of ['src/gen/y.ts', 'src/gen', 'src', 'b.md', 'docstamp.yaml']) {
      const r = exec(root, cmd, known);
      expect([known, r.code, r.err]).toEqual([known, 0, '']);
    }
    expect(exec(root, cmd, 'SRC').err).toContain('W_UNKNOWN_PATH: SRC');
  });

  it('--json carries W_UNKNOWN_PATH on the entry', () => {
    const root = tree({ 'a.md': ['src/**'] });
    const doc = JSON.parse(exec(root, cmd, '--json', 'ghost.ts').out);
    expect(doc.exitCode).toBe(0);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.files[0].diagnostics).toEqual([
      {
        code: 'W_UNKNOWN_PATH',
        severity: 'warning',
        file: null,
        subject: 'ghost.ts',
        message: expect.any(String),
      },
    ]);
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
    expect(r.err).toContain(`resolved against the current directory (${root}) to `);
    expect(r.err).toContain(`which is outside the root ${root};`);
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

describe('§13.8 list-dependents --transitive', () => {
  const cmd = 'list-dependents';
  const flag = '--transitive';

  it('lists the dependents of the dependents as an indented tree', () => {
    const root = tree({ 'a.md': ['b.md'], 'b.md': ['src/**'] });
    expect(exec(root, cmd, flag, 'src/x.ts')).toEqual({
      code: 0,
      out: 'src/x.ts\n  b.md   via src/**\n    a.md   via b.md\n',
      err: '',
    });
  });

  it('is the direct list when nothing depends on a dependent', () => {
    const root = tree({ 'a.md': ['src/**'] });
    expect(exec(root, cmd, flag, 'src/x.ts').out).toBe(exec(root, cmd, 'src/x.ts').out);
    expect(exec(root, cmd, flag, 'b.md').out).toBe('b.md\n  (no dependents)\n');
  });

  it('pads each group to its own longest name and goes depth first, in path order', () => {
    const root = tree(
      { 'a.md': ['src/**'], 'b.md': ['src/**'], 'c.md': ['a.md'], 'dd.md': ['a.md'] },
      { 'c.md': 'c', 'dd.md': 'd' },
    );
    expect(exec(root, cmd, flag, 'src/x.ts').out).toBe(
      'src/x.ts\n' +
        '  a.md   via src/**\n' +
        '    c.md    via a.md\n' +
        '    dd.md   via a.md\n' +
        '  b.md   via src/**\n',
    );
  });

  it('prints a cycle once, marked, and stops', () => {
    const root = tree({ 'a.md': ['src/x.ts', 'b.md'], 'b.md': ['a.md'] });
    expect(exec(root, cmd, flag, 'src/x.ts').out).toBe(
      'src/x.ts\n  a.md   via src/x.ts\n    b.md   via a.md\n      a.md   via b.md (cycle)\n',
    );
  });

  it('a cycle that returns to the argument itself stops there', () => {
    const root = tree({ 'a.md': ['b.md'], 'b.md': ['a.md'] });
    expect(exec(root, cmd, flag, 'a.md').out).toBe(
      'a.md\n  b.md   via a.md\n    a.md   via b.md (cycle)\n',
    );
  });

  it('a file reached by two chains is expanded once and marked the second time', () => {
    const root = tree(
      { 'a.md': ['src/**'], 'b.md': ['src/**', 'a.md'], 'c.md': ['a.md', 'b.md'] },
      { 'c.md': 'c' },
    );
    expect(exec(root, cmd, flag, 'src/x.ts').out).toBe(
      'src/x.ts\n' +
        '  a.md   via src/**\n' +
        '    b.md   via a.md (listed below)\n' +
        '    c.md   via a.md\n' +
        '  b.md   via src/**\n' +
        '    c.md   via b.md (listed above)\n',
    );
  });

  it('prints every direct dependent in full at the first level (DirectFirstTree)', () => {
    const root = tree({ 'a.md': ['src/**'], 'b.md': ['a.md'], 'c.md': ['src/**', 'b.md'] });
    expect(exec(root, cmd, flag, 'src/x.ts').out).toBe(
      'src/x.ts\n' +
        '  a.md   via src/**\n' +
        '    b.md   via a.md\n' +
        '      c.md   via b.md (listed below)\n' +
        '  c.md   via src/**\n',
    );
  });

  it('--json keeps DependentTree: the direct dependent expanded deeper is repeated', () => {
    const root = tree({ 'a.md': ['src/**'], 'b.md': ['a.md'], 'c.md': ['src/**', 'b.md'] });
    const leaf = { dependents: [], cycle: false };
    const c = { file: 'c.md', via: ['b.md'], ...leaf, repeated: false };
    const b = { file: 'b.md', via: ['a.md'], dependents: [c], cycle: false, repeated: false };
    expect(JSON.parse(exec(root, cmd, flag, '--json', 'src/x.ts').out).files[0]).toEqual({
      file: 'src/x.ts',
      dependents: [
        { file: 'a.md', via: ['src/**'], dependents: [b], cycle: false, repeated: false },
        { file: 'c.md', via: ['src/**'], ...leaf, repeated: true },
      ],
      diagnostics: [],
    });
  });

  it('does not follow a file whose declaration is invalid, and still reports it', () => {
    const root = tree({ 'a.md': ['b.md'], 'b.md': ['src/**'], 'c.md': ['"/bad"', 'a.md'] });
    const r = exec(root, cmd, flag, 'src/x.ts');
    expect(r.code).toBe(2);
    expect(r.out).toBe('src/x.ts\n  b.md   via src/**\n    a.md   via b.md\n');
    expect(r.err).toContain('error: E_PATTERN: c.md: /bad: ');
  });

  it('--json nests the same nodes and adds cycle and repeated', () => {
    const root = tree({ 'a.md': ['src/x.ts', 'b.md'], 'b.md': ['a.md'] });
    const r = exec(root, cmd, flag, '--json', 'src/x.ts');
    expect(r.err).toBe('');
    expect(JSON.parse(r.out).files).toEqual([
      {
        file: 'src/x.ts',
        dependents: [
          {
            file: 'a.md',
            via: ['src/x.ts'],
            dependents: [
              {
                file: 'b.md',
                via: ['a.md'],
                dependents: [
                  { file: 'a.md', via: ['b.md'], dependents: [], cycle: true, repeated: false },
                ],
                cycle: false,
                repeated: false,
              },
            ],
            cycle: false,
            repeated: false,
          },
        ],
        diagnostics: [],
      },
    ]);
  });

  it('--json without the flag keeps the shape of a direct entry', () => {
    const root = tree({ 'a.md': ['b.md'], 'b.md': ['src/**'] });
    const doc = JSON.parse(exec(root, cmd, '--json', 'src/x.ts').out);
    expect(doc.files[0].dependents).toEqual([{ file: 'b.md', via: ['src/**'] }]);
  });

  it('changes no verdict: a stale dependent leaves the file below it ok', () => {
    const root = tree({ 'a.md': ['b.md'], 'b.md': ['src/**'] });
    expect(exec(root, 'update', '--all').code).toBe(0);
    writeFileSync(join(root, 'src/x.ts'), 'changed');
    const check = exec(root);
    expect(check.code).toBe(1);
    expect(check.out).toContain('STALE    b.md');
    expect(check.out).not.toContain('STALE    a.md');
  });
});
