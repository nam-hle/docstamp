import { describe, expect, it } from 'vitest';
import { Raised } from '../../src/core/diagnostics.ts';
import { parseBlock } from '../../src/inline/block.ts';
import { scanFrontmatter } from '../../src/inline/frontmatter.ts';
import { writeBlock } from '../../src/inline/write-block.ts';

const DEPS = ['src/cli', '!src/cli/**/*.test.*', 'docs/SPEC.md'];
const HASH = 'a'.repeat(64);
const BLOCK = (eol: string, indent = '  ') =>
  `docstamp:${eol}${indent}dependencies:${eol}${DEPS.map((d) => `${indent}  - ${d.startsWith('!') ? JSON.stringify(d) : d}${eol}`).join('')}`;

const refusal = (text: string, deps: readonly string[] = DEPS) => {
  try {
    writeBlock('d.md', text, deps);
  } catch (error) {
    if (error instanceof Raised) return error.diagnostics[0]!;
    throw error;
  }
  throw new Error('not refused');
};

describe('§9.6.5 Writing a Block', () => {
  describe('step 4 a file with no frontmatter', () => {
    it('creates a frontmatter with only the block and keeps the body', () => {
      expect(writeBlock('d.md', '# Title\n\ntext\n', DEPS)).toBe(
        `---\n${BLOCK('\n')}---\n# Title\n\ntext\n`,
      );
    });
    it('keeps a byte order mark first and uses CR LF when the file does', () => {
      expect(writeBlock('d.md', '﻿# Title\r\ntext\r\n', DEPS)).toBe(
        `﻿---\r\n${BLOCK('\r\n')}---\r\n# Title\r\ntext\r\n`,
      );
    });
    it('an empty file becomes a frontmatter only', () => {
      expect(writeBlock('d.md', '', ['src'])).toBe(
        '---\ndocstamp:\n  dependencies:\n    - src\n---\n',
      );
    });
    it('a file that starts with --- but never closes it gets a frontmatter before it', () => {
      expect(writeBlock('d.md', '---\nbody\n', ['src'])).toBe(
        '---\ndocstamp:\n  dependencies:\n    - src\n---\n---\nbody\n',
      );
    });
    it('a file with a single line and no terminator keeps it', () => {
      expect(writeBlock('d.md', 'text', ['src'])).toBe(
        '---\ndocstamp:\n  dependencies:\n    - src\n---\ntext',
      );
    });
  });

  describe('step 3 frontmatter without a block', () => {
    it('inserts the block before the closing line and changes no other line', () => {
      const text = '---\ntitle: Doc\ntags: [a, b]\n---\nbody\n';
      expect(writeBlock('d.md', text, DEPS)).toBe(
        `---\ntitle: Doc\ntags: [a, b]\n${BLOCK('\n')}---\nbody\n`,
      );
    });
    it('keeps the byte order mark and CR LF', () => {
      const text = '﻿---\r\ntitle: Doc\r\n---\r\nbody\r\n';
      expect(writeBlock('d.md', text, DEPS)).toBe(
        `﻿---\r\ntitle: Doc\r\n${BLOCK('\r\n')}---\r\nbody\r\n`,
      );
    });
    it('fills an empty frontmatter', () => {
      expect(writeBlock('d.md', '---\n---\nbody\n', ['src'])).toBe(
        '---\ndocstamp:\n  dependencies:\n    - src\n---\nbody\n',
      );
    });
    it('a closing line without a terminator is kept as it is', () => {
      expect(writeBlock('d.md', '---\ntitle: x\n---', ['src'])).toBe(
        '---\ntitle: x\ndocstamp:\n  dependencies:\n    - src\n---',
      );
    });
  });

  describe('step 2 a block without a hash', () => {
    it('replaces the lines of the block and nothing else', () => {
      const text =
        '---\ntitle: Doc\ndocstamp: # why\n  dependencies: [old]\nauthor: me\n---\nbody\n';
      expect(writeBlock('d.md', text, DEPS)).toBe(
        `---\ntitle: Doc\ndocstamp: # why\n  dependencies:\n${DEPS.map((d) => `    - ${d.startsWith('!') ? JSON.stringify(d) : d}\n`).join('')}author: me\n---\nbody\n`,
      );
    });
    it('keeps the indentation of the block and blank lines after it', () => {
      const text = '---\ndocstamp:\n    dependencies:\n        - old\n\n---\n';
      expect(writeBlock('d.md', text, ['src'])).toBe(
        '---\ndocstamp:\n    dependencies:\n      - src\n\n---\n',
      );
    });
    it('keeps CR LF and the byte order mark', () => {
      const text = '﻿---\r\ndocstamp:\r\n  dependencies: [old]\r\n---\r\nbody\r\n';
      expect(writeBlock('d.md', text, DEPS)).toBe(`﻿---\r\n${BLOCK('\r\n')}---\r\nbody\r\n`);
    });
    it('fills an empty block', () => {
      expect(writeBlock('d.md', '---\ndocstamp:\n---\nb\n', ['src'])).toBe(
        '---\ndocstamp:\n  dependencies:\n    - src\n---\nb\n',
      );
    });
    it('is idempotent', () => {
      const once = writeBlock('d.md', '# T\n', DEPS);
      expect(writeBlock('d.md', once, DEPS)).toBe(once);
      const crlf = writeBlock('d.md', '﻿---\r\nt: 1\r\n---\r\n', DEPS);
      expect(writeBlock('d.md', crlf, DEPS)).toBe(crlf);
    });
    it('never writes a hash line', () => {
      for (const text of [
        'x\n',
        '---\na: 1\n---\n',
        '---\ndocstamp:\n  dependencies: [a]\n---\n',
      ]) {
        expect(scanFrontmatter(writeBlock('d.md', text, DEPS))!.hashLines).toEqual([]);
      }
    });
  });

  describe('refusals raise E_USAGE and say to edit by hand', () => {
    it('a block that records a hash', () => {
      const text = `---\ndocstamp:\n  dependencies: [a]\n  hash: ${HASH}\n---\n`;
      const refused = refusal(text);
      expect([refused.code, refused.subject]).toEqual(['E_USAGE', 'd.md']);
      expect(refused.message).toContain('by hand');
    });
    it('a hash line that is malformed is still a hash line', () => {
      expect(refusal('---\ndocstamp:\n  dependencies: [a]\n  hash: nope\n---\n').code).toBe(
        'E_USAGE',
      );
    });
    it('a block that uses presets', () => {
      const refused = refusal('---\ndocstamp:\n  dependencies: [a]\n  use: [tests]\n---\n');
      expect([refused.code, refused.subject]).toEqual(['E_USAGE', 'd.md']);
      expect(refused.message).toContain('by hand');
    });
    it('a block that is not a block mapping', () => {
      expect(refusal('---\ndocstamp: {dependencies: [a]}\n---\n').message).toContain('by hand');
    });
    it('a frontmatter that is not strict YAML', () => {
      expect(refusal('---\nbase: &a 1\nref: *a\n---\n').message).toContain('by hand');
    });
    it('a frontmatter that already has a quoted docstamp key', () => {
      expect(refusal('---\n"docstamp": x\n---\n').code).toBe('E_USAGE');
    });
    it('a frontmatter that is a flow mapping', () => {
      expect(refusal('---\n{a: 1}\n---\n').code).toBe('E_USAGE');
    });
  });

  describe('step 1 quoting', () => {
    const roundTrip = (patterns: string[]) => {
      const text = writeBlock('d.md', '', patterns);
      return parseBlock('d.md', scanFrontmatter(text)!).declaration.dependencies;
    };
    it.each([
      ['src/cli', 'src/cli'],
      ['.github', '.github'],
      ['src/**/*.ts', 'src/**/*.ts'],
      ['src/{a,b}.ts', 'src/{a,b}.ts'],
      ['docs/SPEC.md', 'docs/SPEC.md'],
      ['a=b/c@d+e', 'a=b/c@d+e'],
    ])('%s is plain', (pattern, expected) => {
      expect(writeBlock('d.md', '', [pattern])).toContain(`    - ${expected}\n`);
    });
    it.each([
      '!src/**/*.test.*',
      '*.md',
      '[ab]/c',
      '{a,b}/c',
      '-x/y',
      '2024/notes.md',
      'true',
      'No',
      'null',
      '.inf',
      '.5/x',
      'a b/c',
      'a:b/c',
      'a #b/c',
      'src/cli (old)',
      'é/ü',
      '~/x',
      '"q"/x',
    ])('%s is quoted and parses back to itself', (pattern) => {
      const text = writeBlock('d.md', '', [pattern]);
      expect(text).toContain(`    - "`);
      expect(roundTrip([pattern])).toEqual([pattern]);
    });
    it('a whole list parses back in order', () => {
      expect(roundTrip(DEPS)).toEqual(DEPS);
    });
  });
});
