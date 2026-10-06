import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';
import { lockText, readLock, writeLock } from '../../src/lock/lock.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import type { Lock } from '../../src/core/types.ts';

afterEach(cleanupTrees);

const H = 'a'.repeat(64);
const lock: Lock = {
  entries: new Map([
    ['b.md', H],
    ['a "q".md', H],
  ]),
};
const expected = `version: 2\ndependents:\n  "a \\"q\\".md": ${H}\n  "b.md": ${H}\n`;
const LOCK = 'docstamp-lock.yaml';

const rejection = (root: string): Raised | undefined => {
  try {
    readLock(root);
  } catch (e) {
    return e as Raised;
  }
  return undefined;
};

describe('§11.2 canonical form', () => {
  it('is byte-exact and ordered', () => {
    expect(lockText(lock)).toBe(expected);
  });
  it('empty lock', () => {
    expect(lockText({ entries: new Map() })).toBe('version: 2\ndependents: {}\n');
  });
});

describe('§11.1 / §11.3 read and write', () => {
  it('round-trips', () => {
    const root = makeTree({});
    writeLock(root, lock);
    expect(lockText(readLock(root))).toBe(expected);
  });
  it('absent lock is empty', () => {
    expect(readLock(makeTree({})).entries.size).toBe(0);
  });
  it('tolerates CRLF lock and does not rewrite it', () => {
    const root = makeTree({ [LOCK]: expected.replaceAll('\n', '\r\n') });
    expect(writeLock(root, readLock(root))).toBe(false);
    expect(readFileSync(join(root, LOCK), 'utf8')).toContain('\r\n');
  });
  it('writes when content differs and leaves no temp file', () => {
    const root = makeTree({ [LOCK]: 'version: 2\ndependents: {}\n' });
    expect(writeLock(root, lock)).toBe(true);
    expect(readFileSync(join(root, LOCK), 'utf8')).toBe(expected);
    expect(readdirSync(root).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });
  it.each([
    ['all digits', '1'.repeat(64)],
    ['single e', `${'1'.repeat(10)}e${'1'.repeat(53)}`],
  ])('round-trips a numeric-looking hash (%s)', (_name, hash) => {
    const root = makeTree({});
    writeLock(root, { entries: new Map([['a.md', hash]]) });
    expect(readLock(root).entries.get('a.md')).toBe(hash);
  });
  it('accepts a leading BOM', () => {
    const root = makeTree({ [LOCK]: `﻿${expected}` });
    expect(lockText(readLock(root))).toBe(expected);
  });
  it('rejects invalid UTF-8 with E_LOCK', () => {
    const root = makeTree({});
    writeFileSync(join(root, LOCK), Buffer.from([0x76, 0xff, 0xfe]));
    expect(() => readLock(root)).toThrow(Raised);
  });
  it.each([
    ['<<<<<<< HEAD\nversion: 2\n', 'E_LOCK'],
    ['version: 1\ndependents: {}\n', 'E_LOCK_VERSION'],
    ['version: 3\ndependents: {}\n', 'E_LOCK_VERSION'],
    ['version: "2"\ndependents: {}\n', 'E_LOCK_VERSION'],
    ['dependents: {}\n', 'E_LOCK_VERSION'],
    [`version: 2\ndependents:\n  a: ${'A'.repeat(64)}\n`, 'E_LOCK'],
    [`version: 2\ndependents:\n  a: ${'a'.repeat(63)}\n`, 'E_LOCK'],
    [`version: 2\ndependents:\n  a: {covers: [x], hash: ${H}}\n`, 'E_LOCK'],
    [`version: 2\ndependents:\n  /a: ${H}\n`, 'E_LOCK'],
    [`version: 2\nextra: 1\ndependents: {}\n`, 'E_LOCK'],
    ['version: 2\ndependents: []\n', 'E_LOCK'],
  ])('rejects %j with %s', (text, code) => {
    const root = makeTree({});
    writeFileSync(join(root, LOCK), text);
    expect(rejection(root)?.diagnostics.map((d) => d.code)).toEqual([code]);
  });
});

describe('§11.1 step 1 legacy docsync.lock', () => {
  it.each([['version: 1\ndependents: {}\n'], ['garbage: ['], ['']])(
    'raises E_LOCK_VERSION for content %j, even beside a valid lock',
    (content) => {
      const root = makeTree({ 'docsync.lock': content, [LOCK]: expected });
      const [d, ...rest] = rejection(root)?.diagnostics ?? [];
      expect(rest).toEqual([]);
      expect(d?.code).toBe('E_LOCK_VERSION');
      expect(d?.subject).toBe('docsync.lock');
      expect(d?.message).toContain('delete docsync.lock');
      expect(d?.message).toContain('docstamp update --all');
    },
  );
});
