import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfig } from '../../src/config/read-config.ts';
import { parseShorthand, resolveSelector, resolveShorthands } from '../../src/config/shorthand.ts';
import { canonicalJson } from '../../src/core/canonical.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import type { Shorthand } from '../../src/core/types.ts';
import { dependencyHashFrom } from '../../src/hash/hash.ts';
import { splitDependency } from '../../src/pattern/split.ts';
import { nodeHost } from '../../src/host/node-fs.ts';
import { parseBlock } from '../../src/inline/block.ts';
import { scanFrontmatter } from '../../src/inline/frontmatter.ts';
import { validatePlugins } from '../../src/plugin/plugins.ts';
import type { DocstampPlugin } from '../../src/plugin/types.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const extract = () => ({});
const sections: DocstampPlugin = {
  name: 'sections',
  apiVersion: 1,
  files: ['**/*.md'],
  extract,
  parseSelect: (raw) =>
    raw.startsWith('## ')
      ? { select: { heading: raw.slice(3), level: 2 } }
      : raw === 'bad'
        ? { diagnostics: [{ severity: 'error', message: 'Write a title.', code: 'bad-title' }] }
        : { select: raw },
};
const declarations: DocstampPlugin = {
  name: 'declarations',
  apiVersion: 1,
  files: ['**/*.ts'],
  extract,
  parseSelect: (raw) => {
    const [name = '', kind = ''] = raw.split(',');
    return kind === '' ? { select: name } : { select: { name, kind } };
  },
};
const plugins = [sections, declarations];

const resolve = (path: string, raw: string) => resolveSelector(plugins, 'CLAUDE.md', { path, raw });

describe('§8.7 SplitDependency', () => {
  it.each([
    ['docs/guide.md:Install', 'docs/guide.md', 'Install'],
    ['a.json:scripts.build', 'a.json', 'scripts.build'],
    ['a.md:x:y', 'a.md', 'x:y'],
    ['a\\:b.md:x', 'a\\:b.md', 'x'],
    ['a\\\\:x', 'a\\\\', 'x'],
    [':x', '', 'x'],
    ['a.md:', 'a.md', ''],
  ])('splits %s at the first unescaped colon', (text, path, raw) => {
    expect(splitDependency(text)).toEqual({ path, raw });
  });

  it.each([['src/**'], ['a\\:b.md'], ['a\\\\\\:b.md'], ['plain.md'], ['trailing\\']])(
    'leaves %s a Pattern',
    (text) => {
      expect(splitDependency(text)).toBeNull();
    },
  );
});

describe('§8.7 ParseShorthand', () => {
  it('reads the literal path the written path denotes', () => {
    expect(parseShorthand('docs/guide.md:Install')).toEqual({
      path: 'docs/guide.md',
      raw: 'Install',
    });
    expect(parseShorthand('a\\:b.md:x')).toEqual({ path: 'a:b.md', raw: 'x' });
    expect(parseShorthand('a\\[1\\].json:x')).toEqual({ path: 'a[1].json', raw: 'x' });
  });

  it.each([
    [':x', 'empty'],
    ['a.md:', 'empty'],
    ['src/*.ts:x', 'literal'],
    ['src/**:x', 'literal'],
    ['!a.md:x', 'literal'],
    ['/a.md:x', 'literal'],
  ])('refuses %s', (text, why) => {
    const message = parseShorthand(text);
    expect(typeof message).toBe('string');
    expect(message).toContain(why);
  });

  it('names the escape of a glob and of a colon', () => {
    expect(parseShorthand('src/*.ts:x')).toContain('\\:');
  });
});

describe('§8.7 ResolveSelector', () => {
  it('takes the whole text verbatim for a plugin without parseSelect', () => {
    expect(resolve('package.json', 'scripts.build')).toEqual({ select: 'scripts.build' });
    expect(resolve('package.json', '["a,b=c"].d\\e')).toEqual({ select: '["a,b=c"].d\\e' });
    expect(resolve('ci.yml', 'jobs.test.steps.1.run')).toEqual({
      select: 'jobs.test.steps.1.run',
    });
  });

  it('takes the text verbatim for a path no plugin claims', () => {
    expect(resolve('data.bin', 'a=b')).toEqual({ select: 'a=b' });
  });

  it('is what parseSelect returns, a String or a Map', () => {
    expect(resolve('docs/guide.md', 'Install')).toEqual({ select: 'Install' });
    expect(resolve('docs/guide.md', '## Install')).toEqual({
      select: { heading: 'Install', level: 2 },
    });
    expect(resolve('src/api.ts', 'User,interface')).toEqual({
      select: { name: 'User', kind: 'interface' },
    });
  });

  it('is the errors parseSelect reports, with their code', () => {
    expect(resolve('docs/guide.md', 'bad')).toEqual({
      problems: [
        expect.objectContaining({
          code: 'E_SELECT',
          file: 'CLAUDE.md',
          subject: 'docs/guide.md:bad',
          message: 'Write a title.',
          pluginCode: 'bad-title',
        }),
      ],
    });
  });

  const faulty = (parseSelect: unknown): DocstampPlugin =>
    ({ name: 'f', apiVersion: 1, files: ['**/*.md'], extract, parseSelect }) as DocstampPlugin;
  const problem = (parseSelect: unknown) => {
    const result = resolveSelector([faulty(parseSelect)], 'CLAUDE.md', { path: 'a.md', raw: 'x' });
    return 'problems' in result ? result.problems : [];
  };

  it.each([
    [
      'a throw',
      () => {
        throw new Error('secret');
      },
    ],
    ['a promise', () => Promise.resolve({ select: 'x' })],
    ['a non-Map', () => 'x'],
    ['neither select nor error', () => ({})],
    ['a warning', () => ({ select: 'x', diagnostics: [{ severity: 'warning', message: 'w' }] })],
    ['a non-finite number', () => ({ select: { a: Number.NaN } })],
    ['a function', () => ({ select: () => 1 })],
    ['a bad diagnostic', () => ({ diagnostics: [{ severity: 'error' }] })],
  ])('is one E_SELECT for %s, without the host text', (_name, parseSelect) => {
    const [only, ...rest] = problem(parseSelect);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ code: 'E_SELECT', subject: 'a.md:x' });
    expect(only!.message).not.toContain('secret');
  });

  it('prefers the errors over a select', () => {
    const result = problem(() => ({
      select: 'x',
      diagnostics: [{ severity: 'error', message: 'No.' }],
    }));
    expect(result).toHaveLength(1);
  });

  it('may return null, a Number or a List as the select', () => {
    for (const select of [null, 3, ['a']]) {
      const result = resolveSelector([faulty(() => ({ select }))], 'f', { path: 'a.md', raw: 'x' });
      expect(result).toEqual({ select });
    }
  });
});

describe('§8.7 shorthand and written form share one Dependency Hash', () => {
  const entries: [string, string][] = [['src/a.ts', 'a'.repeat(64)]];

  it('§17.7 a bare value is the String of the written form', () => {
    const resolved = resolve('docs/guide.md', 'Install');
    const select = canonicalJson('select' in resolved ? resolved.select : null);
    const fragments = [{ path: 'docs/guide.md', select, parts: [{ content: 'abc' }] }];
    expect(dependencyHashFrom(entries, fragments)).toBe(
      'b97e1bef5907d4a4827ee34fcb74350137d74e7d8fd0c02db21bcd0b6a8e6ba5',
    );
  });

  it('§17.7 pairs are the Map of the written form', () => {
    const resolved = resolve('src/api.ts', 'abc,function');
    const select = canonicalJson('select' in resolved ? resolved.select : null);
    const fragments = [
      { path: 'docs/guide.md', select, parts: [{ content: 'abc' }, { content: 'def' }] },
    ];
    expect(dependencyHashFrom([], fragments)).toBe(
      'cf13425d12b91e9f192502bb184d8d8f30e0e6b3a8828a4f1ac2e5fcc4ee977c',
    );
  });
});

describe('§12.2 step 5 resolveShorthands', () => {
  const shorthands: Shorthand[] = [
    { path: 'docs/guide.md', raw: 'Install' },
    { path: 'docs/guide.md', raw: '## Install' },
    { path: 'docs/guide.md', raw: 'Install' },
    { path: 'docs/guide.md', raw: 'bad' },
  ];

  it('appends the values to Selected, drops identical ones and attaches the errors', () => {
    const { declaration, problems } = resolveShorthands(
      {
        file: 'CLAUDE.md',
        dependencies: ['src'],
        selected: [{ path: 'docs/guide.md', select: 'Install' }],
        shorthands,
      },
      plugins,
    );
    expect(declaration.selected).toEqual([
      { path: 'docs/guide.md', select: 'Install' },
      {
        path: 'docs/guide.md',
        select: { heading: 'Install', level: 2 },
        written: 'docs/guide.md:## Install',
      },
    ]);
    expect(declaration.shorthands).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      code: 'E_SELECT',
      file: 'CLAUDE.md',
      subject: 'docs/guide.md:bad',
    });
  });
});

describe('§8.7 parseSelect and meta of a plugin', () => {
  const plugin = (members: Record<string, unknown>) => () =>
    validatePlugins([{ name: 'p', apiVersion: 1, files: ['**/*.md'], extract, ...members }]);
  const raised = (make: () => unknown) => {
    try {
      make();
    } catch (error) {
      expect(error).toBeInstanceOf(Raised);
      return (error as Raised).diagnostics[0]!;
    }
    throw new Error('no Raised');
  };

  it('keeps a valid parseSelect and meta.schema', () => {
    const [valid] = plugin({
      parseSelect: (raw: string) => ({ select: raw }),
      meta: { schema: { type: 'string', description: 'a title' } },
    })();
    expect(valid!.parseSelect!('a')).toEqual({ select: 'a' });
    expect(valid!.meta).toEqual({ schema: { type: 'string', description: 'a title' } });
  });

  it('accepts a meta without a schema', () => {
    expect(plugin({ meta: { other: 1 } })()[0]!.meta).toBeUndefined();
  });

  it.each([
    [{ parseSelect: 'x' }, 'parseSelect'],
    [{ meta: 'x' }, 'meta'],
    [{ meta: { schema: { pattern: 'a' } } }, 'pattern'],
    [{ meta: { schema: { type: 'float' } } }, 'type'],
    [{ meta: { schema: { properties: { a: { minLength: -1 } } } } }, 'minLength'],
    [{ meta: { schema: { additionalProperties: { type: 'string' } } } }, 'additionalProperties'],
    [{ meta: { schema: { oneOf: [] } } }, 'oneOf'],
  ])('is E_PLUGIN for %j, naming %s', (members, keyword) => {
    const found = raised(plugin(members));
    expect(found).toMatchObject({ code: 'E_PLUGIN', subject: 'p' });
    expect(found.message).toContain(keyword);
  });
});

describe('§9.3 step 8 and §9.6.2 step 6 shorthand in a Declaration', () => {
  const configured = (dependencies: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'ds-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'docstamp.yaml'),
      `version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n${dependencies}`,
    );
    return () => readConfig(nodeHost, dir);
  };

  it('splits the shorthand strings off the patterns', () => {
    const read = configured('      - src\n      - "docs/guide.md:Install"\n      - a\\:b.md\n');
    const [declaration] = read().config.declarations;
    expect(declaration?.dependencies).toEqual(['src', 'a\\:b.md']);
    expect(declaration?.shorthands).toEqual([{ path: 'docs/guide.md', raw: 'Install' }]);
  });

  it.each([['src/*.ts:x'], ['guide.md:'], [':x']])('raises E_CONFIG for %s', (text) => {
    try {
      configured(`      - "${text}"\n`)();
    } catch (error) {
      expect((error as Raised).diagnostics[0]).toMatchObject({
        code: 'E_CONFIG',
        file: 'CLAUDE.md',
        subject: 'dependencies',
      });
      return;
    }
    throw new Error('no Raised');
  });

  const block = (dependencies: string) => {
    const text = `---\ndocstamp:\n  dependencies:\n${dependencies}---\n# T\n`;
    return parseBlock('DOC.md', scanFrontmatter(text)!);
  };

  it('reads a shorthand of an inline block', () => {
    const { declaration, problems } = block('    - src\n    - "docs/guide.md:## X"\n');
    expect(problems).toEqual([]);
    expect(declaration.dependencies).toEqual(['src']);
    expect(declaration.shorthands).toEqual([{ path: 'docs/guide.md', raw: '## X' }]);
  });

  it('is E_BLOCK for a glob path in an inline block', () => {
    const { problems } = block('    - src\n    - "src/*.ts:x"\n');
    expect(problems[0]).toMatchObject({ code: 'E_BLOCK', subject: 'dependencies' });
  });
});
