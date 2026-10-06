import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';
import { computeUniverse } from '../../src/universe/walk.ts';
import { coverHashFrom, fileHash, normalizedContent } from '../../src/hash/hash.ts';

afterEach(cleanupTrees);

const cfg = { ignore: [], useGitignore: true, bindings: [] };
const setup = (spec: Parameters<typeof makeTree>[0]) => {
  const root = makeTree(spec);
  return { root, u: computeUniverse(root, cfg) };
};

describe('§10.2 normalizedContent', () => {
  it('CRLF and LF hash the same; lone CR does not', () => {
    const { root, u } = setup({ a: 'x\r\ny', b: 'x\ny', c: 'x\ry' });
    expect(fileHash(root, u, 'a')).toBe(fileHash(root, u, 'b'));
    expect(fileHash(root, u, 'c')).not.toBe(fileHash(root, u, 'b'));
  });
  it('binary content is not normalized', () => {
    const { root, u } = setup({ a: 'x\u0000\r\n', b: 'x\u0000\n' });
    expect(fileHash(root, u, 'a')).not.toBe(fileHash(root, u, 'b'));
  });
  it('file and link are tagged differently', () => {
    const { root, u } = setup({ t: 'x', f: 't', l: { link: 't' } });
    expect(normalizedContent(root, u, 'f').subarray(0, 5).toString()).toBe('file\u0000');
    expect(normalizedContent(root, u, 'l').toString()).toBe('link\u0000t');
  });
  it('dangling link hashes by target, no error', () => {
    const { root, u } = setup({ l: { link: 'missing' } });
    expect(fileHash(root, u, 'l')).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('§10.4 coverHashFrom', () => {
  it('matches the defined byte layout (test vector)', () => {
    const h = 'a'.repeat(64);
    const expected = createHash('sha256').update(`x.md\u0000${h}\n`).digest('hex');
    expect(coverHashFrom([['x.md', h]])).toBe(expected);
  });
  it('rename changes the hash', () => {
    const h = 'b'.repeat(64);
    expect(coverHashFrom([['a', h]])).not.toBe(coverHashFrom([['b', h]]));
  });
});
