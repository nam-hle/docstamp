import { describe, expect, it } from 'vitest';
import { buildChanges, parseNameList, parseNameStatus } from '../../src/history/changes.ts';

const keep = (covered: string[], deletable: string[] = []) => ({
  covered: new Set(covered),
  selectsDeleted: (path: string) => deletable.includes(path),
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
      { status: 'added', path: 'src/a.ts' },
      { status: 'deleted', path: 'src/gone.ts' },
      { status: 'modified', path: 'src/m.ts' },
      { status: 'added', path: 'src/new.ts' },
      { status: 'modified', path: 'src/t.ts' },
    ]);
  });
  it('drops added and modified paths outside the covered set', () => {
    expect(buildChanges([{ status: 'M', path: 'x.ts' }], ['y.ts'], keep(['src/a.ts']))).toEqual([]);
  });
  it('drops deleted paths the patterns do not select', () => {
    expect(buildChanges([{ status: 'D', path: 'x.ts' }], [], keep([], ['y.ts']))).toEqual([]);
  });
  it('a deleted path that is also untracked is modified', () => {
    expect(
      buildChanges([{ status: 'D', path: 'src/a.ts' }], ['src/a.ts'], keep(['src/a.ts'])),
    ).toEqual([{ status: 'modified', path: 'src/a.ts' }]);
  });
  it('an untracked path already in the diff keeps the diff status', () => {
    expect(
      buildChanges([{ status: 'M', path: 'src/a.ts' }], ['src/a.ts'], keep(['src/a.ts'])),
    ).toEqual([{ status: 'modified', path: 'src/a.ts' }]);
  });
  it('an unknown status is unknown', () => {
    expect(buildChanges([{ status: 'U', path: 'src/a.ts' }], [], keep(['src/a.ts']))).toBeNull();
  });
});
