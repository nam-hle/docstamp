import { describe, expect, it } from 'vitest';
import { docMentions } from '../../src/cli/mentions.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import { propose } from '../../src/engine/suggest.ts';
import { validatePlugins } from '../../src/plugin/plugins.ts';
import type { DocstampPlugin } from '../../src/plugin/types.ts';

const extract = () => ({ parts: [{ content: 'x' }] });

const plugin = (overrides: Record<string, unknown> = {}): DocstampPlugin =>
  validatePlugins([
    { name: 'adoc', apiVersion: 1, files: ['**/*.adoc'], extract, ...overrides },
  ])[0]!;

const raised = (run: () => unknown): Raised => {
  try {
    run();
  } catch (error) {
    if (error instanceof Raised) return error;
    throw error;
  }
  throw new Error('did not raise');
};

describe('§8.7 a Plugin with mentions', () => {
  it('is valid with a function and invalid with anything else', () => {
    expect('mentions' in plugin({ mentions: () => ({}) })).toBe(true);
    expect('mentions' in plugin()).toBe(false);
    const error = raised(() => plugin({ mentions: 'nope' }));
    expect(error.diagnostics[0]).toMatchObject({ code: 'E_PLUGIN' });
    expect(error.diagnostics[0]!.message).toContain('"mentions" that is not a function');
  });
});

describe('§8.7 Mentions', () => {
  const adoc = plugin({
    mentions: ({ path, text }: { path: string; text: string }) => ({
      links: text
        .split('\n')
        .filter((line) => line.startsWith('include::'))
        .map((line) => line.slice(9)),
      words: [`seen:${path}`],
    }),
  });

  it('step 1: returns none when no Plugin with mentions claims the doc', () => {
    expect(docMentions([adoc], 'docs/guide.md', 'x')).toBeNull();
    expect(docMentions([plugin()], 'docs/guide.adoc', 'x')).toBeNull();
    expect(docMentions([], 'docs/guide.adoc', 'x')).toBeNull();
  });

  it('step 2: raises E_PLUGIN when two Plugins claim the doc', () => {
    const second = validatePlugins([
      { name: 'other', apiVersion: 1, files: ['docs/**'], extract, mentions: () => ({}) },
    ])[0]!;
    const error = raised(() => docMentions([adoc, second], 'docs/guide.adoc', 'x'));
    expect(error.diagnostics[0]).toMatchObject({ code: 'E_PLUGIN', subject: 'docs/guide.adoc' });
    expect(error.diagnostics[0]!.message).toContain('"adoc", "other"');
  });

  it('step 3: calls the Plugin with the path and the text', () => {
    const calls: unknown[] = [];
    const spy = plugin({
      mentions: (input: unknown) => {
        calls.push(input);
        return {};
      },
    });
    docMentions([spy], 'docs/guide.adoc', 'text\n');
    expect(calls).toEqual([{ path: 'docs/guide.adoc', text: 'text\n' }]);
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('secret /private/path');
      },
      'threw in mentions',
    ],
    [
      'returns a promise',
      () => Promise.resolve({}),
      'returned a promise; mentions must be synchronous',
    ],
    ['returns nothing', () => undefined, 'did not return { links, words } from mentions'],
    ['returns a list', () => [], 'did not return { links, words } from mentions'],
    ['returns links that are not strings', () => ({ links: [1] }), 'not a list of at most'],
    ['returns words that are not a list', () => ({ words: 'a' }), 'not a list of at most'],
    ['returns a lone surrogate', () => ({ words: ['\ud800'] }), 'not a list of at most'],
  ])(
    'step 3 and 4: raises E_PLUGIN when it %s, with no text of the host error',
    (_, mentions, why) => {
      const error = raised(() => docMentions([plugin({ mentions })], 'docs/guide.adoc', 'x'));
      expect(error.diagnostics[0]).toMatchObject({ code: 'E_PLUGIN', subject: 'docs/guide.adoc' });
      expect(error.diagnostics[0]!.message).toContain(why);
      expect(error.diagnostics[0]!.message).not.toContain('secret');
    },
  );

  it('step 4: reads absent members as empty lists and ignores the others', () => {
    expect(docMentions([plugin({ mentions: () => ({ extra: 1 }) })], 'a.adoc', '')).toEqual([]);
  });

  it('step 5: links are relative to the doc, words to Root, duplicates once, none dropped', () => {
    const mentions = () => ({
      links: [
        './a.ts[x]'.split('[')[0],
        '../up.ts',
        'sub/b.ts#frag',
        'https://example.com/x',
        '/abs.ts',
      ],
      words: ['src/c.ts', 'src/c.ts', 'x:1', 'a//b'],
    });
    expect(docMentions([plugin({ mentions })], 'docs/guide.adoc', '')!.sort()).toEqual(
      ['abs.ts', 'docs/a.ts', 'docs/sub/b.ts', 'src/c.ts', 'up.ts', 'x'].sort(),
    );
  });
});

describe('§12.6 step 0 Source', () => {
  const universe = ['src/a.ts', 'src/b.ts', 'docs/guide.adoc'];

  it('reads the Markdown of the text when mentions is none', () => {
    const result = propose('docs/guide.adoc', 'See `src/a.ts`.', universe, () => false, 0, null);
    expect(result.suggestions.map((s) => s.pattern)).toEqual(['src/a.ts']);
  });

  it('takes the candidates of mentions instead of reading the text', () => {
    const result = propose('docs/guide.adoc', 'See `src/a.ts`.', universe, () => false, 0, [
      'src/b.ts',
    ]);
    expect(result.suggestions.map((s) => s.pattern)).toEqual(['src/b.ts']);
  });

  it('proposes nothing for an empty list of mentions, whatever the text says', () => {
    const result = propose('docs/guide.adoc', 'See `src/a.ts`.', universe, () => false, 0, []);
    expect(result.suggestions).toEqual([]);
  });
});
