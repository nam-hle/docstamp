import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from '../../src/cli/workspace.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import { fileHash } from '../../src/hash/hash.ts';
import { parseBlock } from '../../src/inline/block.ts';
import { recordedHash, scanFrontmatter, stampText } from '../../src/inline/frontmatter.ts';
import { stampFile } from '../../src/inline/read-inline.ts';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';

afterEach(cleanupTrees);

const H = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const doc = (block: string) => ['---', 'title: t', block, '---', 'body', ''].join('\n');
const BLOCK = 'docstamp:\n  dependencies: [src]';
const scanOf = (text: string) => scanFrontmatter(text)!;
const problems = (text: string) =>
  parseBlock('d.md', scanOf(text)).problems.map((d) => [d.code, d.subject]);

describe('§5.6 ScanFrontmatter', () => {
  it('finds a column 0 docstamp: key between the delimiters', () => {
    const scan = scanOf(doc(BLOCK));
    expect([scan.marker, scan.close, scan.last, scan.keyIndent]).toEqual([2, 4, 3, '  ']);
  });
  it.each([
    ['no frontmatter', 'docstamp:\n  dependencies: [a]\n'],
    ['no closing delimiter', '---\ndocstamp:\n  dependencies: [a]\n'],
    ['a delimiter that is not the first line', '\n---\ndocstamp:\n  dependencies: [a]\n---\n'],
    ['an indented key', '---\n  docstamp:\n    dependencies: [a]\n---\n'],
    ['a quoted key', '---\n"docstamp":\n  dependencies: [a]\n---\n'],
    ['a longer key', '---\ndocstamp-x: 1\n---\n'],
    ['the key in the body', '---\ntitle: t\n---\ndocstamp:\n  dependencies: [a]\n'],
  ])('is none for %s', (_name, text) => {
    expect(scanFrontmatter(text)).toBeNull();
  });
  it('accepts a byte order mark, CR LF and trailing blanks on the delimiters', () => {
    const text = '﻿---  \r\ndocstamp:\r\n  dependencies: [a]\r\n---\t\r\nbody\r\n';
    const scan = scanOf(text);
    expect([scan.bom, scan.marker, scan.close]).toEqual(['﻿', 1, 3]);
  });
  it('a closing delimiter at the end of the text needs no terminator', () => {
    expect(scanFrontmatter('---\ndocstamp:\n  dependencies: [a]\n---')).not.toBeNull();
  });
  it('the block ends at the first unindented line', () => {
    const scan = scanOf('---\ndocstamp:\n  dependencies: [a]\n\n  # note\nnext: 1\n---\n');
    expect([scan.last, scan.close]).toEqual([4, 6]);
  });
  it('hash lines are the keyIndent lines starting with hash:', () => {
    const scan = scanOf(
      `---\ndocstamp:\n  dependencies:\n    - a\n  hash: ${H}\n    hash: nested\n---\n`,
    );
    expect(scan.hashLines).toEqual([4]);
  });
  it('the key indent skips comment lines', () => {
    expect(scanOf('---\ndocstamp:\n  # c\n\tdependencies: [a]\n---\n').keyIndent).toBe('\t');
  });
});

describe('§9.6.2 ParseBlock', () => {
  it('reads dependencies and a recorded hash', () => {
    const text = doc(`${BLOCK}\n  hash: ${H}`);
    const { declaration, problems: found } = parseBlock('d.md', scanOf(text));
    expect(found).toEqual([]);
    expect(declaration).toEqual({
      file: 'd.md',
      dependencies: ['src'],
      inline: { recorded: H },
    });
  });
  it('a hash of digits only is still a string (plain source, not a number)', () => {
    const text = doc(`${BLOCK}\n  hash: ${'1'.repeat(64)}`);
    expect(problems(text)).toEqual([]);
  });
  it('a block with no hash is unrecorded', () => {
    expect(parseBlock('d.md', scanOf(doc(BLOCK))).declaration.inline).toEqual({ recorded: null });
  });
  it('accepts a block sequence, comments and a comment after the hash', () => {
    const text = `---\ndocstamp: # why\n  # note\n  dependencies:\n    - src\n    - "!src/x"\n  hash: ${H} # ok\n---\n`;
    expect(problems(text)).toEqual([]);
  });
  it.each([
    ['a flow mapping', '---\ndocstamp: {dependencies: [a]}\n---\n', [['E_BLOCK', 'docstamp']]],
    ['a scalar', '---\ndocstamp: yes\n---\n', [['E_BLOCK', 'docstamp']]],
    ['an empty value', '---\ndocstamp:\n---\n', [['E_BLOCK', 'docstamp']]],
    ['a sequence', '---\ndocstamp:\n  - a\n---\n', [['E_BLOCK', 'docstamp']]],
    ['a duplicate key', `---\n${BLOCK}\n${BLOCK}\n---\n`, [['E_BLOCK', 'frontmatter']]],
    ['an anchor', `---\nx: &a 1\n${BLOCK}\n---\n`, [['E_BLOCK', 'frontmatter']]],
    ['a tab indent', '---\ndocstamp:\n\tdependencies: [a]\n---\n', [['E_BLOCK', 'frontmatter']]],
    ['no dependencies', '---\ndocstamp:\n  hash: ' + H + '\n---\n', [['E_BLOCK', 'dependencies']]],
    [
      'empty dependencies',
      '---\ndocstamp:\n  dependencies: []\n---\n',
      [['E_BLOCK', 'dependencies']],
    ],
    [
      'a string dependency list',
      '---\ndocstamp:\n  dependencies: a\n---\n',
      [['E_BLOCK', 'dependencies']],
    ],
    [
      'a non-string dependency',
      '---\ndocstamp:\n  dependencies: [1]\n---\n',
      [['E_BLOCK', 'dependencies']],
    ],
    ['an unknown key', `---\n${BLOCK}\n  extra: 1\n---\n`, [['E_UNKNOWN_KEY', 'extra']]],
    [
      'an invalid pattern',
      '---\ndocstamp:\n  dependencies: ["/abs"]\n---\n',
      [['E_PATTERN', '/abs']],
    ],
    ['a v1: prefix', `---\n${BLOCK}\n  hash: v1:${H}\n---\n`, [['E_BLOCK', 'hash']]],
    ['a v2 hash', `---\n${BLOCK}\n  hash: v2:${H}\n---\n`, [['E_BLOCK', 'hash']]],
    [
      'an upper case hash',
      `---\n${BLOCK}\n  hash: ${H.toUpperCase()}\n---\n`,
      [['E_BLOCK', 'hash']],
    ],
    ['a short hash', `---\n${BLOCK}\n  hash: abc\n---\n`, [['E_BLOCK', 'hash']]],
    ['a quoted hash', `---\n${BLOCK}\n  hash: "${H}"\n---\n`, [['E_BLOCK', 'hash']]],
    ['a quoted hash key', `---\n${BLOCK}\n  "hash": ${H}\n---\n`, [['E_BLOCK', 'hash']]],
    ['a hash on the next line', `---\n${BLOCK}\n  hash:\n    ${H}\n---\n`, [['E_BLOCK', 'hash']]],
    ['a null hash', `---\n${BLOCK}\n  hash:\n---\n`, [['E_BLOCK', 'hash']]],
    [
      'a duplicate hash',
      `---\n${BLOCK}\n  hash: ${H}\n  hash: ${H}\n---\n`,
      [['E_BLOCK', 'frontmatter']],
    ],
  ])('%s', (_name, text, expected) => {
    expect(problems(text)).toEqual(expected);
  });
  it('collects every problem of a block', () => {
    const text = '---\ndocstamp:\n  dependencies: ["/a", "/b"]\n  x: 1\n  hash: no\n---\n';
    expect(problems(text)).toEqual([
      ['E_UNKNOWN_KEY', 'x'],
      ['E_PATTERN', '/a'],
      ['E_PATTERN', '/b'],
      ['E_BLOCK', 'hash'],
    ]);
  });
  it('an invalid block keeps its patterns when they are a list of strings', () => {
    const { declaration } = parseBlock(
      'd.md',
      scanOf('---\ndocstamp:\n  dependencies: [a]\n  x: 1\n---\n'),
    );
    expect(declaration.dependencies).toEqual(['a']);
  });
});

describe('§9.6.4 Stamp', () => {
  const stamp = (text: string) => stampText(scanOf(text), OTHER);
  it('replaces only the value of an existing hash line', () => {
    const before = `---\ndocstamp:\n  dependencies: [src] # keep\n  hash: ${H}   # note\n  tail: 1\n---\nbody\n`;
    expect(stamp(before)).toBe(before.replace(H, OTHER));
  });
  it('appends the hash as the last key, with the block indentation', () => {
    expect(stamp('---\ndocstamp:\n    dependencies: [src]\n---\nbody\n')).toBe(
      `---\ndocstamp:\n    dependencies: [src]\n    hash: ${OTHER}\n---\nbody\n`,
    );
  });
  it('appends after the last non blank line of a block that is not last in the frontmatter', () => {
    const before =
      '---\ndocstamp:\n  dependencies:\n    - a # c\n\n  # trailing\n\nafter: 1\n---\n';
    expect(stamp(before)).toBe(
      `---\ndocstamp:\n  dependencies:\n    - a # c\n\n  # trailing\n  hash: ${OTHER}\n\nafter: 1\n---\n`,
    );
  });
  it('keeps CR LF line endings and the byte order mark', () => {
    const before = '﻿---\r\ndocstamp:\r\n  dependencies: [a]\r\n---\r\nbody\r\n';
    expect(stamp(before)).toBe(
      `﻿---\r\ndocstamp:\r\n  dependencies: [a]\r\n  hash: ${OTHER}\r\n---\r\nbody\r\n`,
    );
  });
  it('a CR LF file with a hash line keeps every other byte', () => {
    const before = `---\r\ndocstamp:\r\n  dependencies: [a]\r\n  hash: ${H}\r\n---\r\nbody\r\n`;
    expect(stamp(before)).toBe(before.replace(H, OTHER));
  });
  it('a closing delimiter without a final newline survives', () => {
    expect(stamp('---\ndocstamp:\n  dependencies: [a]\n---')).toBe(
      `---\ndocstamp:\n  dependencies: [a]\n  hash: ${OTHER}\n---`,
    );
  });
  it('stamping twice with the same hash changes nothing the second time', () => {
    const once = stamp('---\ndocstamp:\n  dependencies: [a]\n---\n');
    expect(stampText(scanOf(once), OTHER)).toBe(once);
  });
  it('recordedHash reads what a stamp wrote', () => {
    expect(recordedHash(stamp('---\ndocstamp:\n  dependencies: [a]\n---\n'))).toBe(OTHER);
    expect(recordedHash('---\ndocstamp:\n  dependencies: [a]\n---\n')).toBeNull();
    expect(recordedHash('# plain\n')).toBeNull();
  });
  it('stampFile writes atomically, keeps the mode, and leaves no temporary file', () => {
    const root = makeTree({ 'd.md': '---\ndocstamp:\n  dependencies: [src]\n---\nbody\n' });
    const universe = { paths: ['d.md'], kinds: new Map(), onDisk: new Map() };
    stampFile(root, universe, 'd.md', H);
    expect(readFileSync(join(root, 'd.md'), 'utf8')).toBe(
      `---\ndocstamp:\n  dependencies: [src]\n  hash: ${H}\n---\nbody\n`,
    );
    expect(() => stampFile(root, universe, 'gone.md', H)).toThrow(Raised);
  });
});

describe('§10.2 hash input rule for inline files', () => {
  const hashes = (files: Record<string, string>) => {
    const root = makeTree({ 'src/a.ts': 'a\n', ...files });
    const { universe } = loadWorkspace(root);
    return (path: string) => fileHash(root, universe, path);
  };
  const withBlock = (deps: string, hash = '') =>
    `---\nt: 1\ndocstamp:\n  dependencies: ${deps}\n${hash}---\nbody\n`;

  it('a block with and without a hash line hash identically', () => {
    const hash = hashes({
      'a.md': withBlock('[src]'),
      'b.md': withBlock('[src]', `  hash: ${H}\n`),
      'c.md': withBlock('[src]', `  hash: ${OTHER}\n`),
    });
    expect(hash('b.md')).toBe(hash('a.md'));
    expect(hash('c.md')).toBe(hash('a.md'));
  });
  it('the dependencies list, the prose and other frontmatter do count', () => {
    const hash = hashes({
      'a.md': withBlock('[src]'),
      'deps.md': withBlock('[src, x]'),
      'prose.md': withBlock('[src]').replace('body', 'other body'),
      'meta.md': withBlock('[src]').replace('t: 1', 't: 2'),
    });
    const base = hash('a.md');
    for (const name of ['deps.md', 'prose.md', 'meta.md']) expect(hash(name)).not.toBe(base);
  });
  it('a CR LF file hashes like its LF twin', () => {
    const lf = withBlock('[src]', `  hash: ${H}\n`);
    const hash = hashes({ 'lf.md': lf, 'crlf.md': lf.replaceAll('\n', '\r\n') });
    expect(hash('crlf.md')).toBe(hash('lf.md'));
  });
  it('a byte order mark counts', () => {
    const text = withBlock('[src]', `  hash: ${H}\n`);
    const hash = hashes({ 'a.md': text, 'bom.md': `﻿${text}` });
    expect(hash('bom.md')).not.toBe(hash('a.md'));
  });
  it('only a file that include selects loses its hash line', () => {
    const text = withBlock('[src]', `  hash: ${H}\n`);
    const plain = withBlock('[src]');
    const hash = hashes({ 'docs/a.md': text, 'docs/b.md': plain, 'a.txt': text, 'b.txt': plain });
    expect(hash('docs/a.md')).toBe(hash('docs/b.md'));
    expect(hash('a.txt')).not.toBe(hash('b.txt'));
  });
  it('a file with no block hashes with every line of its text', () => {
    const hash = hashes({
      'docstamp.yaml': 'version: 2\nfiles: {}\n',
      'a.md': '---\nt: 1\nhash: ' + H + '\n---\nbody\n',
      'b.md': '---\nt: 1\n---\nbody\n',
    });
    expect(hash('a.md')).not.toBe(hash('b.md'));
  });
});

describe('§12.2 loadWorkspace', () => {
  const load = (files: Record<string, string>) => loadWorkspace(makeTree(files));
  const failure = (files: Record<string, string>) => {
    try {
      load(files);
    } catch (e) {
      if (e instanceof Raised) return e.diagnostics.map((d) => d.code);
      throw e;
    }
    return [];
  };
  const config = (extra: string, files = 'files: {}') => `version: 2\n${extra}${files}\n`;

  it('a Root with no configuration file and no inline block is E_CONFIG_MISSING', () => {
    expect(failure({ 'a.md': '# plain\n', 'src/a.ts': 'a\n' })).toEqual(['E_CONFIG_MISSING']);
  });
  it('a Root with no configuration file and an inline block works', () => {
    const ws = load({ 'a.md': withDeps('[src]'), 'src/a.ts': 'a\n' });
    expect(ws.declarations.map((d) => d.file)).toEqual(['a.md']);
  });
  it('a Root with a configuration file and no files is no error', () => {
    expect(failure({ 'docstamp.yaml': config('') })).toEqual([]);
  });
  it('include defaults to **/*.md', () => {
    const ws = load({
      'a.md': withDeps('[src]'),
      'sub/b.md': withDeps('[src]'),
      'c.txt': withDeps('[src]'),
      'src/a.ts': 'a\n',
    });
    expect(ws.declarations.map((d) => d.file)).toEqual(['a.md', 'sub/b.md']);
  });
  it('include replaces the default', () => {
    const ws = load({
      'docstamp.yaml': config('include: ["notes/**", "*.txt"]\n'),
      'a.md': withDeps('[src]'),
      'notes/b.md': withDeps('[src]'),
      'c.txt': withDeps('[src]'),
      'src/a.ts': 'a\n',
    });
    expect(ws.declarations.map((d) => d.file)).toEqual(['c.txt', 'notes/b.md']);
  });
  it('an ignored file is not an inline file', () => {
    const ws = load({
      '.gitignore': 'ignored.md\n',
      'ignored.md': withDeps('[src]'),
      'a.md': withDeps('[src]'),
      'src/a.ts': 'a\n',
    });
    expect(ws.declarations.map((d) => d.file)).toEqual(['a.md']);
  });
  it('frontmatter without a docstamp key is never parsed', () => {
    const ws = load({
      'a.md': withDeps('[src]'),
      'other.md': '---\nx: &a 1\ny: *a\n\t: bad\n---\n',
      'src/a.ts': 'a\n',
    });
    expect(ws.declarations.map((d) => d.file)).toEqual(['a.md']);
    expect(ws.attached).toEqual([]);
  });
  it('binary and non UTF-8 files are skipped', () => {
    const root = makeTree({ 'a.md': withDeps('[src]'), 'src/a.ts': 'a\n' });
    writeFileSync(join(root, 'bin.md'), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0x00, 0xff]));
    writeFileSync(
      join(root, 'latin.md'),
      Buffer.from('---\ndocstamp:\n  dependencies: [é]\n---\n', 'latin1'),
    );
    expect(loadWorkspace(root).declarations.map((d) => d.file)).toEqual(['a.md']);
  });
  it('a file declared inline and under files is E_DUPLICATE_DECLARATION, not merged', () => {
    const ws = load({
      'docstamp.yaml': config('', 'files:\n  a.md:\n    dependencies: [src]'),
      'a.md': withDeps('[src]'),
      'src/a.ts': 'a\n',
    });
    expect(ws.declarations).toEqual([{ file: 'a.md', dependencies: ['src'] }]);
    expect(ws.attached.map((d) => [d.code, d.file])).toEqual([['E_DUPLICATE_DECLARATION', 'a.md']]);
  });
  it('a malformed block still yields a declaration whose file is invalid', () => {
    const ws = load({
      'a.md': '---\ndocstamp:\n  x: 1\n---\n',
      'b.md': withDeps('[src]'),
      'src/a.ts': 'a\n',
    });
    expect(ws.declarations.map((d) => d.file)).toEqual(['a.md', 'b.md']);
    expect(ws.attached.map((d) => [d.code, d.file])).toEqual([
      ['E_UNKNOWN_KEY', 'a.md'],
      ['E_BLOCK', 'a.md'],
    ]);
  });
  it('the marked files hold their hash lines for the hash rule', () => {
    const root = makeTree({
      'a.md': `---\ndocstamp:\n  dependencies: [src]\n  hash: ${H}\n---\n`,
      'src/a.ts': 'a\n',
    });
    expect(loadWorkspace(root).universe.marked?.get('a.md')).toEqual([3]);
  });
});

function withDeps(deps: string): string {
  return `---\ndocstamp:\n  dependencies: ${deps}\n---\nbody\n`;
}
