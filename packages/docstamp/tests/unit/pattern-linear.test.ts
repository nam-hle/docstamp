import { describe, expect, test } from 'vitest';

import { patternMatches } from '../../src/pattern/match.ts';
import { parsePattern } from '../../src/pattern/parse.ts';

const matches = (src: string, path: string) => {
  const parsed = parsePattern(src);
  if (!parsed) throw new Error(`invalid pattern ${src}`);
  return patternMatches(parsed, path);
};

describe('§8.2 Matching is linear in the path', () => {
  test('repeated alternations of stars do not blow up', () => {
    const pattern = `${'{*,*}x'.repeat(24)}`;
    expect(matches(pattern, `${'x'.repeat(30)}!`)).toBe(false);
    expect(matches(pattern, 'x'.repeat(24))).toBe(true);
  });

  test('many stars on a long path do not blow up', () => {
    const pattern = `${'*a'.repeat(12)}*b`;
    expect(matches(pattern, 'a'.repeat(2000))).toBe(false);
    expect(matches(pattern, `${'a'.repeat(2000)}b`)).toBe(true);
  });

  test('globstars between starred segments do not blow up', () => {
    const pattern = '**/*a*a*a*a*b/**/*a*a*a*b';
    const path = `${`${'a'.repeat(30)}/`.repeat(8)}c`;
    expect(matches(pattern, path)).toBe(false);
  });

  test('semantics are kept', () => {
    expect(matches('src/**', 'src/a/b.ts')).toBe(true);
    expect(matches('src/**', 'src')).toBe(false);
    expect(matches('**/b.ts', 'b.ts')).toBe(true);
    expect(matches('**/b.ts', 'a/b.ts')).toBe(true);
    expect(matches('a/**/b', 'a/x/y/b')).toBe(true);
    expect(matches('a/**/b', 'a/b')).toBe(true);
    expect(matches('{a,b}?[!x]*', 'ac1.md')).toBe(true);
    expect(matches('a*', 'a/b')).toBe(true);
    expect(matches('[a-c]*', 'dz')).toBe(false);
  });
});
