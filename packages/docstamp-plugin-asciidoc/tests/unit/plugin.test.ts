import { describe, expect, it } from 'vitest';

import plugin from '../../src/index.ts';
import { parseSelect } from '../../src/parse-select.ts';
import { headings, titleText } from '../../src/sections.ts';

const extract = (text: string, select: unknown) =>
  plugin.extract({ path: 'guide.adoc', text, select: select as never });

const contents = (text: string, select: unknown): string[] =>
  (extract(text, select).parts ?? []).map((part) => part.content);

const DOC = [
  '= Guide',
  '',
  'Intro.',
  '',
  '== One',
  'one text',
  '',
  '=== Sub',
  'sub text',
  '',
  '== Two',
  'two text',
  '',
].join('\n');

describe('§3 The Plugin', () => {
  it('registers for AsciiDoc files', () => {
    expect(plugin.name).toBe('docstamp-plugin-asciidoc');
    expect(plugin.apiVersion).toBe(1);
    expect(plugin.files).toEqual(['**/*.adoc', '**/*.asciidoc', '**/*.asc']);
  });
});

describe('§4 Selector', () => {
  it('takes a string, or an object with a title and an optional level', () => {
    const sub = ['=== Sub\nsub text\n\n'];
    expect(contents(DOC, 'Sub')).toEqual(sub);
    expect(contents(DOC, { title: 'Sub' })).toEqual(sub);
    expect(contents(DOC, { title: 'Sub', level: 3 })).toEqual(sub);
  });

  it('takes an anchor', () => {
    const text = '== A\n\n[#target]\n== B\nb\n\n== C\n';
    expect(contents(text, { anchor: 'target' })).toEqual(['[#target]\n== B\nb\n\n']);
  });

  it('removes leading and trailing blanks from the title and the anchor', () => {
    expect(contents(DOC, ' \tSub \t')).toEqual(contents(DOC, 'Sub'));
    const text = '[#x]\n== A\n';
    expect(contents(text, { anchor: ' x ' })).toEqual(contents(text, { anchor: 'x' }));
  });

  it('filters by level, counting the = of the marker', () => {
    expect(contents(DOC, { title: 'Sub', level: 2 })).toEqual([]);
    expect(contents(DOC, { title: 'One', level: 2 })).toHaveLength(1);
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['a list', ['Sub']],
    ['an empty string', ''],
    ['blanks', ' \t '],
    ['an object without title or anchor', {}],
    ['an empty title', { title: '' }],
    ['a title that is not a string', { title: 3 }],
    ['an unknown key', { title: 'Sub', extra: 1 }],
    ['a level below 1', { title: 'Sub', level: 0 }],
    ['a level above 6', { title: 'Sub', level: 7 }],
    ['a level that is not an integer', { title: 'Sub', level: 1.5 }],
    ['a level that is a string', { title: 'Sub', level: '2' }],
    ['an empty anchor', { anchor: '' }],
    ['an anchor that is not a string', { anchor: 1 }],
    ['an anchor with a title', { anchor: 'a', title: 'Sub' }],
    ['an anchor with a level', { anchor: 'a', level: 2 }],
  ])('reports an error for %s', (_, select) => {
    const result = extract(DOC, select);
    expect(result.parts).toBeUndefined();
    expect(result.diagnostics?.[0]?.severity).toBe('error');
    expect(result.diagnostics?.[0]?.code).toBe('invalid-selector');
  });
});

describe('§4.1 ParseSelect', () => {
  it('reads a level marker as a title and a level', () => {
    expect(parseSelect('== Install')).toEqual({ select: { title: 'Install', level: 2 } });
    expect(parseSelect('=\tInstall  ')).toEqual({ select: { title: 'Install', level: 1 } });
    expect(parseSelect('====== Deep')).toEqual({ select: { title: 'Deep', level: 6 } });
  });

  it('reads #id as an anchor', () => {
    expect(parseSelect('#install-steps')).toEqual({ select: { anchor: 'install-steps' } });
    expect(parseSelect('#install-steps \t')).toEqual({ select: { anchor: 'install-steps' } });
  });

  it('reads any other text as the title itself', () => {
    expect(parseSelect('Install')).toEqual({ select: 'Install' });
    expect(parseSelect('Q&A, part 2 = 3')).toEqual({ select: 'Q&A, part 2 = 3' });
    expect(parseSelect('==Install')).toEqual({ select: '==Install' });
    expect(parseSelect('# Install')).toEqual({ select: '# Install' });
    expect(parseSelect('#')).toEqual({ select: '#' });
  });

  it('refuses a marker without a title and a marker above six', () => {
    for (const raw of ['== ', '==\t \t', '======= Deep']) {
      expect(parseSelect(raw).diagnostics?.[0]).toMatchObject({
        severity: 'error',
        code: 'invalid-selector',
      });
    }
  });
});

describe('§5.1 Source', () => {
  it('reads CR LF as LF', () => {
    expect(contents(DOC.replaceAll('\n', '\r\n'), 'Sub')).toEqual(contents(DOC, 'Sub'));
  });
});

describe('§5.2 Sections', () => {
  it('finds sections at every depth, in source order', () => {
    expect(headings(DOC).map(({ level, title }) => [level, title])).toEqual([
      [2, 'One'],
      [3, 'Sub'],
      [2, 'Two'],
    ]);
  });

  it('ignores a == line in a listing, a literal block and a comment block', () => {
    const text = [
      '== Real',
      '----',
      '== Listing',
      '----',
      '....',
      '== Literal',
      '....',
      '////',
      '== Comment',
      '////',
      '// == Line comment',
      '',
    ].join('\n');
    expect(headings(text).map(({ title }) => title)).toEqual(['Real']);
  });

  it('ignores a discrete heading', () => {
    expect(headings('== Real\n\n[discrete]\n== Floating\n\ntext\n').map((h) => h.title)).toEqual([
      'Real',
    ]);
  });

  it('reads no file for an include and keeps the line numbers', () => {
    const text = '== A\n\ninclude::missing.adoc[]\n\n== B\nb\n';
    expect(headings(text).map(({ title, titleLine }) => [title, titleLine])).toEqual([
      ['A', 1],
      ['B', 5],
    ]);
  });

  it('gives an anchor only to a section that has an explicit one', () => {
    const text = '[[legacy]]\n== One\n\n[#modern]\n== Two\n\n[id=attr]\n== Three\n\n== Four\n';
    expect(headings(text).map((h) => h.anchor)).toEqual(['legacy', 'modern', 'attr', undefined]);
  });

  it('prints nothing for a duplicate id', () => {
    const text = '[#same]\n== One\n\n[#same]\n== Two\n';
    expect(() => headings(text)).not.toThrow();
  });
});

describe('§5.3 Title', () => {
  it.each([
    ['== Install', 'Install'],
    ['==   Install  ', 'Install'],
    ['== Install ==', 'Install'],
    ['== Install ===', 'Install'],
    ['== Install==', 'Install=='],
    ['## Install', 'Install'],
    ['== *Fast* path', '*Fast* path'],
    ['== A = B', 'A = B'],
    ['Setext Title', 'Setext Title'],
    ['  Setext Title  ', 'Setext Title'],
  ])('reads %j as %j', (line, title) => {
    expect(titleText(line)).toBe(title);
  });

  it('reads a two-line title', () => {
    expect(headings('Intro\n\nSetext Title\n------------\ntext\n').map((h) => h.title)).toEqual([
      'Setext Title',
    ]);
  });
});

describe('§5.4 Start', () => {
  it('moves up over the attribute lines directly above the title', () => {
    const text = '== A\na\n\n[#b]\n[role=x]\n== B\nb\n';
    expect(contents(text, 'B')).toEqual(['[#b]\n[role=x]\n== B\nb\n']);
    expect(contents(text, 'A')).toEqual(['== A\na\n\n']);
  });

  it('stops at a blank line, a comment and a block title', () => {
    const text = '== A\na\n\n[#b]\n\n== B\nb\n';
    expect(contents(text, 'B')).toEqual(['== B\nb\n']);
    expect(contents(text, 'A')).toEqual(['== A\na\n\n[#b]\n\n']);
  });

  it('does not let an edit of the anchor line of one section change the section before', () => {
    const before = '== A\na\n\n[#b]\n== B\nb\n';
    const after = '== A\na\n\n[#renamed]\n== B\nb\n';
    expect(contents(before, 'A')).toEqual(contents(after, 'A'));
    expect(contents(before, 'B')).not.toEqual(contents(after, 'B'));
  });
});

describe('§5.5 End', () => {
  it('ends a section at the next one of the same or a higher level, subsections included', () => {
    expect(contents(DOC, 'One')).toEqual(['== One\none text\n\n=== Sub\nsub text\n\n']);
    expect(contents(DOC, 'Sub')).toEqual(['=== Sub\nsub text\n\n']);
  });

  it('ends the last section where the source does', () => {
    expect(contents(DOC, 'Two')).toEqual(['== Two\ntwo text\n']);
    expect(contents('== Two\ntwo text', 'Two')).toEqual(['== Two\ntwo text']);
    expect(contents('== Two\n\n\n', 'Two')).toEqual(['== Two\n\n\n']);
  });

  it('is unaffected by the other sections, the header and an included file', () => {
    const edited = DOC.replace('one text', 'one text, edited').replace('= Guide', '= Other');
    expect(contents(edited, 'Two')).toEqual(contents(DOC, 'Two'));
    expect(contents(edited, 'One')).not.toEqual(contents(DOC, 'One'));
  });

  it('counts every byte: a blank line before the next section changes the section', () => {
    expect(contents(DOC.replace('sub text\n\n', 'sub text\n\n\n'), 'Sub')).not.toEqual(
      contents(DOC, 'Sub'),
    );
  });
});

describe('§6 Extract', () => {
  it('returns the focus and the lines of the section', () => {
    const [part] = extract(DOC, 'One').parts ?? [];
    expect(part?.focus).toBe('section "One" (level 2)');
    expect(part?.lines).toEqual({ start: 5, end: 10 });
    const [last] = extract(DOC, 'Two').parts ?? [];
    expect(last?.lines).toEqual({ start: 11, end: 12 });
  });

  it('starts the lines at the anchor line', () => {
    const [part] = extract('== A\n\n[#b]\n== B\nb\n', 'B').parts ?? [];
    expect(part?.lines).toEqual({ start: 3, end: 5 });
  });

  it('writes a focus of one line', () => {
    const [part] = extract('== A\u0001B\nx\n', 'A\u0001B').parts ?? [];
    expect(part?.focus).toBe('section "A B" (level 2)');
  });

  it('reports a title that appears twice and names the lines', () => {
    const result = extract(`${DOC}\n== One\nagain\n`, 'One');
    expect(result.parts).toBeUndefined();
    expect(result.diagnostics?.[0]).toMatchObject({
      severity: 'error',
      code: 'ambiguous-section',
    });
    expect(result.diagnostics?.[0]?.message).toContain('lines 5, 14');
  });

  it('selects one of two equal titles by level or by anchor', () => {
    const text = '== Install\none\n\n=== Install\ntwo\n\n[#third]\n== Install\nthree\n';
    expect(contents(text, { title: 'Install', level: 3 })).toEqual(['=== Install\ntwo\n\n']);
    expect(contents(text, { anchor: 'third' })).toEqual(['[#third]\n== Install\nthree\n']);
  });

  it('reports an anchor given twice as ambiguous', () => {
    const result = extract('[#same]\n== A\n\n[#same]\n== B\n', { anchor: 'same' });
    expect(result.diagnostics?.[0]?.code).toBe('ambiguous-section');
  });
});

describe('§6.1 ValidateSelect', () => {
  it('accepts the three forms and refuses the rest', () => {
    for (const select of ['Install', { title: 'Install', level: 2 }, { anchor: 'install' }]) {
      expect(plugin.validateSelect(select as never)).toEqual({});
    }
    for (const select of [{ title: 'Install', level: 9 }, { anchor: '' }, 3]) {
      expect(plugin.validateSelect(select as never).diagnostics?.[0]?.code).toBe(
        'invalid-selector',
      );
    }
  });

  it('declares the schema of the keys', () => {
    expect(plugin.meta.schema.additionalProperties).toBe(false);
    expect(Object.keys(plugin.meta.schema.properties ?? {})).toEqual(['title', 'level', 'anchor']);
  });
});

describe('§6.2 NotFound', () => {
  const message = (select: unknown, text = DOC): string => {
    const result = extract(text, select);
    expect(result.parts).toBeUndefined();
    expect(result.diagnostics?.[0]).toMatchObject({
      severity: 'warning',
      code: 'section-not-found',
    });
    return result.diagnostics![0]!.message;
  };

  it('says the file has no sections', () => {
    expect(message('X', 'just text\n')).toBe('No section "X"; the file has no sections.');
  });

  it('names the sections with that title when only the level is wrong', () => {
    expect(message({ title: 'Sub', level: 2 })).toBe(
      'No section "Sub" at level 2; the title is at === Sub (line 8); correct the level.',
    );
  });

  it('names the nearest titles, even for a case change', () => {
    expect(message('sub')).toBe('No section "sub"; nearest: === Sub (line 8).');
    expect(message('Tow')).toBe('No section "Tow"; nearest: == Two (line 11).');
  });

  it('lists the first ten sections otherwise, then counts the rest', () => {
    const many = Array.from({ length: 12 }, (_, index) => `== Section number ${index}\n`).join('');
    expect(message('Unrelated', many)).toContain('and 2 more');
  });

  it('answers an anchor with the anchored sections', () => {
    const text = '[#alpha]\n== A\n\n[#beta]\n== B\n\n== C\n';
    expect(message({ anchor: 'alpa' }, text)).toBe(
      'No section with the anchor "alpa"; nearest: == A (line 2).',
    );
    expect(message({ anchor: 'unrelated-anchor' }, text)).toBe(
      'No section with the anchor "unrelated-anchor"; ' +
        'the anchored sections are: == A (line 2), == B (line 5).',
    );
    expect(message({ anchor: 'x' }, '== A\n')).toBe(
      'No section with the anchor "x"; the file has no section with an anchor.',
    );
  });

  it('holds no code point below U+0020', () => {
    const text = message('A\u0001B', DOC);
    expect(Array.from(text).every((character) => character.codePointAt(0)! >= 0x20)).toBe(true);
  });
});
