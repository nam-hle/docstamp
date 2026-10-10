import { describe, expect, it } from 'vitest';
import { memoryHost, type Entry, type MemoryOptions } from '../helpers/memory-fs.ts';
import { lockText, readLock, writeLock } from '../../src/lock/lock.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import type { Lock } from '../../src/core/types.ts';
import type { Host } from '../../src/host/host.ts';

const tree = (spec: Record<string, Entry>, options?: MemoryOptions) => {
  const host = memoryHost(spec, options);
  return { host, root: host.root };
};

const H = 'a'.repeat(64);
const lock: Lock = {
  entries: new Map([
    ['b.md', H],
    ['a "q".md', H],
  ]),
};
const expected = `version: 3\nfiles:\n  "a \\"q\\".md": ${H}\n  "b.md": ${H}\n`;
const LOCK = 'docstamp-lock.yaml';

const rejection = (host: Host, root: string): Raised | undefined => {
  try {
    readLock(host, root);
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
    expect(lockText({ entries: new Map() })).toBe('version: 3\nfiles: {}\n');
  });
});

describe('§11.1 / §11.3 read and write', () => {
  it('round-trips', () => {
    const { host, root } = tree({});
    writeLock(host, root, lock);
    expect(lockText(readLock(host, root))).toBe(expected);
  });
  it('absent lock is empty', () => {
    const { host, root } = tree({});
    expect(readLock(host, root).entries.size).toBe(0);
  });
  it('tolerates CRLF lock and does not rewrite it', () => {
    const { host, root } = tree({ [LOCK]: expected.replaceAll('\n', '\r\n') });
    expect(writeLock(host, root, readLock(host, root))).toBe(false);
    expect(host.fs.text(LOCK)).toContain('\r\n');
  });
  it('writes when content differs and leaves no temp file', () => {
    const { host, root } = tree({ [LOCK]: 'version: 3\nfiles: {}\n' });
    expect(writeLock(host, root, lock)).toBe(true);
    expect(host.fs.text(LOCK)).toBe(expected);
    expect(host.fs.paths().filter((path) => path.includes('.tmp-'))).toEqual([]);
  });
  it.each([
    ['all digits', '1'.repeat(64)],
    ['single e', `${'1'.repeat(10)}e${'1'.repeat(53)}`],
  ])('round-trips a numeric-looking hash (%s)', (_name, hash) => {
    const { host, root } = tree({});
    writeLock(host, root, { entries: new Map([['a.md', hash]]) });
    expect(readLock(host, root).entries.get('a.md')).toBe(hash);
  });
  it('accepts a leading BOM', () => {
    const { host, root } = tree({ [LOCK]: `﻿${expected}` });
    expect(lockText(readLock(host, root))).toBe(expected);
  });
  it('rejects invalid UTF-8 with E_LOCK', () => {
    const { host, root } = tree({ [LOCK]: Buffer.from([0x76, 0xff, 0xfe]) });
    expect(() => readLock(host, root)).toThrow(Raised);
  });
  it('raises E_UNREADABLE when the lock cannot be written', () => {
    const { host, root } = tree({ [LOCK]: 'version: 3\nfiles: {}\n' }, { unreadable: [LOCK] });
    expect(() => writeLock(host, root, lock)).toThrow(Raised);
    expect(host.fs.text(LOCK)).toBe('version: 3\nfiles: {}\n');
  });
  it('raises E_UNREADABLE when the root is not writable', () => {
    const host = memoryHost({}, {}, '/repo');
    expect(() => writeLock(host, '/nowhere', lock)).toThrow(Raised);
  });
  it.each([
    ['<<<<<<< HEAD\nversion: 3\n', 'E_LOCK'],
    ['version: 1\ndependents: {}\n', 'E_LOCK_VERSION'],
    ['version: 2\ndependents: {}\n', 'E_LOCK_VERSION'],
    ['version: 4\nfiles: {}\n', 'E_LOCK_VERSION'],
    ['version: "3"\nfiles: {}\n', 'E_LOCK_VERSION'],
    ['files: {}\n', 'E_LOCK_VERSION'],
    ['version: 3\ndependents: {}\n', 'E_LOCK'],
    [`version: 3\nfiles:\n  a: ${'A'.repeat(64)}\n`, 'E_LOCK'],
    [`version: 3\nfiles:\n  a: ${'a'.repeat(63)}\n`, 'E_LOCK'],
    [`version: 3\nfiles:\n  a: {dependencies: [x], hash: ${H}}\n`, 'E_LOCK'],
    [`version: 3\nfiles:\n  /a: ${H}\n`, 'E_LOCK'],
    [`version: 3\nextra: 1\nfiles: {}\n`, 'E_LOCK'],
    ['version: 3\nfiles: []\n', 'E_LOCK'],
  ])('rejects %j with %s', (text, code) => {
    const { host, root } = tree({ [LOCK]: text });
    expect(rejection(host, root)?.diagnostics.map((d) => d.code)).toEqual([code]);
  });
});

describe('§11.1 step 4 version 2 Lockfile', () => {
  it('names the migration and keeps hash values valid', () => {
    const { host, root } = tree({ [LOCK]: `version: 2\ndependents:\n  a.md: ${H}\n` });
    const [d] = rejection(host, root)?.diagnostics ?? [];
    expect(d?.code).toBe('E_LOCK_VERSION');
    expect(d?.message).toContain('run "docstamp update --all" to rewrite it as version 3');
    expect(d?.message).toContain('(hashes are unchanged)');
  });
});

describe('§11.1 step 1 legacy docsync.lock', () => {
  it.each([['version: 1\ndependents: {}\n'], ['garbage: ['], ['']])(
    'raises E_LOCK_VERSION for content %j, even beside a valid lock',
    (content) => {
      const { host, root } = tree({ 'docsync.lock': content, [LOCK]: expected });
      const [d, ...rest] = rejection(host, root)?.diagnostics ?? [];
      expect(rest).toEqual([]);
      expect(d?.code).toBe('E_LOCK_VERSION');
      expect(d?.subject).toBe('docsync.lock');
      expect(d?.message).toContain('delete docsync.lock');
      expect(d?.message).toContain('docstamp update --all');
    },
  );
});
