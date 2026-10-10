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

  const sparse = [plugin()];
  sparse.length = 2;
  const leadingHole = [plugin(), plugin({ name: 'other' })];
  Reflect.deleteProperty(leadingHole, 0);
  const throwingGetter = Object.defineProperty(plugin(), 'name', {
    get: () => {
      throw new Error('/abs/secret/path');
    },
  });
  const throwingProxy = new Proxy(plugin(), {
    get: () => {
      throw new Error('/abs/secret/path');
    },
  });
  const throwingFile = plugin({
    files: new Proxy(['**/*.md'], {
      get: (target, key, receiver) => {
        if (key === '0') throw new Error('/abs/secret/path');
        return Reflect.get(target, key, receiver);
      },
    }),
  });

  it.each([
    ['not a list', {}, 'plugins'],
    ['not an object', [1], 'plugins[0]'],
    ['a hole at the end', sparse, 'plugins[1]'],
    ['a hole at the start', leadingHole, 'plugins[0]'],
    ['no name', [plugin({ name: '' })], 'plugins[0]'],
    ['bad files', [plugin({ files: [] })], 'md'],
    ['bad pattern', [plugin({ files: ['a//b'] })], 'md'],
    ['no extract', [plugin({ extract: 'x' })], 'md'],
    ['duplicate names', [plugin(), plugin()], 'md'],
    ['a throwing name getter', [throwingGetter], 'plugins[0]'],
    ['a throwing proxy', [throwingProxy], 'plugins[0]'],
    ['a throwing files element', [throwingFile], 'plugins[0]'],
  ])('rejects %s with E_PLUGIN', (_, raw, subject) => {
    const diagnostics = raised(() => validatePlugins(raw));
    expect(diagnostics.map((d) => d.code)).toEqual(['E_PLUGIN']);
    expect(diagnostics[0]?.subject).toBe(subject);
    expect(diagnostics[0]?.message).not.toContain('secret');
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

  const boom = () => {
    throw new Error('/abs/secret/path');
  };
  const hashesGetter = Object.defineProperty({}, 'hashes', { get: boom });
  // oxlint-disable-next-line unicorn/no-thenable
  const thenGetter = Object.defineProperty({ hashes: ['a'] }, 'then', { get: boom });
  const elementGetter = Object.defineProperty(['a'], '0', { get: boom });

  it.each([
    ['a throwing hashes getter', hashesGetter],
    ['a throwing then getter', thenGetter],
    ['a throwing hash element', { hashes: elementGetter }],
  ])('raises E_SELECT for %s without the thrown text', (_, result) => {
    const [diagnostic, ...rest] = raised(() => run(() => result));
    expect(rest).toEqual([]);
    expect(diagnostic?.code).toBe('E_SELECT');
    expect(diagnostic?.message).not.toContain('secret');
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
