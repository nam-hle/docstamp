import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import { selectableText } from '../../src/hash/hash.ts';
import { computeUniverse } from '../../src/universe/walk.ts';

afterEach(cleanupTrees);

const cfg = { ignore: [], useGitignore: true, declarations: [] };

const codeOf = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (e) {
    if (e instanceof Raised) return e.diagnostics[0]?.code;
    throw e;
  }
  return undefined;
};

describe('§8.7 selectableText', () => {
  it('returns the text with CR LF as LF', () => {
    const root = makeTree({ a: 'x\r\ny\n' });
    expect(selectableText(root, computeUniverse(root, cfg), 'a')).toBe('x\ny\n');
  });

  it('omits the hash line of an inline file', () => {
    const root = makeTree({ a: 'one\nhash: abc\ntwo\n' });
    const u = computeUniverse(root, cfg);
    u.marked = new Map([['a', [1]]]);
    expect(selectableText(root, u, 'a')).toBe('one\ntwo\n');
  });

  it('raises E_SELECT for a binary file', () => {
    const root = makeTree({ a: 'x\u0000y' });
    expect(codeOf(() => selectableText(root, computeUniverse(root, cfg), 'a'))).toBe('E_SELECT');
  });

  it('raises E_SELECT for invalid UTF-8', () => {
    const root = makeTree({ a: Buffer.from([0xff, 0xfe, 0x41]) });
    const u = computeUniverse(root, cfg);
    expect(codeOf(() => selectableText(root, u, 'a'))).toBe('E_SELECT');
  });

  it('raises E_SELECT for a link', () => {
    const root = makeTree({ t: 'x', l: { link: 't' } });
    expect(codeOf(() => selectableText(root, computeUniverse(root, cfg), 'l'))).toBe('E_SELECT');
  });

  it('raises E_UNREADABLE for an unreadable path', () => {
    const root = makeTree({ a: 'x' });
    expect(codeOf(() => selectableText(root, computeUniverse(root, cfg), 'missing'))).toBe(
      'E_UNREADABLE',
    );
  });
});
