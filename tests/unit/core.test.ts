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
  it('sorts by file (empty first), code, subject and dedupes', () => {
    const ds = [
      diag('E_PATTERN', { file: 'b', subject: 'x' }),
      diag('E_USAGE', { subject: 'z' }),
      diag('E_EMPTY_PATTERN', { file: 'a', subject: 'y' }),
      diag('E_PATTERN', { file: 'b', subject: 'x' }),
    ];
    expect(sortDiagnostics(ds).map((d) => [d.file, d.code, d.subject])).toEqual([
      ['', 'E_USAGE', 'z'],
      ['a', 'E_EMPTY_PATTERN', 'y'],
      ['b', 'E_PATTERN', 'x'],
    ]);
  });
  it('W_ codes are warnings, others errors', () => {
    expect(diag('W_ORPHAN').severity).toBe('warning');
    expect(diag('W_EMPTY_EXCLUSION').severity).toBe('warning');
    expect(diag('W_DUPLICATE_PATTERN').severity).toBe('warning');
    expect(diag('W_UNKNOWN_PATH').severity).toBe('warning');
    expect(diag('W_SHADOWED_EXCLUSION').severity).toBe('warning');
    expect(diag('E_LOCK').severity).toBe('error');
  });
});

describe('§8.5 E_EMPTY_PATTERN message', () => {
  it('names the separator when a backslash precedes a letter', () => {
    expect(diag('E_EMPTY_PATTERN', { subject: 'src\\core' }).message).toContain(
      'patterns use "/" as the separator',
    );
    expect(diag('E_EMPTY_PATTERN', { subject: 'src\\é' }).message).toContain('separator');
  });
  it('keeps the plain message otherwise, an escaped symbol included', () => {
    const plain = 'Correct or remove the pattern; it matches no file.';
    expect(diag('E_EMPTY_PATTERN', { subject: 'src/a\\*b' }).message).toBe(plain);
    expect(diag('E_EMPTY_PATTERN', { subject: 'gone' }).message).toBe(plain);
  });
});

describe('§15 E_PATTERN message', () => {
  it('names an empty pattern and a lone "!" for what they are', () => {
    expect(diag('E_PATTERN', { subject: '' }).message).toMatch(/^Write a path or a glob.*empty/);
    expect(diag('E_PATTERN', { subject: '!' }).message).toContain('path to exclude after the "!"');
  });
  it('explains the separator and the escape for any other invalid pattern', () => {
    expect(diag('E_PATTERN', { subject: 'src/' }).message).toBe(
      'Correct the pattern; "/" separates its segments and "\\" escapes the next character.',
    );
  });
});
