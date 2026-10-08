import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkspace } from '../../src/cli/workspace.ts';
import { evaluate, resolveDependencies } from '../../src/engine/evaluate.ts';
import { expandPresets } from '../../src/engine/presets.ts';
import { fileHash } from '../../src/hash/hash.ts';
import { select } from '../../src/pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../../src/pattern/parse.ts';
import { computeUniverse, type Universe } from '../../src/universe/walk.ts';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';
import { GOLDEN_IGNORE, GOLDEN_TREE, INLINE_GOLDEN_TREE } from '../helpers/golden-tree.ts';

afterEach(cleanupTrees);

const BREAKING =
  'This hash changed. That is a BREAKING change (SPEC §17): bump the lock version, update the ' +
  'migration note, and title the PR `feat!:`/`fix!:`.';
const SELECTION_BREAKING =
  'This selection changed. That is a BREAKING change (SPEC §17): bump the lock version, update ' +
  'the migration note, and title the PR `feat!:`/`fix!:`.';

const config = { ignore: GOLDEN_IGNORE, useGitignore: true, declarations: [] };

interface Golden {
  root: string;
  universe: Universe;
  dependencyHash: (dependencies: string[]) => string;
}

function golden(): Golden {
  const root = makeTree(GOLDEN_TREE);
  const universe = computeUniverse(root, config);
  const dependencyHash = (dependencies: string[]) =>
    evaluate({ file: 'DOC.md', dependencies }, universe.paths, { entries: new Map() }, [], {
      isStampedFile: () => true,
      fileHash: (path) => fileHash(root, universe, path),
    }).current;
  return { root, universe, dependencyHash };
}

describe('§17.7 golden file hashes', () => {
  const expected: Record<string, string> = {
    'src/plain.txt': 'e9eccd80570fc6ff6c0f1a32492ca695b0cef8cd1937cd12bee7db8db5e81052',
    'src/crlf.txt': 'f0c9f78697c76b8a667bcdfc1e80f88e4ab3595dee06d884bbf1d06adbd12337',
    'src/lf.txt': 'f0c9f78697c76b8a667bcdfc1e80f88e4ab3595dee06d884bbf1d06adbd12337',
    'src/cr.txt': '8906ac51c1ec4bc3c6d6eea0541bfa002a46f769feacf3591ba0198035752fc1',
    'src/bom.txt': 'a8310a52ace3df3f7061defd6d1138c309a3f90c2aaa151fab5eb297d083f9ff',
    'src/blob.bin': '7c4c0f7d00b2907db95784c739fb96a946a6bf6c980f053bce3f73b264cbe205',
    'src/empty.txt': '665b9b46b49bbf8a926dd2b17751fa203125e3efaf20830f005b29e5cc268ee5',
    'src/link.txt': '2bcb27d511e698eb8536004914ed8109411c67f1bf7f2214ece79a5dc01eff91',
    'src/dangling.txt': '2350d48e46900ea4f8f06311dcf7a7ddba96fb93ba68ffefe7345d61e068eac8',
  };

  it.each(Object.entries(expected))('%s', (path, hash) => {
    const { root, universe } = golden();
    expect(fileHash(root, universe, path), BREAKING).toBe(hash);
  });
});

describe('§17.7 golden Dependency Hashes', () => {
  const expected: Array<[string, string[], string]> = [
    [
      'plain text',
      ['src/plain.txt'],
      '012c7497f40bbb4fad0a2e20ac158e0dc9162fe4ff53f3a5f058f4b14a0c8bd1',
    ],
    [
      'CR LF text',
      ['src/crlf.txt'],
      '4144d767c8569d61e2aa84d0ef7f49ad85e26d35cd8b1c0df0064086b26bb9e3',
    ],
    ['LF text', ['src/lf.txt'], 'b8e0b2ea9250c714e9d96b04e27c9a16bc444c26da19b3f29d20c3aa4a8415d8'],
    [
      'lone CR and CR LF mixed',
      ['src/cr.txt'],
      'ec8a290851c337a7a195cf674b79172dda238082adcd81d6839a4a7b2c225c84',
    ],
    [
      'byte order mark',
      ['src/bom.txt'],
      '7f82733988425a34fdd331f0ca7a6a2f2e95a5ad6861a7d1b6bb4ff747bdbc3b',
    ],
    [
      'binary bytes',
      ['src/blob.bin'],
      '5b01f69e583f6e6ef91aff7d641ac6fc883fa6bbcf161db0fc0841443a367691',
    ],
    [
      'empty file',
      ['src/empty.txt'],
      '6703582afe2758d5fe6d7110c6c38d700481030267556969630df4036a3f939e',
    ],
    [
      'symbolic link',
      ['src/link.txt'],
      'c77efc5493b3b855bc2616d7341543d4514d3d1241bf0641a6ad1a3424cb1c54',
    ],
    [
      'dangling link',
      ['src/dangling.txt'],
      '58cad289cc49e85a3752b0ee15f109397093217da7a3dedee6b0b2f14280ee4e',
    ],
    [
      'directory of several files',
      ['lib'],
      'b00736eb8b18211084f4b04aecbd363f243f4ff40d41d43aa835ce690a9e6e0b',
    ],
    [
      'glob with negation',
      ['lib/**', '!lib/**/*.test.ts'],
      '97ff4d865e72240db975685d37471a6c60e69aee9d67f641401e7d333ff88a37',
    ],
    [
      'entry order, as declared',
      ['src/plain.txt', 'lib'],
      '77f339ed09b2e6a839973f28bf573e7a39aafd8ea597f9e87c39f1d2c6589860',
    ],
    [
      'entry order, reversed declaration',
      ['lib', 'src/plain.txt'],
      '77f339ed09b2e6a839973f28bf573e7a39aafd8ea597f9e87c39f1d2c6589860',
    ],
  ];

  it.each(expected)('%s', (_name, dependencies, hash) => {
    expect(golden().dependencyHash(dependencies), BREAKING).toBe(hash);
  });

  it('a deleted dependency changes the directory hash', () => {
    const { root, dependencyHash } = golden();
    rmSync(join(root, 'lib/b.ts'));
    const universe = computeUniverse(root, config);
    const after = evaluate(
      { file: 'DOC.md', dependencies: ['lib'] },
      universe.paths,
      { entries: new Map() },
      [],
      { isStampedFile: () => true, fileHash: (path) => fileHash(root, universe, path) },
    ).current;
    expect(dependencyHash(['lib'])).not.toBe(after);
    expect(after, BREAKING).toBe(
      'f964ac2fffe823698937a8a631d3dfd3c29a5d92ed91547368e4b7eda2a7db12',
    );
  });
});

describe('§17.7 golden selection', () => {
  const patterns = (sources: string[]) =>
    sources.map((source) => parsePattern(source)).filter((p): p is ParsedPattern => p !== null);

  it('the Universe: ignore rules, .gitignore, nested repositories, links, path order', () => {
    expect(golden().universe.paths, SELECTION_BREAKING).toEqual([
      '.gitignore',
      '.hidden/h.txt',
      'DOC.md',
      'Zed.txt',
      'lib/a.ts',
      'lib/b.ts',
      'lib/deep/c.test.ts',
      'lib/deep/c.ts',
      'lib/keep.log',
      'nested/.gitignore',
      'nested/open.txt',
      'src/blob.bin',
      'src/bom.txt',
      'src/cr.txt',
      'src/crlf.txt',
      'src/dangling.txt',
      'src/empty.txt',
      'src/lf.txt',
      'src/link.txt',
      'src/plain.txt',
      'ä.txt',
    ]);
  });

  it('directory, negation, class, alternation and last match wins', () => {
    const { universe } = golden();
    const sources = [
      'lib',
      '!lib/deep',
      'lib/deep/c.test.ts',
      'src/[bc]*.txt',
      'src/{plain,empty}.txt',
      '!src/empty.txt',
      '*.txt',
      '!nested/*',
      '.hidden',
    ];
    expect(select(patterns(sources), universe.paths), SELECTION_BREAKING).toEqual([
      '.hidden/h.txt',
      'Zed.txt',
      'lib/a.ts',
      'lib/b.ts',
      'lib/deep/c.test.ts',
      'lib/keep.log',
      'src/bom.txt',
      'src/cr.txt',
      'src/crlf.txt',
      'src/plain.txt',
      'ä.txt',
    ]);
  });

  it('a leading dot is an ordinary character, and every pattern must match', () => {
    const { universe } = golden();
    const resolved = resolveDependencies(
      { file: 'DOC.md', dependencies: ['Z*.txt', '.*/*', '**/*.log'] },
      universe.paths,
    );
    expect(resolved, SELECTION_BREAKING).toEqual(['.hidden/h.txt', 'Zed.txt', 'lib/keep.log']);
  });
});

describe('§17.7 golden presets', () => {
  const presets = new Map([['quiet', ['!lib/**/*.test.ts', '!lib/keep.log']]]);
  const own = ['lib', '*.txt'];
  const explicit = [...own, '!lib/**/*.test.ts', '!lib/keep.log'];

  it('a preset expands to the selection of its patterns written out', () => {
    const { universe } = golden();
    const expanded = expandPresets(
      { file: 'DOC.md', dependencies: own, use: ['quiet'] },
      presets,
      [],
      true,
    );
    expect(expanded.dependencies).toEqual(explicit);
    expect(resolveDependencies(expanded, universe.paths), SELECTION_BREAKING).toEqual([
      'Zed.txt',
      'lib/a.ts',
      'lib/b.ts',
      'lib/deep/c.ts',
      'ä.txt',
    ]);
  });

  it('the Dependency Hash depends on the selection only, not on how it was written', () => {
    const { dependencyHash } = golden();
    const literal = ['Zed.txt', 'lib/a.ts', 'lib/b.ts', 'lib/deep/c.ts', 'ä.txt'];
    expect(dependencyHash(explicit), BREAKING).toBe(
      '339924de829984dbc301ca12bddd3df121b27731a3ba60422492032c191f5743',
    );
    expect(dependencyHash(literal)).toBe(dependencyHash(explicit));
  });
});

describe('§17.7 golden inline files', () => {
  const inline = () => {
    const root = makeTree(INLINE_GOLDEN_TREE);
    const { universe } = loadWorkspace(root);
    return { root, universe };
  };
  const expected: Record<string, string> = {
    'without.md': '0b96181a7fae2381f131a3d01662ab90f482886f4d5f7e38fdc9d78a6a196e15',
    'with.md': '0b96181a7fae2381f131a3d01662ab90f482886f4d5f7e38fdc9d78a6a196e15',
    'with-other.md': '0b96181a7fae2381f131a3d01662ab90f482886f4d5f7e38fdc9d78a6a196e15',
    'crlf.md': '0b96181a7fae2381f131a3d01662ab90f482886f4d5f7e38fdc9d78a6a196e15',
    'deps.md': '2ee7bbf4136754b105b7d64b05df89f11f3a2143323b4df8e7b9c73d01c91983',
    'bom.md': 'f442e46a1d48a7b5dd6c9fc313df86570cf65643ac9db9946533c7be0c302dcb',
    'outside.txt': '3edd4d19f2bf4d8a3ab5c9c1fc37c1d5f76aa4e897f00bd716d95614ef0438ca',
    'plain.md': '8095494ef76326cc53ca864551f2851d6bc2464ca7200c4a75d2e75e2a12a817',
  };

  it.each(Object.entries(expected))('%s', (path, hash) => {
    const { root, universe } = inline();
    expect(fileHash(root, universe, path), BREAKING).toBe(hash);
  });

  it('a block with and without a hash line, in LF and CR LF, hash identically', () => {
    const { root, universe } = inline();
    const hashes = ['without.md', 'with.md', 'with-other.md', 'crlf.md'].map((path) =>
      fileHash(root, universe, path),
    );
    expect(new Set(hashes).size, BREAKING).toBe(1);
  });

  it('a changed dependencies list, a byte order mark and a file outside include change it', () => {
    const { root, universe } = inline();
    const hash = (path: string) => fileHash(root, universe, path);
    expect(hash('deps.md')).not.toBe(hash('without.md'));
    expect(hash('bom.md')).not.toBe(hash('with.md'));
    expect(hash('outside.txt')).not.toBe(hash('with.md'));
  });

  it('the Dependency Hash over inline files', () => {
    const { root, universe } = inline();
    const dependencyHash = evaluate(
      { file: 'DOC.md', dependencies: ['deps.md', 'with.md'] },
      universe.paths,
      { entries: new Map() },
      [],
      { isStampedFile: () => true, fileHash: (path) => fileHash(root, universe, path) },
    ).current;
    expect(dependencyHash, BREAKING).toBe(
      '3a55c8a5c25de7c67d79fb34c7692fa74b79973a7e8943fd69db2cafaaef1b8b',
    );
  });
});
