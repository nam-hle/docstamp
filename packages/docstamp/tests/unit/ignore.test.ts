import { describe, expect, it } from 'vitest';
import { isIgnored, parseIgnoreLines } from '../../src/universe/ignore.ts';

const rules = (text: string, scope = '') => parseIgnoreLines(text, scope);

describe('§7.3 ignore rules', () => {
  it('skips blank and comment lines, BOM and CR', () => {
    expect(rules('﻿# c\r\n\r\nx\r\n')).toHaveLength(1);
  });
  it('\\# and \\! are literal', () => {
    expect(isIgnored('#a', false, rules('\\#a'))).toBe(true);
    expect(isIgnored('!a', false, rules('\\!a'))).toBe(true);
  });
  it('trims unescaped trailing spaces only', () => {
    expect(isIgnored('a', false, rules('a  '))).toBe(true);
    expect(isIgnored('a ', false, rules('a\\ '))).toBe(true);
  });
  it('a space after an escaped backslash is unescaped and trimmed', () => {
    expect(isIgnored('a\\', false, rules('a\\\\ '))).toBe(true);
    expect(isIgnored('a\\ ', false, rules('a\\\\ '))).toBe(false);
    expect(isIgnored('a\\ ', false, rules('a\\\\\\ '))).toBe(true);
  });
  it('counts the whole backslash run before a trailing space', () => {
    expect(isIgnored('a\\\\', false, rules('a\\\\\\\\ '))).toBe(true);
    expect(isIgnored('a\\\\ ', false, rules('a\\\\\\\\ '))).toBe(false);
    expect(isIgnored('x\\\\', false, rules('x\\\\\\\\   '))).toBe(true);
    expect(isIgnored('b\\\\ ', false, rules('b\\\\\\\\\\ '))).toBe(true);
  });
  it('a backslash run that follows other text, spaces included, is counted from its own start', () => {
    expect(isIgnored('a b\\', false, rules('a b\\\\ '))).toBe(true);
    expect(isIgnored('a b ', false, rules('a\\ b\\ '))).toBe(true);
    expect(isIgnored('a b', false, rules('a b\\ '))).toBe(false);
  });
  it('unanchored rule matches name at any depth', () => {
    expect(isIgnored('x/y/node_modules', true, rules('node_modules/'))).toBe(true);
  });
  it('dir-only rule does not match files', () => {
    expect(isIgnored('build', false, rules('build/'))).toBe(false);
  });
  it('anchored rule is relative to scope', () => {
    const r = rules('/dist', 'pkg');
    expect(isIgnored('pkg/dist', true, r)).toBe(true);
    expect(isIgnored('dist', true, r)).toBe(false);
    expect(isIgnored('pkg/a/dist', true, r)).toBe(false);
  });
  it('last match wins with negation', () => {
    expect(isIgnored('a.log', false, rules('*.log\n!a.log'))).toBe(false);
  });
  it('skips invalid globs', () => {
    expect(rules('{a,b}\nok')).toHaveLength(1);
  });
});
