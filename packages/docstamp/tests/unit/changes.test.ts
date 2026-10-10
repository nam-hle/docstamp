import { describe, expect, it } from 'vitest';
import {
  buildChanges,
  configuredOwnList,
  inlineOwnList,
  ownListOf,
  pairRenames,
} from '../../src/history/changes.ts';
import type { Change } from '../../src/core/types.ts';
import { selectionChanges } from '../../src/engine/selection.ts';
import { parseNameList, parseNameStatus, parseTree } from '../../src/host/git-output.ts';
import { viaOf } from '../../src/pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../../src/pattern/parse.ts';

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

describe('§12.3 step 1.4: own list', () => {
  const yaml = (body: string) => `version: 2\nfiles:\n${body}`;
  it('reads a configured file from docstamp.yaml, use included', () => {
    const text = yaml('  a.md:\n    dependencies: [src, "!src/x"]\n    use: [tests]\n');
    expect(configuredOwnList(text, 'a.md')).toEqual({
      dependencies: ['src', '!src/x'],
      use: ['tests'],
    });
    expect(configuredOwnList(yaml('  a.md:\n    dependencies: [src]\n'), 'a.md')).toEqual({
      dependencies: ['src'],
      use: undefined,
    });
  });
  it('is unknown for a missing key, an empty list or a text that does not parse', () => {
    expect(configuredOwnList(yaml('  b.md:\n    dependencies: [src]\n'), 'a.md')).toBeNull();
    expect(configuredOwnList(yaml('  a.md:\n    dependencies: []\n'), 'a.md')).toBeNull();
    expect(configuredOwnList('files: [', 'a.md')).toBeNull();
  });
  it('reads an inline block, and is unknown without one', () => {
    const text = '---\ndocstamp:\n  dependencies:\n    - src\n  hash: x\n---\n# A\n';
    expect(inlineOwnList(text, 'a.md')).toEqual({ dependencies: ['src'], use: undefined });
    expect(inlineOwnList('# A\n', 'a.md')).toBeNull();
  });
  it('the own list now leaves out the patterns of a Preset', () => {
    const result = {
      file: 'a.md',
      dependencies: ['src', 'tests/**', 'lib'],
      origins: [null, 'tests', null],
      use: ['tests'],
      state: 'stale' as const,
      reasons: [],
      resolved: [],
      current: '',
      diagnostics: [],
    };
    expect(ownListOf(result)).toEqual({ dependencies: ['src', 'lib'], use: ['tests'] });
  });
});

describe('§12.3 step 8: pairs', () => {
  const c = (status: Change['status'], path: string): Change => ({
    ...entry(status, path),
    status,
  });
  it('parses regular files of ls-tree, and skips links and submodules', () => {
    const out = [
      '100644 blob aaa\tsrc/a.ts',
      '100755 blob bbb\tbin/run',
      '120000 blob ccc\tlink',
      '160000 commit ddd\tsub',
      '',
    ].join('\0');
    expect([...parseTree(out)]).toEqual([
      ['src/a.ts', 'aaa'],
      ['bin/run', 'bbb'],
    ]);
  });
  it('pairs a deleted path with the first unpaired added path of equal content', () => {
    const changes = [
      c('added', 'a.ts'),
      c('added', 'b.ts'),
      c('deleted', 'x.ts'),
      c('deleted', 'y.ts'),
    ];
    const before = new Map([
      ['x.ts', 'o1'],
      ['y.ts', 'o1'],
    ]);
    const after = new Map([
      ['a.ts', 'o1'],
      ['b.ts', 'o1'],
    ]);
    expect(pairRenames(changes, before, after).map((p) => [p.path, p.pair])).toEqual([
      ['a.ts', 'x.ts'],
      ['b.ts', 'y.ts'],
      ['x.ts', 'a.ts'],
      ['y.ts', 'b.ts'],
    ]);
  });
  it('leaves edited, modified and unknown paths unpaired', () => {
    const changes = [c('added', 'a.ts'), c('modified', 'm.ts'), c('deleted', 'x.ts')];
    const paired = pairRenames(
      changes,
      new Map([
        ['x.ts', 'o1'],
        ['m.ts', 'o2'],
      ]),
      new Map([['a.ts', 'o3']]),
    );
    expect(paired.every((p) => p.pair === undefined)).toBe(true);
  });
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

describe('§12.3 step 10 selection', () => {
  const universe = ['docs/a.md', 'src/a.ts', 'src/a.test.ts', 'src/b.ts', 'lib/c.ts'];
  const presets = new Map([['tests', ['!**/*.test.ts']]]);
  it('lists the files that entered and left, in path order', () => {
    const then = { dependencies: ['src/**', '!**/*.test.ts', 'lib/**'], use: [] };
    expect(
      selectionChanges('docs/a.md', then, presets, [], universe, [
        'src/a.test.ts',
        'src/a.ts',
        'src/b.ts',
      ]),
    ).toEqual([
      { status: 'removed', path: 'lib/c.ts' },
      { status: 'added', path: 'src/a.test.ts' },
    ]);
  });
  it('expands the old use with the Presets of now, and never selects the file itself', () => {
    const then = { dependencies: ['**'], use: ['tests'] };
    expect(
      selectionChanges('docs/a.md', then, presets, [], universe, [
        'lib/c.ts',
        'src/a.ts',
        'src/b.ts',
      ]),
    ).toEqual([]);
  });
  it('expands an old list without use with the default Presets of now, not an empty use', () => {
    const now = ['src/a.ts', 'src/b.ts'];
    const absent = { dependencies: ['src/**'], use: undefined };
    expect(selectionChanges('docs/a.md', absent, presets, ['tests'], universe, now)).toEqual([]);
    const none = { dependencies: ['src/**'], use: [] };
    expect(selectionChanges('docs/a.md', none, presets, ['tests'], universe, now)).toEqual([
      { status: 'removed', path: 'src/a.test.ts' },
    ]);
  });
  it('is unknown when a Preset is gone or a pattern does not parse', () => {
    expect(
      selectionChanges(
        'docs/a.md',
        { dependencies: ['src'], use: ['x'] },
        presets,
        [],
        universe,
        [],
      ),
    ).toBeNull();
    expect(
      selectionChanges(
        'docs/a.md',
        { dependencies: ['src/{'], use: [] },
        presets,
        [],
        universe,
        [],
      ),
    ).toBeNull();
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
      { ...entry('added', 'src/new.ts'), untracked: true },
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
