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
