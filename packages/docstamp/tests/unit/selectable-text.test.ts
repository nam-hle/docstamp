import { describe, expect, it } from 'vitest';
import { memoryHost, type Entry } from '../helpers/memory-fs.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import { selectableText } from '../../src/hash/hash.ts';
import { computeUniverse } from '../../src/universe/walk.ts';

const tree = (spec: Record<string, Entry>) => {
  const host = memoryHost(spec);
  return { host, root: host.root };
};

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
    const { host, root } = tree({ a: 'x\r\ny\n' });
    expect(selectableText(host, root, computeUniverse(host, root, cfg), 'a')).toBe('x\ny\n');
  });

  it('omits the hash line of an inline file', () => {
    const { host, root } = tree({ a: 'one\nhash: abc\ntwo\n' });
    const u = computeUniverse(host, root, cfg);
    u.marked = new Map([['a', [1]]]);
    expect(selectableText(host, root, u, 'a')).toBe('one\ntwo\n');
  });

  it('raises E_SELECT for a binary file', () => {
    const { host, root } = tree({ a: 'x\u0000y' });
    expect(codeOf(() => selectableText(host, root, computeUniverse(host, root, cfg), 'a'))).toBe(
      'E_SELECT',
    );
  });

  it('§8.7 §10.1 tests the binary rule on the file bytes, not on the CR LF stripped body', () => {
    const bytes = Buffer.concat([Buffer.from('a\r\n'.repeat(2800)), Buffer.from('\u0000x')]);
    const { host, root } = tree({ a: bytes });
    const text = selectableText(host, root, computeUniverse(host, root, cfg), 'a');
    expect(text).toBe('a\n'.repeat(2800) + '\u0000x');
  });

  it('raises E_SELECT for invalid UTF-8', () => {
    const { host, root } = tree({ a: Buffer.from([0xff, 0xfe, 0x41]) });
    const u = computeUniverse(host, root, cfg);
    expect(codeOf(() => selectableText(host, root, u, 'a'))).toBe('E_SELECT');
  });

  it('raises E_SELECT for a link', () => {
    const { host, root } = tree({ t: 'x', l: { link: 't' } });
    expect(codeOf(() => selectableText(host, root, computeUniverse(host, root, cfg), 'l'))).toBe(
      'E_SELECT',
    );
  });

  it('raises E_UNREADABLE for an unreadable path', () => {
    const { host, root } = tree({ a: 'x' });
    expect(
      codeOf(() => selectableText(host, root, computeUniverse(host, root, cfg), 'missing')),
    ).toBe('E_UNREADABLE');
  });
});
