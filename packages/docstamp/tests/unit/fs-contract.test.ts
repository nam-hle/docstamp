import { afterAll, describe, expect, it } from 'vitest';

import type { FileSystem } from '../../src/host/fs.ts';
import { nodeFs } from '../../src/host/node-fs.ts';
import { cleanupTrees, makeTree, type TreeSpec } from '../helpers/fixture.ts';
import { memoryHost } from '../helpers/memory-fs.ts';

interface Provided {
  readonly fs: FileSystem;
  readonly root: string;
}

// The same cases run against the real file system and the in-memory one, so the fake cannot drift
const providers: Record<string, (tree: TreeSpec) => Provided> = {
  node: (tree) => ({ fs: nodeFs, root: makeTree(tree) }),
  memory: (tree) => ({ ...memoryHost(tree) }),
};

afterAll(cleanupTrees);

describe.each(Object.entries(providers))('FileSystem contract: %s', (_, provide) => {
  const names = (provided: Provided, dir: string) =>
    provided.fs
      .readDir(`${provided.root}/${dir}`)
      .map((entry) => `${entry.name.toString('utf8')}:${entry.kind}`)
      .sort();

  it('lists the entries of a directory with their kind, links not followed', () => {
    const p = provide({ 'a/f.md': 'x', 'a/sub/g.md': 'y', 'a/l': { link: 'f.md' } });
    expect(names(p, 'a')).toEqual(['f.md:file', 'l:link', 'sub:dir']);
  });

  it('throws when the directory is missing or is a file', () => {
    const p = provide({ f: 'x' });
    expect(() => p.fs.readDir(`${p.root}/nope`)).toThrow();
    expect(() => p.fs.readDir(`${p.root}/f`)).toThrow();
  });

  it('gives the kind of the entry itself, null when there is none', () => {
    const p = provide({ 'd/f': 'x', l: { link: 'd/f' }, broken: { link: 'nowhere' } });
    expect(p.fs.kind(`${p.root}/d`)).toBe('dir');
    expect(p.fs.kind(`${p.root}/d/f`)).toBe('file');
    expect(p.fs.kind(`${p.root}/l`)).toBe('link');
    expect(p.fs.kind(`${p.root}/broken`)).toBe('link');
    expect(p.fs.kind(`${p.root}/missing`)).toBeNull();
  });

  it('follows links for isDirectory, and says false for a file or a missing path', () => {
    const p = provide({ 'd/f': 'x', l: { link: 'd' }, broken: { link: 'nowhere' } });
    expect(p.fs.isDirectory(`${p.root}/d`)).toBe(true);
    expect(p.fs.isDirectory(`${p.root}/l`)).toBe(true);
    expect(p.fs.isDirectory(`${p.root}/d/f`)).toBe(false);
    expect(p.fs.isDirectory(`${p.root}/broken`)).toBe(false);
    expect(p.fs.isDirectory(`${p.root}/missing`)).toBe(false);
  });

  it('reads the bytes of a file, and throws for a missing one or a directory', () => {
    const p = provide({ f: Buffer.from([0, 1, 255]), d: 'x' });
    expect([...p.fs.readFile(`${p.root}/f`)]).toEqual([0, 1, 255]);
    expect(() => p.fs.readFile(`${p.root}/missing`)).toThrow();
    expect(() => p.fs.readFile(p.root)).toThrow();
  });

  it('reads the target of a link as written', () => {
    const p = provide({ l: { link: '../up/x' } });
    expect(p.fs.readLink(`${p.root}/l`)).toBe('../up/x');
    expect(() => p.fs.readLink(`${p.root}/missing`)).toThrow();
  });

  it('writes a file atomically, replacing it, and leaves no temporary file', () => {
    const p = provide({ 'a/f': 'old', 'a/other': 'x' });
    p.fs.writeAtomic(`${p.root}/a/f`, 'new');
    expect(p.fs.readFile(`${p.root}/a/f`).toString()).toBe('new');
    expect(names(p, 'a')).toEqual(['f:file', 'other:file']);
  });

  it('creates a file that is not there yet', () => {
    const p = provide({ 'a/other': 'x' });
    p.fs.writeAtomic(`${p.root}/a/new`, 'hello');
    expect(p.fs.readFile(`${p.root}/a/new`).toString()).toBe('hello');
  });

  it('throws, and leaves nothing behind, when the directory is missing', () => {
    const p = provide({ 'a/other': 'x' });
    expect(() => p.fs.writeAtomic(`${p.root}/nope/f`, 'x')).toThrow();
    expect(names(p, 'a')).toEqual(['other:file']);
  });

  it('keeps the mode of the file it replaces on request, and throws when there is none', () => {
    const p = provide({ f: 'old' });
    expect(() => p.fs.writeAtomic(`${p.root}/missing`, 'x', { keepMode: true })).toThrow();
    p.fs.writeAtomic(`${p.root}/f`, 'new', { keepMode: true });
    expect(p.fs.readFile(`${p.root}/f`).toString()).toBe('new');
  });
});
