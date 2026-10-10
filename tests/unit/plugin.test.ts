import { describe, expect, it } from 'vitest';

import { Raised } from '../../src/core/diagnostics.ts';
import type { Diagnostic } from '../../src/core/types.ts';
import { canonicalJson } from '../../src/plugin/canonical.ts';
import { claim, runExtract, validatePlugins } from '../../src/plugin/plugins.ts';

const raised = (run: () => unknown): Diagnostic[] => {
  try {
    run();
  } catch (error) {
    if (error instanceof Raised) return error.diagnostics;
    throw error;
  }
  throw new Error('did not raise');
};

const plugin = (over: Record<string, unknown> = {}) => ({
  name: 'md',
  apiVersion: 1,
  files: ['**/*.md'],
  extract: () => ({ hashes: ['h'] }),
  ...over,
});

describe('§3.5 Canonical JSON', () => {
  it('sorts keys at every depth and has no white space', () => {
    expect(canonicalJson({ name: 'abc', kind: 'function', deep: { b: 1, a: [true, null] } })).toBe(
      '{"deep":{"a":[true,null],"b":1},"kind":"function","name":"abc"}',
    );
  });

  it('gives the same text for any key order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('quotes strings as JSON.stringify does', () => {
    expect(canonicalJson('a"b\n')).toBe('"a\\"b\\n"');
  });
});

describe('§9.5 validatePlugins', () => {
  it('accepts a valid plugin and ignores unknown members', () => {
    const [found] = validatePlugins([plugin({ future: 1 })]);
    expect(found?.name).toBe('md');
  });

  it.each([
    ['not a list', {}],
    ['not an object', [1]],
    ['no name', [plugin({ name: '' })]],
    ['bad files', [plugin({ files: [] })]],
    ['bad pattern', [plugin({ files: ['a//b'] })]],
    ['no extract', [plugin({ extract: 'x' })]],
    ['duplicate names', [plugin(), plugin()]],
  ])('rejects %s with E_PLUGIN', (_, raw) => {
    expect(raised(() => validatePlugins(raw)).map((d) => d.code)).toEqual(['E_PLUGIN']);
  });

  it('names apiVersion for a newer interface', () => {
    const [diagnostic] = raised(() => validatePlugins([plugin({ apiVersion: 2 })]));
    expect(diagnostic?.message).toContain('apiVersion');
  });
});

describe('§8.7 claim', () => {
  const md = validatePlugins([plugin()])[0]!;
  const mdx = validatePlugins([plugin({ name: 'mdx', files: ['**/*.mdx'] })])[0]!;

  it('returns the one plugin whose files select the path', () => {
    expect(claim([md, mdx], 'docs/a.md')).toBe(md);
  });

  it('raises E_SELECT when no plugin claims the path', () => {
    expect(raised(() => claim([md], 'src/a.ts')).map((d) => d.code)).toEqual(['E_SELECT']);
  });

  it('raises E_PLUGIN naming both plugins when two claim the path', () => {
    const both = validatePlugins([plugin(), plugin({ name: 'other' })]);
    const [diagnostic] = raised(() => claim(both, 'a.md'));
    expect(diagnostic?.code).toBe('E_PLUGIN');
    expect(diagnostic?.message).toContain('md');
    expect(diagnostic?.message).toContain('other');
  });

  it('honours a negation in files', () => {
    const narrow = validatePlugins([plugin({ files: ['**/*.md', '!CHANGELOG.md'] })]);
    expect(raised(() => claim(narrow, 'CHANGELOG.md')).map((d) => d.code)).toEqual(['E_SELECT']);
  });
});

describe('§8.7 runExtract', () => {
  const input = { path: 'a.md', text: 'x', select: 'Install' };
  const run = (extract: unknown) => runExtract(validatePlugins([plugin({ extract })])[0]!, input);

  it('returns the hashes in order', () => {
    expect(run(() => ({ hashes: ['a', 'b'] }))).toEqual(['a', 'b']);
  });

  it('passes path, text and select', () => {
    expect(run((i: unknown) => ({ hashes: [JSON.stringify(i)] }))).toEqual([
      '{"path":"a.md","text":"x","select":"Install"}',
    ]);
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('boom');
      },
    ],
    ['returns nothing', () => undefined],
    ['returns hashes that are not a list', () => ({ hashes: 'a' })],
    ['returns an empty hash', () => ({ hashes: [''] })],
    ['returns a non-string hash', () => ({ hashes: [1] })],
  ])('raises E_SELECT when the plugin %s', (_, extract) => {
    expect(raised(() => run(extract)).map((d) => d.code)).toEqual(['E_SELECT']);
  });

  it('says synchronous when the plugin returns a promise', () => {
    const [diagnostic] = raised(() => run(async () => ({ hashes: ['a'] })));
    expect(diagnostic?.message).toContain('synchronous');
  });

  it('does not leak the thrown error text', () => {
    const [diagnostic] = raised(() =>
      run(() => {
        throw new Error('/abs/secret/path');
      }),
    );
    expect(diagnostic?.message).not.toContain('secret');
  });
});
