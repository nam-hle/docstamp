import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { memoryHost, type Entry, type MemoryOptions } from '../helpers/memory-fs.ts';
import { computeUniverse, determineRoot, isIgnoredPath } from '../../src/universe/walk.ts';
import { CONFIG_NAMES } from '../../src/config/value.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import type { Config } from '../../src/core/types.ts';

const config = (over: Partial<Config> = {}): Config => ({
  ignore: [],
  useGitignore: true,
  include: ['**/*.md'],
  presets: new Map(),
  defaultPresets: [],
  declarations: [],
  ...over,
});

const tree = (spec: Record<string, Entry>, options?: MemoryOptions) => {
  const host = memoryHost(spec, options);
  return { host, root: host.root };
};

const codes = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Raised) return e.diagnostics.map((d) => d.code);
  }
  return [];
};

describe('§6 determineRoot', () => {
  it('finds nearest docstamp.yaml upward', () => {
    const { host, root } = tree({ 'docstamp.yaml': '', 'a/b/x': '' });
    expect(determineRoot(host, join(root, 'a/b'), undefined)).toBe(root);
  });
  it('--root must exist', () => {
    expect(codes(() => determineRoot(memoryHost(), '/', '/nope/nope'))).toEqual(['E_ROOT']);
  });
  it('no docstamp.yaml raises E_CONFIG_MISSING', () => {
    const { host, root } = tree({ 'a/x': '' });
    expect(codes(() => determineRoot(host, join(root, 'a'), undefined))).toEqual([
      'E_CONFIG_MISSING',
    ]);
  });
  it.each(CONFIG_NAMES)('finds %s upward', (name) => {
    const { host, root } = tree({ [name]: '', 'a/b/x': '' });
    expect(determineRoot(host, join(root, 'a/b'), undefined)).toBe(root);
  });
  it('a directory named docstamp.yaml still counts as an entry', () => {
    const { host, root } = tree({ 'docstamp.yaml/x': '' });
    expect(determineRoot(host, root, undefined)).toBe(root);
  });
  it('without a configuration file the nearest .git directory is the root', () => {
    const { host, root } = tree({ '.git/HEAD': '', 'a/b/x': '', 'a/.git/HEAD': '' });
    expect(determineRoot(host, join(root, 'a/b'), undefined)).toBe(join(root, 'a'));
  });
  it('a .git file, as in a linked work tree, counts', () => {
    const { host, root } = tree({ '.git': 'gitdir: elsewhere\n', 'a/b/x': '' });
    expect(determineRoot(host, join(root, 'a/b'), undefined)).toBe(root);
  });
  it('a configuration file further up wins over a nearer .git', () => {
    const { host, root } = tree({ 'docstamp.yaml': '', 'a/.git/HEAD': '', 'a/b/x': '' });
    expect(determineRoot(host, join(root, 'a/b'), undefined)).toBe(root);
  });
  it('--root wins over both', () => {
    const { host, root } = tree({ 'docstamp.yaml': '', 'a/.git/HEAD': '' });
    expect(determineRoot(host, join(root, 'a'), '..')).toBe(root);
  });
});

describe('§7.2 computeUniverse', () => {
  it('honors nested .gitignore and excludes docstamp files and .git', () => {
    const { host, root } = tree({
      'docstamp.yaml': '',
      'docstamp-lock.yaml': '',
      '.gitignore': 'dist/\n',
      'dist/a.js': '',
      'src/a.ts': '',
      'src/.gitignore': '*.gen.ts\n',
      'src/b.gen.ts': '',
      '.git/HEAD': '',
      'sub/.git': 'gitdir: /abs',
      'sub/x.ts': '',
    });
    expect(computeUniverse(host, root, config()).paths).toEqual([
      '.gitignore',
      'src/.gitignore',
      'src/a.ts',
    ]);
  });
  it('a nested .gitignore does not affect sibling directories', () => {
    const { host, root } = tree({
      'src/.gitignore': '*.gen.ts\n',
      'src/a.gen.ts': '',
      'lib/a.gen.ts': '',
    });
    expect(computeUniverse(host, root, config()).paths).toEqual(['lib/a.gen.ts', 'src/.gitignore']);
  });
  it.each(CONFIG_NAMES)('removes %s at Root from the Universe', (name) => {
    const { host, root } = tree({ [name]: '', 'a.md': '' });
    expect(computeUniverse(host, root, config()).paths).toEqual(['a.md']);
  });
  it('a nested configuration file stays in the Universe', () => {
    const { host, root } = tree({ 'sub/docstamp.config.ts': '' });
    expect(computeUniverse(host, root, config()).paths).toEqual(['sub/docstamp.config.ts']);
  });
  it('a nested docstamp.yaml stays in the Universe', () => {
    const { host, root } = tree({
      'docstamp.yaml': '',
      'sub/docstamp.yaml': '',
      'sub/docstamp-lock.yaml': '',
    });
    expect(computeUniverse(host, root, config()).paths).toEqual([
      'sub/docstamp-lock.yaml',
      'sub/docstamp.yaml',
    ]);
  });
  it('a leftover docsync.lock stays in the Universe', () => {
    const { host, root } = tree({ 'docstamp.yaml': '', 'docsync.lock': '' });
    expect(computeUniverse(host, root, config()).paths).toEqual(['docsync.lock']);
  });
  it('gitignore:false ignores .gitignore files but not config ignore', () => {
    const { host, root } = tree({ '.gitignore': 'a\n', a: '', b: '' });
    expect(
      computeUniverse(host, root, config({ useGitignore: false, ignore: ['b'] })).paths,
    ).toEqual(['.gitignore', 'a']);
  });
  it('config ignore applies after .gitignore rules', () => {
    const { host, root } = tree({ '.gitignore': '!keep\n', keep: '', other: '' });
    expect(computeUniverse(host, root, config({ ignore: ['*'] })).paths).toEqual([]);
  });
  it('negation cannot re-include inside an ignored directory', () => {
    const { host, root } = tree({ '.gitignore': 'gen/\n!gen/keep.ts\n', 'gen/keep.ts': '' });
    expect(computeUniverse(host, root, config()).paths).toEqual(['.gitignore']);
  });
  it('links are entries, never followed', () => {
    const { host, root } = tree({ 'a.ts': '', 'l.ts': { link: 'a.ts' }, d: { link: '/etc' } });
    const u = computeUniverse(host, root, config());
    expect(u.paths).toEqual(['a.ts', 'd', 'l.ts']);
    expect(u.kinds.get('d')).toBe('link');
  });
  it('skips nested repositories', () => {
    const { host, root } = tree({ 'nested/.git/HEAD': '', 'nested/x': '', y: '' });
    expect(computeUniverse(host, root, config()).paths).toEqual(['y']);
  });
  it('does not descend into ignored directories (no reads)', () => {
    const { host, root } = tree(
      { '.gitignore': 'node_modules/\n', y: '', node_modules: { dir: true } },
      { unreadable: ['node_modules'] },
    );
    expect(computeUniverse(host, root, config()).paths).toEqual(['.gitignore', 'y']);
  });
  it('an unreadable directory raises E_UNREADABLE', () => {
    const { host, root } = tree({ y: '', locked: { dir: true } }, { unreadable: ['locked'] });
    expect(codes(() => computeUniverse(host, root, config()))).toEqual(['E_UNREADABLE']);
  });
});

describe('§7.4 / §7.5 collisions', () => {
  it('NFD names are converted to NFC', () => {
    const { host, root } = tree({ 'é.md': '' });
    const u = computeUniverse(host, root, config());
    expect(u.paths).toEqual(['é.md']);
    expect(u.onDisk.get('é.md')).toMatch(/^(é|é)\.md$/);
  });
  it('case collision is an error', () => {
    const { host, root } = tree({ 'A.md': '', 'a.md': '' });
    expect(codes(() => computeUniverse(host, root, config()))).toEqual(['E_PATH_COLLISION']);
  });
});

describe('§8.5 NOTE isIgnoredPath', () => {
  const ignoredBy = (files: Record<string, string>, over: Partial<Config>, ...paths: string[]) => {
    const { host, root } = tree(files);
    const universe = computeUniverse(host, root, config(over));
    return paths.map((path) => isIgnoredPath(host, root, universe, path));
  };

  it('records the entries a rule skipped, not what is below them', () => {
    const { host, root } = tree({
      '.gitignore': 'build/\n*.log\n',
      'build/a/b.js': '',
      'x.log': '',
      y: '',
    });
    expect(computeUniverse(host, root, config()).ignored).toEqual(['build', 'x.log']);
  });
  it('a gitignored file, a file below a gitignored directory and the directory itself', () => {
    const files = { '.gitignore': '.npmrc\nbuild/\n', '.npmrc': '', 'build/out/index.js': '' };
    expect(ignoredBy(files, {}, '.npmrc', 'build', 'build/out', 'build/out/index.js')).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
  it('an entry of the ignore list', () => {
    const files = { 'gen/types.ts': '', 'keep.ts': '' };
    expect(ignoredBy(files, { ignore: ['gen/'] }, 'gen', 'gen/types.ts', 'keep.ts')).toEqual([
      true,
      true,
      false,
    ]);
  });
  it('gitignore: false reads no .gitignore, so nothing is ignored', () => {
    const files = { '.gitignore': 'build/\n', 'build/o.js': '' };
    expect(ignoredBy(files, { useGitignore: false }, 'build', 'build/o.js')).toEqual([
      false,
      false,
    ]);
  });
  it('a path that does not exist is not ignored, even below an ignored directory', () => {
    const files = { '.gitignore': 'build/\n', 'build/o.js': '' };
    expect(ignoredBy(files, {}, 'build/nope.js', 'nope', 'nope/x')).toEqual([false, false, false]);
  });
  it('a directory that holds only ignored entries is ignored', () => {
    const files = { 'out/.gitignore': '*\n', 'out/a.js': '' };
    expect(ignoredBy(files, {}, 'out')).toEqual([true]);
  });
  it('a path in the Universe or a negated one is not ignored', () => {
    const files = { '.gitignore': '*.log\n!keep.log\n', 'keep.log': '', 'src/a.ts': '' };
    expect(ignoredBy(files, {}, 'keep.log', 'src', 'src/a.ts')).toEqual([false, false, false]);
  });
  it('a sibling that merely starts with the same letters is not ignored', () => {
    const files = { '.gitignore': 'build/\n', 'build/o.js': '', 'builder.ts': '' };
    expect(ignoredBy(files, {}, 'builder.ts', 'buil')).toEqual([false, false]);
  });
});
