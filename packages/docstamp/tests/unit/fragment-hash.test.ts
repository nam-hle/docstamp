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
    const fragments = [{ path: 'docs/guide.md', select: '"Install"', parts: [{ content: 'abc' }] }];
    expect(dependencyHashFrom([['src/a.ts', A]], fragments)).toBe(
      sha(`src/a.ts\u0000${A}\nselect\u0000docs/guide.md\u0000"Install"\u00001\n${sha('abc')}\n`),
    );
  });

  it('hashes the content of each part, in order', () => {
    const fragments = [{ path: 'a', select: '1', parts: [{ content: 'x' }, { content: 'y' }] }];
    expect(dependencyHashFrom([], fragments)).toBe(
      sha(`select\u0000a\u00001\u00002\n${sha('x')}\n${sha('y')}\n`),
    );
    const swapped = [{ path: 'a', select: '1', parts: [{ content: 'y' }, { content: 'x' }] }];
    expect(dependencyHashFrom([], swapped)).not.toBe(dependencyHashFrom([], fragments));
  });

  it('counts the parts, so a split cannot blur into a join', () => {
    const one = [{ path: 'a', select: '1', parts: [{ content: 'ab' }] }];
    const two = [{ path: 'a', select: '1', parts: [{ content: 'a' }, { content: 'b' }] }];
    expect(dependencyHashFrom([], one)).not.toBe(dependencyHashFrom([], two));
  });

  it('hashes the bytes of the content, so an empty part is a part', () => {
    const none = [{ path: 'a', select: '1', parts: [] }];
    const empty = [{ path: 'a', select: '1', parts: [{ content: '' }] }];
    expect(dependencyHashFrom([], empty)).toBe(sha(`select\u0000a\u00001\u00001\n${sha('')}\n`));
    expect(dependencyHashFrom([], empty)).not.toBe(dependencyHashFrom([], none));
  });

  it('never reads a focus or lines', () => {
    const plain = [{ path: 'a', select: '1', parts: [{ content: 'x' }] }];
    const described = [
      {
        path: 'a',
        select: '1',
        parts: [{ content: 'x', focus: 'f', lines: { start: 1, end: 2 } }],
      },
    ];
    expect(dependencyHashFrom([], described)).toBe(dependencyHashFrom([], plain));
  });
});
