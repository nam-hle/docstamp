import { describe, expect, it } from 'vitest';
import {
  isAtOrUnderRoot,
  resolveArgument,
  selectResults,
  toRepoPath,
} from '../../src/cli/paths.ts';
import type { Raised } from '../../src/core/diagnostics.ts';
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

describe('§13.4 steps 1 and 2 resolveArgument', () => {
  it('joins to cwd and normalizes lexically, also outside root', () => {
    expect(resolveArgument('../../x/./y', '/r/a')).toBe('/x/y');
    expect(resolveArgument('/abs/../z', '/r')).toBe('/z');
    expect(resolveArgument('.', '/r', false)).toBe('/r');
    expect(resolveArgument('docs\\a.md', '/r', true)).toBe('/r/docs/a.md');
  });
});

describe('§13.8 isAtOrUnderRoot', () => {
  it('is the root itself or a path below it, not a sibling that shares a prefix', () => {
    expect(isAtOrUnderRoot('/r', '/r', false)).toBe(true);
    expect(isAtOrUnderRoot('/r/a/b', '/r', false)).toBe(true);
    expect(isAtOrUnderRoot('/rx', '/r', false)).toBe(false);
    expect(isAtOrUnderRoot('/elsewhere', '/r', false)).toBe(false);
  });
  it('compares a Windows root written with backslashes against a resolved path', () => {
    expect(isAtOrUnderRoot('C:/w/repo', 'C:\\w\\repo', true)).toBe(true);
    expect(isAtOrUnderRoot('C:/w/repo/docs', 'C:\\w\\repo', true)).toBe(true);
    expect(isAtOrUnderRoot('C:/w/other', 'C:\\w\\repo', true)).toBe(false);
  });
});

describe('§13.3 selectResults', () => {
  const r = (file: string) => ({ file }) as Result;
  const results = [r('a.md'), r('b.md')];
  const raised = (args: string[]) => {
    try {
      selectResults(args, '/r', '/r', results);
    } catch (error) {
      return (error as Raised).diagnostics.map((d) => [d.code, d.subject]);
    }
    return [];
  };
  it('all when no args', () => {
    expect(selectResults([], '/r', '/r', results)).toHaveLength(2);
  });
  it('dedupes and keeps path order', () => {
    const out = selectResults(['b.md', 'a.md', 'b.md'], '/r', '/r', results);
    expect(out.map((x) => x.file)).toEqual(['a.md', 'b.md']);
  });
  it('raises for an unknown file, naming every bad argument', () => {
    expect(raised(['b.md', 'A.md', 'z.md'])).toEqual([
      ['E_UNKNOWN_FILE', 'A.md'],
      ['E_UNKNOWN_FILE', 'z.md'],
    ]);
  });
  it('an outside-root arg raises with the original subject', () => {
    expect(raised(['../x.md'])).toEqual([['E_UNKNOWN_FILE', '../x.md']]);
  });
});
