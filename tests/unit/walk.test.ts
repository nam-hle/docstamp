import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { chmodSync, mkdirSync } from 'node:fs';
import { makeTree } from '../helpers/fixture.ts';
import { computeUniverse, determineRoot } from '../../src/universe/walk.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import type { Config } from '../../src/core/types.ts';

const config = (over: Partial<Config> = {}): Config => ({
  ignore: [],
  useGitignore: true,
  bindings: [],
  ...over,
});

const codes = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Raised) return e.diagnostics.map((d) => d.code);
  }
  return [];
};

describe('§6 determineRoot', () => {
  it('finds nearest docsync.yaml upward', () => {
    const root = makeTree({ 'docsync.yaml': '', 'a/b/x': '' });
    expect(determineRoot(join(root, 'a/b'), undefined)).toBe(root);
  });
  it('--root must exist', () => {
    expect(codes(() => determineRoot('/', '/nope/nope'))).toEqual(['E_ROOT']);
  });
  it('no docsync.yaml raises E_CONFIG_MISSING', () => {
    const root = makeTree({ 'a/x': '' });
    expect(codes(() => determineRoot(join(root, 'a'), undefined))).toEqual(['E_CONFIG_MISSING']);
  });
  it('a directory named docsync.yaml still counts as an entry', () => {
    const root = makeTree({ 'docsync.yaml/x': '' });
    expect(determineRoot(root, undefined)).toBe(root);
  });
});

describe('§7.2 computeUniverse', () => {
  it('honors nested .gitignore and excludes docsync files and .git', () => {
    const root = makeTree({
      'docsync.yaml': '',
      'docsync.lock': '',
      '.gitignore': 'dist/\n',
      'dist/a.js': '',
      'src/a.ts': '',
      'src/.gitignore': '*.gen.ts\n',
      'src/b.gen.ts': '',
      '.git/HEAD': '',
      'sub/.git': 'gitdir: /abs',
      'sub/x.ts': '',
    });
    expect(computeUniverse(root, config()).paths).toEqual([
      '.gitignore',
      'src/.gitignore',
      'src/a.ts',
    ]);
  });
  it('gitignore:false ignores .gitignore files but not config ignore', () => {
    const root = makeTree({ '.gitignore': 'a\n', a: '', b: '' });
    expect(computeUniverse(root, config({ useGitignore: false, ignore: ['b'] })).paths).toEqual([
      '.gitignore',
      'a',
    ]);
  });
  it('config ignore applies after .gitignore rules', () => {
    const root = makeTree({ '.gitignore': '!keep\n', keep: '', other: '' });
    expect(computeUniverse(root, config({ ignore: ['*'] })).paths).toEqual([]);
  });
  it('negation cannot re-include inside an ignored directory', () => {
    const root = makeTree({ '.gitignore': 'gen/\n!gen/keep.ts\n', 'gen/keep.ts': '' });
    expect(computeUniverse(root, config()).paths).toEqual(['.gitignore']);
  });
  it('links are entries, never followed', () => {
    const root = makeTree({ 'a.ts': '', 'l.ts': { link: 'a.ts' }, d: { link: '/etc' } });
    const u = computeUniverse(root, config());
    expect(u.paths).toEqual(['a.ts', 'd', 'l.ts']);
    expect(u.kinds.get('d')).toBe('link');
  });
  it('skips nested repositories', () => {
    const root = makeTree({ 'nested/.git/HEAD': '', 'nested/x': '', y: '' });
    expect(computeUniverse(root, config()).paths).toEqual(['y']);
  });
  it('does not descend into ignored directories (no reads)', () => {
    const root = makeTree({ '.gitignore': 'node_modules/\n', y: '' });
    mkdirSync(join(root, 'node_modules'));
    chmodSync(join(root, 'node_modules'), 0o000);
    expect(computeUniverse(root, config()).paths).toEqual(['.gitignore', 'y']);
  });
  it.runIf(process.getuid?.() !== 0)('unreadable directory raises E_UNREADABLE', () => {
    const root = makeTree({ y: '' });
    mkdirSync(join(root, 'locked'), { mode: 0o000 });
    expect(codes(() => computeUniverse(root, config()))).toEqual(['E_UNREADABLE']);
  });
});

describe('§7.4 / §7.5 collisions', () => {
  it('NFD names are converted to NFC', () => {
    const root = makeTree({ 'é.md': '' });
    const u = computeUniverse(root, config());
    expect(u.paths).toEqual(['é.md']);
    expect(u.onDisk.get('é.md')).toMatch(/^(é|é)\.md$/);
  });
  it.runIf(process.platform === 'linux')('case collision is an error', () => {
    const root = makeTree({ 'A.md': '', 'a.md': '' });
    expect(codes(() => computeUniverse(root, config()))).toEqual(['E_PATH_COLLISION']);
  });
});
