import { describe, expect, it } from 'vitest';
import { comparePaths, sortPaths } from '../../src/core/order.ts';
import { quote } from '../../src/core/quote.ts';
import { isRepoPath } from '../../src/core/repo-path.ts';
import { diag, sortDiagnostics } from '../../src/core/diagnostics.ts';

describe('§3.3 path order', () => {
  it('orders by UTF-16 code unit, not locale', () => {
    expect(sortPaths(['b', 'B', 'a', 'Z'])).toEqual(['B', 'Z', 'a', 'b']);
  });
  it('puts astral code points before U+E000..U+FFFF', () => {
    expect(comparePaths('\u{1F600}', '�')).toBeLessThan(0);
  });
});

describe('§3.4 quote', () => {
  it('escapes quote, backslash and named controls', () => {
    expect(quote('a"b\\c\n\t')).toBe('"a\\"b\\\\c\\n\\t"');
  });
  it('escapes other C0, DEL, C1, U+2028, U+2029, U+FEFF as lowercase \\u', () => {
    expect(quote('\u0001\u007f\u0085  ﻿')).toBe('"\\u0001\\u007f\\u0085\\u2028\\u2029\\ufeff"');
  });
  it('keeps other non-ASCII raw', () => {
    expect(quote('é😀')).toBe('"é😀"');
  });
  it('round-trips through JSON.parse', () => {
    const s = 'x"\\\u0000 é';
    expect(JSON.parse(quote(s))).toBe(s);
  });
});

describe('§4 RepoPath', () => {
  it.each(['a', 'a/b.md', 'é/x'])('accepts %s', (p) => expect(isRepoPath(p)).toBe(true));
  it.each(['', '/a', 'a/', 'a//b', './a', 'a/../b', 'a\u0000', 'é'])('rejects %j', (p) =>
    expect(isRepoPath(p)).toBe(false),
  );
});

describe('§5.5 diagnostic order', () => {
  it('sorts by dependent (empty first), code, subject and dedupes', () => {
    const ds = [
      diag('E_PATTERN', { dependent: 'b', subject: 'x' }),
      diag('E_USAGE', { subject: 'z' }),
      diag('E_EMPTY_PATTERN', { dependent: 'a', subject: 'y' }),
      diag('E_PATTERN', { dependent: 'b', subject: 'x' }),
    ];
    expect(sortDiagnostics(ds).map((d) => [d.dependent, d.code, d.subject])).toEqual([
      ['', 'E_USAGE', 'z'],
      ['a', 'E_EMPTY_PATTERN', 'y'],
      ['b', 'E_PATTERN', 'x'],
    ]);
  });
  it('W_ORPHAN is a warning, others errors', () => {
    expect(diag('W_ORPHAN').severity).toBe('warning');
    expect(diag('E_LOCK').severity).toBe('error');
  });
});
