import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { memoryHost, type Entry } from '../helpers/memory-fs.ts';
import { computeUniverse } from '../../src/universe/walk.ts';
import { dependencyHashFrom, fileHash, normalizedContent } from '../../src/hash/hash.ts';

const cfg = { ignore: [], useGitignore: true, declarations: [] };
const setup = (spec: Record<string, Entry>) => {
  const host = memoryHost(spec);
  return { host, root: host.root, u: computeUniverse(host, host.root, cfg) };
};

describe('§10.2 normalizedContent', () => {
  it('CRLF and LF hash the same; lone CR does not', () => {
    const { host, root, u } = setup({ a: 'x\r\ny', b: 'x\ny', c: 'x\ry' });
    expect(fileHash(host, root, u, 'a')).toBe(fileHash(host, root, u, 'b'));
    expect(fileHash(host, root, u, 'c')).not.toBe(fileHash(host, root, u, 'b'));
  });
  it('binary content is not normalized', () => {
    const { host, root, u } = setup({ a: 'x\u0000\r\n', b: 'x\u0000\n' });
    expect(fileHash(host, root, u, 'a')).not.toBe(fileHash(host, root, u, 'b'));
  });
  it('file and link are tagged differently', () => {
    const { host, root, u } = setup({ t: 'x', f: 't', l: { link: 't' } });
    expect(normalizedContent(host, root, u, 'f').subarray(0, 5).toString()).toBe('file\u0000');
    expect(normalizedContent(host, root, u, 'l').toString()).toBe('link\u0000t');
  });
  it('dangling link hashes by target, no error', () => {
    const { host, root, u } = setup({ l: { link: 'missing' } });
    expect(fileHash(host, root, u, 'l')).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('§10.4 dependencyHashFrom', () => {
  it('matches the defined byte layout (test vector)', () => {
    const h = 'a'.repeat(64);
    const expected = createHash('sha256').update(`x.md\u0000${h}\n`).digest('hex');
    expect(dependencyHashFrom([['x.md', h]])).toBe(expected);
  });
  it('is the value the version 1 and 2 algorithm (Cover Hash) produced', () => {
    const h = 'a'.repeat(64);
    expect(dependencyHashFrom([['x.md', h]])).toBe(
      '6796dc35455f654e61dd28835779d684d3d2179981be763c770db1bc91ef4305',
    );
  });
  it('rename changes the hash', () => {
    const h = 'b'.repeat(64);
    expect(dependencyHashFrom([['a', h]])).not.toBe(dependencyHashFrom([['b', h]]));
  });
});
