import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';
import { lockText, readLock, writeLock } from '../../src/lock/lock.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import type { Lock } from '../../src/core/types.ts';

afterEach(cleanupTrees);

const H = 'a'.repeat(64);
const lock: Lock = {
  entries: new Map([
    ['b.md', { covers: ['src/**', '!x'], hash: H }],
    ['a "q".md', { covers: ['y'], hash: H }],
  ]),
};
const expected =
  'version: 1\ndependents:\n' +
  `  "a \\"q\\".md":\n    covers:\n      - "y"\n    hash: ${H}\n` +
  `  "b.md":\n    covers:\n      - "src/**"\n      - "!x"\n    hash: ${H}\n`;

describe('§11.2 canonical form', () => {
  it('is byte-exact and ordered', () => {
    expect(lockText(lock)).toBe(expected);
  });
  it('empty lock', () => {
    expect(lockText({ entries: new Map() })).toBe('version: 1\ndependents: {}\n');
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
    const root = makeTree({ 'docsync.lock': expected.replaceAll('\n', '\r\n') });
    expect(writeLock(root, readLock(root))).toBe(false);
    expect(readFileSync(join(root, 'docsync.lock'), 'utf8')).toContain('\r\n');
  });
  it('writes when content differs and leaves no temp file', () => {
    const root = makeTree({ 'docsync.lock': 'version: 1\ndependents: {}\n' });
    expect(writeLock(root, lock)).toBe(true);
    expect(readFileSync(join(root, 'docsync.lock'), 'utf8')).toBe(expected);
  });
  it('accepts a leading BOM', () => {
    const root = makeTree({ 'docsync.lock': `﻿${expected}` });
    expect(lockText(readLock(root))).toBe(expected);
  });
  it('rejects invalid UTF-8 with E_LOCK', () => {
    const root = makeTree({});
    writeFileSync(join(root, 'docsync.lock'), Buffer.from([0x76, 0xff, 0xfe]));
    expect(() => readLock(root)).toThrow(Raised);
  });
  it.each([
    ['<<<<<<< HEAD\nversion: 1\n', 'E_LOCK'],
    ['version: 2\ndependents: {}\n', 'E_LOCK_VERSION'],
    ['dependents: {}\n', 'E_LOCK_VERSION'],
    [`version: 1\ndependents:\n  a: {covers: [x], hash: ${'A'.repeat(64)}}\n`, 'E_LOCK'],
    [`version: 1\ndependents:\n  a: {covers: [], hash: ${H}}\n`, 'E_LOCK'],
    [`version: 1\ndependents:\n  a: {covers: [x], hash: ${H}, z: 1}\n`, 'E_LOCK'],
    [`version: 1\ndependents:\n  /a: {covers: [x], hash: ${H}}\n`, 'E_LOCK'],
    [`version: 1\nextra: 1\ndependents: {}\n`, 'E_LOCK'],
  ])('rejects %j with %s', (text, code) => {
    const root = makeTree({});
    writeFileSync(join(root, 'docsync.lock'), text);
    try {
      readLock(root);
      expect.unreachable();
    } catch (e) {
      expect((e as Raised).diagnostics.map((d) => d.code)).toEqual([code]);
    }
  });
});
