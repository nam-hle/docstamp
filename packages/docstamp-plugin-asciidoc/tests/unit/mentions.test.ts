import { describe, expect, it } from 'vitest';

import plugin from '../../src/index.ts';

const read = (text: string) => plugin.mentions({ path: 'docs/guide.adoc', text });

describe('§7 Mentions', () => {
  it('is a member of the plugin', () => {
    expect(plugin.mentions).toBeTypeOf('function');
  });
});

describe('§7.1 Mentions step 2 macros', () => {
  it('reads include, image, link and xref targets as links, as written', () => {
    const text = [
      'include::./assets/a.ts[tags="demo"]',
      'image::img/b.png[Alt]',
      'See image:img/c.png[] and link:./d.html[the d page] and xref:e.adoc#id[E].',
      '',
    ].join('\n');
    expect(read(text)).toEqual({
      links: ['./assets/a.ts', 'img/b.png', 'img/c.png', './d.html', 'e.adoc#id'],
      words: [],
    });
  });

  it('keeps a URL as written, for docstamp to drop', () => {
    expect(read('link:https://example.com/x[x]\n').links).toEqual(['https://example.com/x']);
  });

  it('drops an empty target, one with a blank and one with an attribute reference', () => {
    const text = 'include::[x]\nlink:a b[x]\ninclude::{partials}/a.adoc[]\nlink:ok.ts[x]\n';
    expect(read(text).links).toEqual(['ok.ts']);
  });

  it('needs a [ on the line and a macro at the start or after a blank', () => {
    expect(read('include::a.ts\n').links).toEqual([]);
    expect(read('not-a-link:a.ts[x] and mylink:b.ts[y]\n').links).toEqual([]);
    expect(read('\tlink:c.ts[z]\n').links).toEqual(['c.ts']);
  });

  it('does not read a macro twice or a macro inside the text of another', () => {
    const text = 'link:a.ts[see link:b.ts[b]] and `src/c.ts`\n';
    expect(read(text)).toEqual({ links: ['a.ts'], words: ['src/c.ts'] });
  });

  it('reads image:: before image:', () => {
    expect(read('image::a.png[]\n').links).toEqual(['a.png']);
  });
});

describe('§7.1 Mentions steps 3 and 4 words', () => {
  it('reads a code span without a blank as a word', () => {
    expect(read('Use `src/a.ts` and ` src/b.ts ` and `two words/here` and `x`.\n').words).toEqual([
      'src/a.ts',
      'src/b.ts',
      'x',
    ]);
  });

  it('reads a bare word with a slash and removes its trailing punctuation', () => {
    expect(read('See src/a.ts, then lib/b.ts. Also (core/c.ts); and "d/e.ts"!\n').words).toEqual([
      'src/a.ts',
      'lib/b.ts',
      'core/c.ts',
      'd/e.ts',
    ]);
  });

  it('skips a word that starts with * and a word without a slash', () => {
    expect(read('**/*.ts is a glob, */x too, and plain words\n').words).toEqual([]);
  });
});

describe('§7.1 Mentions step 1 blocks', () => {
  it('does not read a listing, literal, comment or passthrough block', () => {
    const text = [
      '----',
      'src/listing.ts',
      '----',
      '....',
      'src/literal.ts',
      '....',
      '////',
      'src/comment.ts',
      '////',
      '++++',
      'src/pass.ts',
      '++++',
      'src/read.ts',
      '',
    ].join('\n');
    expect(read(text).words).toEqual(['src/read.ts']);
  });

  it('reads an include line inside a listing, a literal and a passthrough block, but not a comment', () => {
    const text = [
      '[source,ts]',
      '----',
      'include::./a.ts[tags="demo"]',
      'src/listing.ts include::./not-at-start.ts[]',
      '----',
      '....',
      'include::./b.ts[]',
      '....',
      '++++',
      'include::./c.ts[]',
      '++++',
      '////',
      'include::./d.ts[]',
      '////',
      '',
    ].join('\n');
    expect(read(text)).toEqual({ links: ['./a.ts', './b.ts', './c.ts'], words: [] });
  });

  it('closes a block only at the same line, and lasts to the end if it is not closed', () => {
    const text = '------\nsrc/a.ts\n----\nsrc/b.ts\n------\nsrc/c.ts\n';
    expect(read(text).words).toEqual(['src/c.ts']);
    expect(read('----\nsrc/a.ts\n').words).toEqual([]);
  });

  it('ignores a comment line but not a // that is inside a line of prose', () => {
    expect(read('// src/a.ts\nsrc/b.ts\n').words).toEqual(['src/b.ts']);
    expect(read('see //host/path now\n').words).toEqual(['//host/path']);
  });

  it('reads CR LF as LF and trailing blanks after a delimiter', () => {
    expect(read('----  \r\nsrc/a.ts\r\n----\t\r\nsrc/b.ts\r\n').words).toEqual(['src/b.ts']);
  });
});
