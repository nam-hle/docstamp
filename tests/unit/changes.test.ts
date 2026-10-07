import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildChanges,
  isWhitespaceOnly,
  parseNameList,
  parseNameStatus,
} from '../../src/history/changes.ts';
import { viaOf } from '../../src/pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../../src/pattern/parse.ts';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';

const keep = (resolved: string[], deletable: string[] = []) => ({
  resolved: new Set(resolved),
  selectsDeleted: (path: string) => deletable.includes(path),
  viaOf: (path: string) => [`via ${path}`],
});

const entry = (status: string, path: string) => ({
  status,
  path,
  via: [`via ${path}`],
  whitespaceOnly: false,
});

afterEach(() => {
  cleanupTrees();
  vi.unstubAllEnvs();
});

describe('§12.3 ChangedSince: git output parsing', () => {
  it('parses NUL separated name-status pairs', () => {
    expect(parseNameStatus('M\0src/a.ts\0A\0src/b.ts\0D\0src/c.ts\0T\0src/d.ts\0')).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'A', path: 'src/b.ts' },
      { status: 'D', path: 'src/c.ts' },
      { status: 'T', path: 'src/d.ts' },
    ]);
  });
  it('empty output is no changes', () => {
    expect(parseNameStatus('')).toEqual([]);
    expect(parseNameList('')).toEqual([]);
  });
  it('a dangling status is malformed', () => {
    expect(parseNameStatus('M\0')).toBeNull();
    expect(parseNameStatus('M')).toBeNull();
  });
  it('converts paths to NFC', () => {
    expect(parseNameStatus('M\0é.ts\0')).toEqual([{ status: 'M', path: 'é.ts' }]);
    expect(parseNameList('é.ts\0')).toEqual(['é.ts']);
  });
  it('parses NUL separated name lists', () => {
    expect(parseNameList('a\0b c\0')).toEqual(['a', 'b c']);
  });
});

describe('§12.3 ChangedSince: status mapping and filtering', () => {
  it('maps M, T, A, D and untracked, in path order', () => {
    const diff = [
      { status: 'D', path: 'src/gone.ts' },
      { status: 'M', path: 'src/m.ts' },
      { status: 'T', path: 'src/t.ts' },
      { status: 'A', path: 'src/a.ts' },
    ];
    expect(
      buildChanges(
        diff,
        ['src/new.ts'],
        keep(['src/m.ts', 'src/t.ts', 'src/a.ts', 'src/new.ts'], ['src/gone.ts']),
      ),
    ).toEqual([
      entry('added', 'src/a.ts'),
      entry('deleted', 'src/gone.ts'),
      entry('modified', 'src/m.ts'),
      entry('added', 'src/new.ts'),
      entry('modified', 'src/t.ts'),
    ]);
  });
  it('drops added and modified paths outside the resolved set', () => {
    expect(buildChanges([{ status: 'M', path: 'x.ts' }], ['y.ts'], keep(['src/a.ts']))).toEqual([]);
  });
  it('drops deleted paths the patterns do not select', () => {
    expect(buildChanges([{ status: 'D', path: 'x.ts' }], [], keep([], ['y.ts']))).toEqual([]);
  });
  it('a deleted path that is also untracked is modified', () => {
    expect(
      buildChanges([{ status: 'D', path: 'src/a.ts' }], ['src/a.ts'], keep(['src/a.ts'])),
    ).toEqual([entry('modified', 'src/a.ts')]);
  });
  it('an untracked path already in the diff keeps the diff status', () => {
    expect(
      buildChanges([{ status: 'M', path: 'src/a.ts' }], ['src/a.ts'], keep(['src/a.ts'])),
    ).toEqual([entry('modified', 'src/a.ts')]);
  });
  it('an unknown status is unknown', () => {
    expect(buildChanges([{ status: 'U', path: 'src/a.ts' }], [], keep(['src/a.ts']))).toBeNull();
  });
});

describe('§12.3 step 6: via', () => {
  const via = (dependencies: string[], path: string) =>
    viaOf(dependencies, dependencies.map((d) => parsePattern(d)) as ParsedPattern[], path);
  it('names the patterns without Negation that match, in declaration order', () => {
    expect(via(['src/**', 'src/cli', '!src/cli/skip.ts', 'docs'], 'src/cli/run.ts')).toEqual([
      'src/**',
      'src/cli',
    ]);
  });
  it('a directory pattern matches below it, a pattern that does not match is absent', () => {
    expect(via(['src', 'lib', 'src/*.ts'], 'src/a.ts')).toEqual(['src', 'src/*.ts']);
    expect(via(['lib'], 'src/a.ts')).toEqual([]);
  });
  it('a Negation is never named, even when it matches', () => {
    expect(via(['!src/a.ts', 'src/**'], 'src/a.ts')).toEqual(['src/**']);
  });
});

describe('§12.3 step 7: whitespace only', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
      cwd,
      encoding: 'utf8',
    });
  const committed = (files: Record<string, string>) => {
    vi.stubEnv('HOME', makeTree({}));
    vi.stubEnv('XDG_CONFIG_HOME', makeTree({}));
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    const root = makeTree(files);
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    return { root, base: git(root, 'rev-parse', 'HEAD').trim() };
  };
  it('is true for a change of indentation, trailing space and blank lines', () => {
    const { root, base } = committed({ 'a.ts': 'one\ntwo\n' });
    writeFileSync(join(root, 'a.ts'), '  one  \n\n\ttwo\n');
    expect(isWhitespaceOnly(root, base, 'a.ts')).toBe(true);
  });
  it('is true for line endings alone', () => {
    const { root, base } = committed({ 'a.ts': 'one\ntwo\n' });
    writeFileSync(join(root, 'a.ts'), 'one\r\ntwo\r\n');
    expect(isWhitespaceOnly(root, base, 'a.ts')).toBe(true);
  });
  it('is false when a word changes, even next to a white space change', () => {
    const { root, base } = committed({ 'a.ts': 'one\ntwo\n' });
    writeFileSync(join(root, 'a.ts'), ' one\ntwo2\n');
    expect(isWhitespaceOnly(root, base, 'a.ts')).toBe(false);
  });
  it('is false for a change of file mode and for a bad commit', () => {
    const { root, base } = committed({ 'a.ts': 'one\n' });
    chmodSync(join(root, 'a.ts'), 0o755);
    expect(isWhitespaceOnly(root, base, 'a.ts')).toBe(false);
    expect(isWhitespaceOnly(root, 'not-a-commit', 'a.ts')).toBe(false);
  });
  it('reads the path literally, not as a pattern', () => {
    const { root, base } = committed({ '[id].ts': 'a\n', 'i.ts': 'b\n' });
    writeFileSync(join(root, '[id].ts'), ' a\n');
    writeFileSync(join(root, 'i.ts'), 'changed\n');
    expect(isWhitespaceOnly(root, base, '[id].ts')).toBe(true);
    expect(isWhitespaceOnly(root, base, 'i.ts')).toBe(false);
  });
});
