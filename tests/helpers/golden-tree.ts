import type { TreeSpec } from './fixture.ts';

// SPEC §17.7: the fixed tree behind the golden vectors. Never edit it without a new Lockfile version.
export const GOLDEN_TREE: TreeSpec = {
  'DOC.md': '# Doc\n',
  'Zed.txt': 'upper case sorts before lower case\n',
  'ä.txt': 'precomposed\n',
  '.gitignore': '*.log\n!keep.log\nbuild/\n',
  '.hidden/h.txt': 'hidden\n',
  'src/plain.txt': 'hello\n',
  'src/crlf.txt': 'a\r\nb\r\n',
  'src/lf.txt': 'a\nb\n',
  'src/cr.txt': 'a\rb\r\nc\r',
  'src/bom.txt': '﻿hello\n',
  'src/blob.bin': Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x80, 0x00]),
  'src/empty.txt': '',
  'src/link.txt': { link: 'plain.txt' },
  'src/dangling.txt': { link: '../gone/x.txt' },
  'lib/a.ts': 'export const a = 1;\n',
  'lib/b.ts': 'export const b = 2;\n',
  'lib/deep/c.ts': 'export const c = 3;\n',
  'lib/deep/c.test.ts': 'test c\n',
  'lib/skip.log': 'ignored by .gitignore\n',
  'lib/keep.log': 're-included by !keep.log\n',
  'build/out.js': 'ignored directory\n',
  'vendor/v.js': 'ignored by config\n',
  'nested/.gitignore': 'secret.txt\n',
  'nested/secret.txt': 'ignored by nested .gitignore\n',
  'nested/open.txt': 'visible\n',
  'inner/.git': 'gitdir: elsewhere\n',
  'inner/f.txt': 'nested repository\n',
};

export const GOLDEN_IGNORE = ['vendor/'];

const HASH_A = `v1:${'0123456789abcdef'.repeat(4)}`;
const HASH_B = `v1:${'fedcba9876543210'.repeat(4)}`;
const block = (dependencies: string, hash: string, eol = '\n') =>
  `---${eol}title: t${eol}docstamp:${eol}  dependencies: ${dependencies}${eol}${hash}---${eol}body${eol}`;

// SPEC §17.7: inline files; never edit without a new Lockfile version and prefix.
export const INLINE_GOLDEN_TREE: TreeSpec = {
  'src/a.ts': 'a\n',
  'without.md': block('[src]', ''),
  'with.md': block('[src]', `  hash: ${HASH_A}\n`),
  'with-other.md': block('[src]', `  hash: ${HASH_B}\n`),
  'deps.md': block('[src, other]', ''),
  'crlf.md': block('[src]', `  hash: ${HASH_A}\r\n`, '\r\n'),
  'bom.md': `﻿${block('[src]', `  hash: ${HASH_A}\n`)}`,
  'outside.txt': block('[src]', `  hash: ${HASH_A}\n`),
  'plain.md': '---\ntitle: t\n---\nbody\n',
};
