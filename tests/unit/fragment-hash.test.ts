import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { dependencyHashFrom } from '../../src/hash/hash.ts';

const sha = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const A = 'a'.repeat(64);

describe('§10.4 fragments', () => {
  it('leaves the input unchanged without fragments', () => {
    expect(dependencyHashFrom([['src/a.ts', A]])).toBe(sha(`src/a.ts\u0000${A}\n`));
    expect(dependencyHashFrom([['src/a.ts', A]], [])).toBe(sha(`src/a.ts\u0000${A}\n`));
  });

  it('appends the fragment section after the whole-file lines', () => {
    const fragments = [{ path: 'docs/guide.md', select: '"Install"', hashes: ['abc'] }];
    expect(dependencyHashFrom([['src/a.ts', A]], fragments)).toBe(
      sha(`src/a.ts\u0000${A}\nselect\u0000docs/guide.md\u0000"Install"\u00001\n3\u0000abc\n`),
    );
  });

  it('length-prefixes each hash so boundaries cannot blur', () => {
    const one = [{ path: 'a', select: '1', hashes: ['ab', 'c'] }];
    const other = [{ path: 'a', select: '1', hashes: ['a', 'bc'] }];
    expect(dependencyHashFrom([], one)).not.toBe(dependencyHashFrom([], other));
  });

  it('counts bytes, not code units', () => {
    const fragments = [{ path: 'a', select: '1', hashes: ['é'] }];
    expect(dependencyHashFrom([], fragments)).toBe(sha('select\u0000a\u00001\u00001\n2\u0000é\n'));
  });
});
