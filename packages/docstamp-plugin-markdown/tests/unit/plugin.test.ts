import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import plugin from '../../src/index.ts';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const extract = (text: string, select: unknown): string[] => [
  ...plugin.extract({ path: 'guide.md', text, select: select as never }).hashes,
];

const DOC = '# One\nintro\n\n## Sub\nsub text\n\n# Two\ntwo text\n';

describe('§3 The Plugin', () => {
  it('registers for Markdown files', () => {
    expect(plugin.name).toBe('docstamp-plugin-markdown');
    expect(plugin.apiVersion).toBe(1);
    expect(plugin.files).toEqual(['**/*.md', '**/*.markdown']);
  });
});

describe('§4 Selector', () => {
  it('takes a string, or an object with heading and an optional level', () => {
    expect(extract(DOC, 'Sub')).toEqual([sha('## Sub\nsub text\n\n')]);
    expect(extract(DOC, { heading: 'Sub' })).toEqual([sha('## Sub\nsub text\n\n')]);
    expect(extract(DOC, { heading: 'Sub', level: 2 })).toEqual([sha('## Sub\nsub text\n\n')]);
  });

  it('removes leading and trailing blanks from the heading', () => {
    expect(extract(DOC, ' \tSub \t')).toEqual(extract(DOC, 'Sub'));
  });

  it('filters by level', () => {
    expect(extract(DOC, { heading: 'Sub', level: 1 })).toEqual([]);
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['a list', ['Sub']],
    ['an empty string', ''],
    ['blanks', ' \t '],
    ['an object without heading', {}],
    ['an empty heading', { heading: '' }],
    ['a heading that is not a string', { heading: 3 }],
    ['an unknown key', { heading: 'Sub', extra: 1 }],
    ['a level below 1', { heading: 'Sub', level: 0 }],
    ['a level above 6', { heading: 'Sub', level: 7 }],
    ['a level that is not an integer', { heading: 'Sub', level: 1.5 }],
    ['a level that is a string', { heading: 'Sub', level: '2' }],
  ])('raises for %s', (_, select) => {
    expect(() => extract(DOC, select)).toThrow();
  });
});

describe('§5.1 Body', () => {
  const frontmatter = (inner: string) => `---\n${inner}\n---\n${DOC}`;

  it('ignores the frontmatter: its lines are no headings and its edits change no section', () => {
    expect(extract(frontmatter('title: a\n# fake'), 'fake')).toEqual([]);
    expect(extract(frontmatter('title: a'), 'Two')).toEqual(
      extract(frontmatter('title: b\nother: 1'), 'Two'),
    );
    expect(extract(frontmatter('title: a'), 'One')).toEqual([
      sha('# One\nintro\n\n## Sub\nsub text\n\n'),
    ]);
  });

  it('closes the frontmatter with --- or ...', () => {
    expect(extract(`---\ntitle: a\n...\n${DOC}`, 'Two')).toEqual([sha('# Two\ntwo text\n')]);
  });

  it('reads an unterminated --- as text, not as frontmatter', () => {
    expect(extract(`---\n# kept\ntext\n`, 'kept')).toEqual([sha('# kept\ntext\n')]);
  });

  it('only a first line of exactly --- opens frontmatter', () => {
    expect(extract(`\n---\n# kept\n---\n`, 'kept')).toEqual([sha('# kept\n---\n')]);
  });
});

describe('§5.2 Headings', () => {
  it('ignores a # line in fenced code, tilde fences, indented code, comments and paragraphs', () => {
    const text = [
      '# Real',
      '```sh',
      '# fenced',
      '```',
      '~~~',
      '# tilde',
      '~~~~',
      '',
      '    # indented',
      '',
      '<!--',
      '# comment',
      '-->',
      '',
      '#hashtag',
      '',
    ].join('\n');
    for (const name of ['fenced', 'tilde', 'indented', 'comment', 'hashtag']) {
      expect(extract(text, name)).toEqual([]);
    }
    expect(extract(text, 'Real')).toEqual([sha(text)]);
  });

  it('finds setext headings', () => {
    const text = 'Title\n=====\nbody\n\nSub\n---\nmore\n';
    expect(extract(text, 'Title')).toEqual([sha(text)]);
    expect(extract(text, 'Sub')).toEqual([sha('Sub\n---\nmore\n')]);
  });

  it('drops the closing sequence and the surrounding spaces', () => {
    expect(extract('## Foo ##\nx\n', 'Foo')).toEqual([sha('## Foo ##\nx\n')]);
    expect(extract('##   Foo   \nx\n', 'Foo')).toEqual([sha('##   Foo   \nx\n')]);
  });

  it('takes headings that are not top-level out of the sections', () => {
    const text = '# Top\n\n> ## Quoted\n\n- ## Listed\n\n<div>\n## Html\n</div>\n\n## Next\nx\n';
    for (const name of ['Quoted', 'Listed', 'Html']) expect(extract(text, name)).toEqual([]);
    expect(extract(text, 'Top')).toEqual([
      sha('# Top\n\n> ## Quoted\n\n- ## Listed\n\n<div>\n## Html\n</div>\n\n## Next\nx\n'),
    ]);
  });

  it('matches the text as written: no entity or escape is decoded, no emphasis removed', () => {
    const text = '## *Fast* path\n\n## A &amp; B\n\n## Foo\\#\n';
    expect(extract(text, '*Fast* path')).toHaveLength(1);
    expect(extract(text, 'Fast path')).toEqual([]);
    expect(extract(text, 'A &amp; B')).toHaveLength(1);
    expect(extract(text, 'A & B')).toEqual([]);
    expect(extract(text, 'Foo\\#')).toHaveLength(1);
  });
});

describe('§5.3 Sections', () => {
  it('runs to the next heading of the same or a higher rank, subsections included', () => {
    expect(extract(DOC, 'One')).toEqual([sha('# One\nintro\n\n## Sub\nsub text\n\n')]);
    expect(extract('## A\na\n### Deep\nd\n## B\nb\n', 'A')).toEqual([
      sha('## A\na\n### Deep\nd\n'),
    ]);
    expect(extract('## A\na\n# B\nb\n', 'A')).toEqual([sha('## A\na\n')]);
  });

  it('runs to the end of the file for the last section, with or without a final newline', () => {
    expect(extract(DOC, 'Two')).toEqual([sha('# Two\ntwo text\n')]);
    expect(extract('# Only\nno newline', 'Only')).toEqual([sha('# Only\nno newline')]);
  });

  it('includes the blank lines before the next heading', () => {
    expect(extract('# A\na\n\n\n# B\n', 'A')).toEqual([sha('# A\na\n\n\n')]);
  });
});

describe('§6 Extract', () => {
  it('returns one hash per matching heading, in source order', () => {
    const text = '## Install\nfirst\n\n## Other\nx\n\n## Install\nsecond\n';
    expect(extract(text, 'Install')).toEqual([
      sha('## Install\nfirst\n\n'),
      sha('## Install\nsecond\n'),
    ]);
  });

  it('picks one of several by level', () => {
    const text = '# Install\nfirst\n\n## Install\nsecond\n';
    expect(extract(text, { heading: 'Install', level: 2 })).toEqual([sha('## Install\nsecond\n')]);
  });

  it('returns no hash when nothing matches', () => {
    expect(extract(DOC, 'Missing')).toEqual([]);
    expect(extract('', 'Missing')).toEqual([]);
  });

  it('gives the same hashes for CR LF text as for LF text', () => {
    expect(extract(DOC.replaceAll('\n', '\r\n'), 'Sub')).toEqual(extract(DOC, 'Sub'));
  });

  it('returns lower-case hexadecimal SHA-256 digests', () => {
    expect(extract(DOC, 'One')[0]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('changes the hash for an edit inside the section, a reformat, or a blank line added', () => {
    const base = extract(DOC, 'Sub');
    expect(extract(DOC.replace('sub text', 'sub text!'), 'Sub')).not.toEqual(base);
    expect(extract(DOC.replace('sub text', 'sub  text'), 'Sub')).not.toEqual(base);
    expect(extract(DOC.replace('sub text\n\n', 'sub text\n\n\n'), 'Sub')).not.toEqual(base);
  });

  it('keeps the hash for an edit above the heading or in another section', () => {
    const base = extract(DOC, 'Two');
    expect(extract(DOC.replace('intro', 'a new intro'), 'Two')).toEqual(base);
    expect(extract(DOC.replace('sub text', 'other'), 'Two')).toEqual(base);
    expect(extract(`preamble\n\n${DOC}`, 'Two')).toEqual(base);
  });
});

describe('§6 Extract: focus and lines', () => {
  const full = (text: string, select: unknown) =>
    plugin.extract({ path: 'guide.md', text, select: select as never });

  it('names the section and gives its lines, one of each per hash', () => {
    expect(full(DOC, 'Sub')).toMatchObject({
      focus: ['section "Sub" (level 2)'],
      lines: [{ start: 4, end: 6 }],
    });
    expect(full(DOC, 'One').lines).toEqual([{ start: 1, end: 6 }]);
    expect(full(DOC, 'Two').lines).toEqual([{ start: 7, end: 8 }]);
  });

  it('counts the lines of the whole text, frontmatter included', () => {
    const text = `---\ntitle: x\n---\n${DOC}`;
    expect(full(text, 'Sub').lines).toEqual([{ start: 7, end: 9 }]);
    expect(full(text, 'Two').lines).toEqual([{ start: 10, end: 11 }]);
  });

  it('ends a section on its last line when the file has no final newline', () => {
    expect(full('# A\ntext', 'A').lines).toEqual([{ start: 1, end: 2 }]);
  });

  it('gives one focus and one range per matching heading', () => {
    const text = '## Install\nfirst\n\n## Other\nx\n\n## Install\nsecond\n';
    expect(full(text, 'Install')).toMatchObject({
      focus: ['section "Install" (level 2)', 'section "Install" (level 2)'],
      lines: [
        { start: 1, end: 3 },
        { start: 7, end: 8 },
      ],
    });
  });

  it('counts CR LF text the same', () => {
    expect(full(DOC.replaceAll('\n', '\r\n'), 'Sub').lines).toEqual([{ start: 4, end: 6 }]);
  });

  it('gives neither when nothing matches', () => {
    expect(full(DOC, 'Missing')).toEqual({ hashes: [] });
  });
});
