import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/pattern/parse.ts';
import { patternMatches, select } from '../../src/pattern/match.ts';

const p = (s: string) => {
  const r = parsePattern(s);
  if (!r) throw new Error(`invalid ${s}`);
  return r;
};
const m = (pat: string, path: string) => patternMatches(p(pat), path);

describe('§8.2 glob matching', () => {
  it('* stays in a segment', () => {
    expect(m('*.ts', 'a.ts')).toBe(true);
    expect(m('*.ts', 'x/a.ts')).toBe(false);
  });
  it('? matches one non-slash code point, including astral', () => {
    expect(m('a?c', 'a😀c')).toBe(true);
  });
  it('classes and negated classes', () => {
    expect(m('[a-c]x', 'bx')).toBe(true);
    expect(m('[!a-c]x', 'bx')).toBe(false);
  });
  it('alternation', () => {
    expect(m('x.{ts,md}', 'x.md')).toBe(true);
  });
  it('middle ** matches zero or more segments', () => {
    expect(m('a/**/b', 'a/b')).toBe(true);
    expect(m('a/**/b', 'a/x/y/b')).toBe(true);
  });
  it('trailing ** needs at least one segment', () => {
    expect(m('src/**', 'src')).toBe(false);
    expect(m('src/**', 'src/a/b')).toBe(true);
  });
  it('case-sensitive, dotfiles not special', () => {
    expect(m('*.md', 'A.MD')).toBe(false);
    expect(m('*', '.env')).toBe(true);
  });
  it('escapes are literal', () => {
    expect(m('\\*', '*')).toBe(true);
    expect(m('\\*', 'a')).toBe(false);
  });
});

describe('§8.3 directory semantics', () => {
  it('a directory pattern selects files below it', () => {
    expect(m('src/cli', 'src/cli/a.ts')).toBe(true);
    expect(m('src/*', 'src/cli/a.ts')).toBe(true);
    expect(m('src/cli', 'src/client.ts')).toBe(false);
  });
});

describe('§8.4 select', () => {
  const files = ['a/x.ts', 'a/x.test.ts', 'a/y.ts', 'b/z.ts'];
  it('last match wins', () => {
    expect(select([p('a/**'), p('!a/**/*.test.ts')], files)).toEqual(['a/x.ts', 'a/y.ts']);
  });
  it('later pattern re-selects after negation', () => {
    expect(select([p('a'), p('!a'), p('a/y.ts')], files)).toEqual(['a/y.ts']);
  });
  it('returns path order', () => {
    expect(select([p('b/**'), p('a/y.ts')], ['b/z.ts', 'a/y.ts'])).toEqual(['a/y.ts', 'b/z.ts']);
  });
});
