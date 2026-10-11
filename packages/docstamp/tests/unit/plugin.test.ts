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
  extract: () => ({ parts: [{ content: 'h' }] }),
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

  const trap = (name: string) =>
    new Proxy([plugin()], {
      [name]: () => {
        throw new Error('/abs/secret/path');
      },
    });

  it.each([
    ['a proxy list with a throwing has trap', trap('has')],
    ['a proxy list with a throwing get trap', trap('get')],
    [
      'a proxy list with a throwing length',
      new Proxy([plugin()], {
        get: (target, key, receiver) => {
          if (key === 'length') throw new Error('/abs/secret/path');
          return Reflect.get(target, key, receiver);
        },
      }),
    ],
  ])('rejects %s with one E_PLUGIN', (_, raw) => {
    const diagnostics = raised(() => validatePlugins(raw));
    expect(diagnostics.map((d) => d.code)).toEqual(['E_PLUGIN']);
    expect(diagnostics[0]?.message).not.toContain('secret');
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
  const subject = 'a.md#"Install"';
  const run = (extract: unknown) => runExtract(validatePlugins([plugin({ extract })])[0]!, input);
  const part = (content: string) => ({ parts: [{ content }] });

  it('returns the parts in order', () => {
    const result = run(() => ({ parts: [{ content: 'a' }, { content: 'b' }] }));
    expect(result).toEqual({ parts: [{ content: 'a' }, { content: 'b' }], warnings: [] });
  });

  it('passes path, text and select', () => {
    const result = run((i: unknown) => part(JSON.stringify(i)));
    expect(result.parts[0]?.content).toBe('{"path":"a.md","text":"x","select":"Install"}');
  });

  it('returns the focus and the lines of each part when the plugin gives them', () => {
    const parts = [
      { content: 'a', focus: 'section "A"', lines: { start: 1, end: 3 } },
      { content: 'b', focus: 'section "B"', lines: { start: 5, end: 5 } },
    ];
    expect(run(() => ({ parts })).parts).toEqual(parts);
  });

  it('leaves focus and lines out when the plugin gives none', () => {
    expect(Object.keys(run(() => part('a')).parts[0]!)).toEqual(['content']);
  });

  it('accepts an empty content, which is a part like any other', () => {
    expect(run(() => part('')).parts).toEqual([{ content: '' }]);
  });

  it('raises E_SELECT_NOT_FOUND for no part and no error', () => {
    for (const result of [{}, { parts: [] }, { diagnostics: [] }]) {
      const [diagnostic, ...rest] = raised(() => run(() => result));
      expect([diagnostic?.code, diagnostic?.subject, rest]).toEqual([
        'E_SELECT_NOT_FOUND',
        subject,
        [],
      ]);
    }
  });

  it('raises E_SELECT with the message of an error, on the path and the selector', () => {
    const message = 'The heading appears at lines 3 and 9; add a level.';
    const [diagnostic, ...rest] = raised(() =>
      run(() => ({ diagnostics: [{ severity: 'error', message }] })),
    );
    expect(rest).toEqual([]);
    expect([diagnostic?.code, diagnostic?.subject, diagnostic?.message]).toEqual([
      'E_SELECT',
      subject,
      message,
    ]);
  });

  it('raises every error, and the warnings with them, and ignores the parts', () => {
    const diagnostics = [
      { severity: 'warning', message: 'w' },
      { severity: 'error', message: 'one' },
      { severity: 'error', message: 'two' },
    ];
    const raisedAll = raised(() => run(() => ({ parts: [{ content: 'a' }], diagnostics })));
    expect(raisedAll.map((d) => [d.code, d.message])).toEqual([
      ['E_SELECT', 'one'],
      ['E_SELECT', 'two'],
      ['W_SELECT', 'w'],
    ]);
  });

  it('returns the warnings with the parts, as W_SELECT on the path and the selector', () => {
    const diagnostics = [{ severity: 'warning', message: 'Using the first heading.' }];
    const result = run(() => ({ parts: [{ content: 'a' }], diagnostics }));
    expect(result.parts).toEqual([{ content: 'a' }]);
    expect(result.warnings.map((d) => [d.code, d.severity, d.subject, d.message])).toEqual([
      ['W_SELECT', 'warning', subject, 'Using the first heading.'],
    ]);
  });

  it('raises the warnings with E_SELECT_NOT_FOUND', () => {
    const diagnostics = [{ severity: 'warning', message: 'w' }];
    expect(raised(() => run(() => ({ diagnostics }))).map((d) => d.code)).toEqual([
      'E_SELECT_NOT_FOUND',
      'W_SELECT',
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
    ['returns a string', () => 'a'],
    ['returns a list', () => [{ content: 'a' }]],
    ['returns parts that are not a list', () => ({ parts: 'a' })],
    ['returns a part that is not an object', () => ({ parts: ['a'] })],
    ['returns a part without content', () => ({ parts: [{}] })],
    ['returns a non-string content', () => ({ parts: [{ content: 1 }] })],
    ['returns a content with a lone surrogate', () => ({ parts: [{ content: 'a\ud800' }] })],
  ])('raises E_SELECT on the path when the plugin %s', (_, extract) => {
    const [diagnostic, ...rest] = raised(() => run(extract));
    expect(rest).toEqual([]);
    expect([diagnostic?.code, diagnostic?.subject]).toEqual(['E_SELECT', 'a.md']);
  });

  it.each([
    ['a focus that is not a string', { parts: [{ content: 'a', focus: 1 }] }, /focus/u],
    ['an empty focus', { parts: [{ content: 'a', focus: '' }] }, /focus/u],
    ['a focus of two lines', { parts: [{ content: 'a', focus: 'x\ny' }] }, /focus/u],
    ['a focus with a tab', { parts: [{ content: 'a', focus: 'x\ty' }] }, /focus/u],
    [
      'lines that are a list',
      { parts: [{ content: 'a', lines: [{ start: 1, end: 1 }] }] },
      /lines/u,
    ],
    ['lines that start at 0', { parts: [{ content: 'a', lines: { start: 0, end: 1 } }] }, /lines/u],
    [
      'lines that end before the start',
      { parts: [{ content: 'a', lines: { start: 3, end: 2 } }] },
      /lines/u,
    ],
    ['a fractional line', { parts: [{ content: 'a', lines: { start: 1.5, end: 2 } }] }, /lines/u],
    ['lines without an end', { parts: [{ content: 'a', lines: { start: 1 } }] }, /lines/u],
    ['diagnostics that are not a list', { diagnostics: 'x' }, /diagnostics/u],
    ['a diagnostic without a severity', { diagnostics: [{ message: 'm' }] }, /diagnostic/u],
    ['an unknown severity', { diagnostics: [{ severity: 'info', message: 'm' }] }, /diagnostic/u],
    ['an empty message', { diagnostics: [{ severity: 'error', message: '' }] }, /diagnostic/u],
    [
      'a message of two lines',
      { diagnostics: [{ severity: 'error', message: 'a\nb' }] },
      /diagnostic/u,
    ],
    [
      'a message that is not a string',
      { diagnostics: [{ severity: 'error', message: 1 }] },
      /diagnostic/u,
    ],
    [
      'more than 100 diagnostics',
      { diagnostics: Array.from({ length: 101 }, () => ({ severity: 'warning', message: 'm' })) },
      /100/u,
    ],
  ])('raises E_SELECT for %s', (_, result, wording) => {
    const [diagnostic] = raised(() => run(() => result));
    expect([diagnostic?.code, diagnostic?.subject]).toEqual(['E_SELECT', 'a.md']);
    expect(diagnostic?.message).toMatch(wording);
  });

  it('accepts exactly 100 diagnostics', () => {
    const diagnostics = Array.from({ length: 100 }, (_, i) => ({
      severity: 'warning',
      message: `m${i}`,
    }));
    expect(run(() => ({ parts: [{ content: 'a' }], diagnostics })).warnings).toHaveLength(100);
  });

  it('ignores members it does not know', () => {
    const result = run(() => ({ ...part('a'), future: 1 }));
    expect(result).toEqual({ parts: [{ content: 'a' }], warnings: [] });
  });

  it('says synchronous when the plugin returns a promise', () => {
    const [diagnostic] = raised(() => run(async () => part('a')));
    expect(diagnostic?.message).toContain('synchronous');
  });

  const boom = () => {
    throw new Error('/abs/secret/path');
  };
  const partsGetter = Object.defineProperty({}, 'parts', { get: boom });
  // oxlint-disable-next-line unicorn/no-thenable
  const thenGetter = Object.defineProperty(part('a'), 'then', { get: boom });
  const contentGetter = { parts: [Object.defineProperty({}, 'content', { get: boom })] };
  const severityGetter = {
    diagnostics: [Object.defineProperty({ message: 'm' }, 'severity', { get: boom })],
  };

  it.each([
    ['a throwing parts getter', partsGetter],
    ['a throwing then getter', thenGetter],
    ['a throwing content getter', contentGetter],
    ['a throwing severity getter', severityGetter],
  ])('raises E_SELECT for %s without the thrown text', (_, result) => {
    const [diagnostic, ...rest] = raised(() => run(() => result));
    expect(rest).toEqual([]);
    expect(diagnostic?.code).toBe('E_SELECT');
    expect(diagnostic?.message).not.toContain('secret');
  });

  it('contains a rejecting async plugin without an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      const [diagnostic] = raised(() =>
        run(async () => {
          throw new Error('/abs/secret/path');
        }),
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(diagnostic?.code).toBe('E_SELECT');
      expect(diagnostic?.message).toContain('synchronous');
      expect(diagnostic?.message).not.toContain('secret');
    } finally {
      process.off('unhandledRejection', listener);
    }
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

describe('§9.5 validated plugins are snapshots', () => {
  it('reads each member once: a getter or a later edit never reaches a claim', () => {
    let reads = 0;
    const entry = plugin({
      get files() {
        reads += 1;
        return ['**/*.md'];
      },
    });
    const [valid] = validatePlugins([entry]);
    const readsAfterValidation = reads;
    entry.name = 'renamed';
    entry.extract = () => ({ parts: [{ content: 'other' }] });
    claim([valid!], 'a.md');
    expect(reads).toBe(readsAfterValidation);
    expect(valid!.name).toBe('md');
    expect(valid!.extract({ path: 'a.md', text: '', select: 'x' })).toEqual({
      parts: [{ content: 'h' }],
    });
  });

  it('calls extract with the plugin object as this', () => {
    const entry = plugin({
      extract(this: { marker: string }) {
        return { parts: [{ content: this.marker }] };
      },
      marker: 'mine',
    });
    const [valid] = validatePlugins([entry]);
    expect(valid!.extract({ path: 'a.md', text: '', select: 'x' })).toEqual({
      parts: [{ content: 'mine' }],
    });
  });
});
