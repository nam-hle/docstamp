import { describe, expect, it } from 'vitest';
import { literalPath, parsePattern } from '../../src/pattern/parse.ts';

const ok = (s: string) => expect(parsePattern(s), s).not.toBeNull();
const bad = (s: string) => expect(parsePattern(s), s).toBeNull();

describe('§8.1 pattern syntax', () => {
  it.each([
    'src/**',
    '!src/**/*.test.ts',
    'a?c',
    '[a-z]x',
    '[!a]',
    'x{a,b*}y',
    '\\!x',
    '**/a',
    'a/**/b',
    '[-a]',
    '[a-]',
    'src\\cli',
  ])('valid %s', ok);

  it.each([
    '',
    '!',
    '/a',
    '!/a',
    'a/',
    'a/./b',
    'a/../b',
    '..',
    'a**b',
    '**x',
    '[!]',
    '[]',
    '[z-a]',
    '{a}',
    '{a,b',
    'a}',
    'x{a/b,c}',
    'a,b',
    'a\\/b',
    'é',
  ])('invalid %j', bad);

  it('leading ! is negation, \\! is literal', () => {
    expect(parsePattern('!a')?.negated).toBe(true);
    expect(parsePattern('\\!a')?.negated).toBe(false);
  });

  it('** is a globstar segment only when whole', () => {
    expect(parsePattern('a/**/b')?.segments[1]).toEqual({ kind: 'globstar' });
  });

  it('rejects alternation when disabled', () => {
    expect(parsePattern('x{a,b}', { alternation: false })).toBeNull();
  });

  it('class dash is literal at either end, a range otherwise', () => {
    expect(parsePattern('[-a]')?.segments[0]).toEqual({
      kind: 'parts',
      atoms: [
        {
          kind: 'class',
          negated: false,
          items: [
            ['-', '-'],
            ['a', 'a'],
          ],
        },
      ],
    });
    expect(parsePattern('[a-]')?.segments[0]).toEqual({
      kind: 'parts',
      atoms: [
        {
          kind: 'class',
          negated: false,
          items: [
            ['a', 'a'],
            ['-', '-'],
          ],
        },
      ],
    });
    expect(parsePattern('[a-c]')?.segments[0]).toEqual({
      kind: 'parts',
      atoms: [{ kind: 'class', negated: false, items: [['a', 'c']] }],
    });
  });
});

describe('§8.5 NOTE literalPath', () => {
  const literal = (s: string) => literalPath(parsePattern(s)!);
  it('is the path of a pattern of Literals only, Escapes resolved', () => {
    expect(literal('.npmrc')).toBe('.npmrc');
    expect(literal('build/output/index.js')).toBe('build/output/index.js');
    expect(literal('src/a\\*b.ts')).toBe('src/a*b.ts');
    expect(literal('src/\\[id\\].ts')).toBe('src/[id].ts');
  });
  it.each(['src/*.ts', 'src/**', 'a?c', '[ab]x', 'src/{a,b}.ts', 'build/*/x', '**/x'])(
    'is null for the glob %s',
    (s) => expect(literal(s)).toBeNull(),
  );
});
