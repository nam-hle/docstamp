import { describe, expect, it } from 'vitest';
import { selectResults, toRepoPath } from '../../src/cli/paths.ts';
import type { Result } from '../../src/core/types.ts';

describe('§13.4 toRepoPath', () => {
  it('relative to cwd, lexical', () => {
    expect(toRepoPath('../b.md', '/r/a', '/r')).toBe('b.md');
    expect(toRepoPath('/r/x/./y.md', '/elsewhere', '/r')).toBe('x/y.md');
  });
  it('fails outside root or at root', () => {
    expect(toRepoPath('../../x', '/r/a', '/r')).toBeNull();
    expect(toRepoPath('.', '/r', '/r')).toBeNull();
    expect(toRepoPath('/rx/a.md', '/r', '/r')).toBeNull();
  });
  it('root with trailing slash', () => {
    expect(toRepoPath('a.md', '/r/', '/r/')).toBe('a.md');
    expect(toRepoPath('.', '/r/', '/r/')).toBeNull();
  });
  it('windows separators and drive letters', () => {
    expect(toRepoPath('docs\\a.md', '/r', '/r', true)).toBe('docs/a.md');
    expect(toRepoPath('C:\\r\\docs\\a.md', 'C:\\other', 'C:\\r', true)).toBe('docs/a.md');
    expect(toRepoPath('C:\\x\\a.md', 'C:\\r', 'C:\\r', true)).toBeNull();
  });
  it('drive-letter-looking arg is relative on posix', () => {
    expect(toRepoPath('C:/a.md', '/r', '/r', false)).toBe('C:/a.md');
  });
  it('NFC, no case folding', () => {
    expect(toRepoPath('é.md', '/r', '/r')).toBe('é.md');
    expect(toRepoPath('e\u0301.md', '/r', '/r')).toBe('\u00e9.md');
    expect(toRepoPath('A.md', '/r', '/r')).toBe('A.md');
  });
});

describe('§13.3 selectResults', () => {
  const r = (dependent: string) => ({ dependent }) as Result;
  const results = [r('a.md'), r('b.md')];
  it('all when no args', () => {
    expect(selectResults([], '/r', '/r', results).selected).toHaveLength(2);
  });
  it('dedupes, path order, unknown is an error', () => {
    const out = selectResults(['b.md', 'a.md', 'b.md', 'A.md'], '/r', '/r', results);
    expect(out.selected.map((x) => x.dependent)).toEqual(['a.md', 'b.md']);
    expect(out.errors.map((d) => [d.code, d.subject])).toEqual([['E_UNKNOWN_DEPENDENT', 'A.md']]);
  });
  it('outside-root arg is unknown with original subject', () => {
    const out = selectResults(['../x.md'], '/r', '/r', results);
    expect(out.errors.map((d) => d.subject)).toEqual(['../x.md']);
  });
});
