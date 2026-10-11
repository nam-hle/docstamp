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
  selectorFields: { main: 'heading', fields: { heading: 'string', level: 'integer' } },
};
const declarations: DocstampPlugin = {
  name: 'declarations',
  apiVersion: 1,
  files: ['**/*.ts'],
  extract,
  selectorFields: {
    main: 'name',
    fields: {
      name: 'string',
      kind: ['function', 'class', 'interface'],
      part: ['shape', 'source'],
    },
  },
};
const plugins = [sections, declarations];

const resolve = (path: string, raw: string) => resolveSelector(plugins, { path, raw });

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
  it('keeps a bare value the String it always was', () => {
    expect(resolve('docs/guide.md', 'Install')).toEqual({ select: 'Install' });
    expect(resolve('src/api.ts', 'createUser')).toEqual({ select: 'createUser' });
  });

  it('reads key=value pairs as a Map, in any order, converting an integer', () => {
    expect(resolve('docs/guide.md', 'heading=Install,level=2')).toEqual({
      select: { heading: 'Install', level: 2 },
    });
    expect(resolve('docs/guide.md', 'level=-3,heading=A')).toEqual({
      select: { heading: 'A', level: -3 },
    });
    expect(resolve('src/api.ts', 'kind=interface,name=User')).toEqual({
      select: { kind: 'interface', name: 'User' },
    });
  });

  it('gives one pair the Map, not the String', () => {
    expect(resolve('docs/guide.md', 'heading=Install')).toEqual({
      select: { heading: 'Install' },
    });
  });

  it('resolves \\, \\= and \\\\ in a bare value and in a pair', () => {
    expect(resolve('docs/guide.md', 'Q&A\\, part 2')).toEqual({ select: 'Q&A, part 2' });
    expect(resolve('docs/guide.md', 'a\\=b')).toEqual({ select: 'a=b' });
    expect(resolve('docs/guide.md', 'c\\\\d')).toEqual({ select: 'c\\d' });
    expect(resolve('docs/guide.md', 'heading=a\\,b\\=c\\\\,level=1')).toEqual({
      select: { heading: 'a,b=c\\', level: 1 },
    });
    expect(resolve('docs/guide.md', 'C\\D')).toEqual({ select: 'C\\D' });
  });

  it('leaves an unknown key to the plugin', () => {
    expect(resolve('docs/guide.md', 'title=Install')).toEqual({ select: { title: 'Install' } });
  });

  it('refuses a duplicate key, an empty item, a bare item among pairs and a bad value', () => {
    const messages = [
      resolve('docs/guide.md', 'heading=A,heading=B'),
      resolve('docs/guide.md', 'a,,b'),
      resolve('docs/guide.md', 'heading=A,B'),
      resolve('docs/guide.md', 'A,B'),
      resolve('docs/guide.md', '=A'),
      resolve('docs/guide.md', 'heading=A,level=two'),
      resolve('docs/guide.md', 'heading=A,level=02'),
      resolve('docs/guide.md', 'heading=A,level=1.5'),
      resolve('src/api.ts', 'name=A,kind=var'),
    ];
    for (const result of messages) expect(result).toHaveProperty('message');
    expect(messages[0]).toMatchObject({ message: expect.stringContaining('twice') });
    expect(messages[3]).toMatchObject({ message: expect.stringContaining('\\,') });
    expect(messages[5]).toMatchObject({ message: expect.stringContaining('integer') });
    expect(messages[8]).toMatchObject({ message: expect.stringContaining('function, class') });
  });

  it('takes the whole text verbatim for a plugin without selectorFields', () => {
    expect(resolve('package.json', 'scripts.build')).toEqual({ select: 'scripts.build' });
    expect(resolve('package.json', '["a,b=c"].d\\e')).toEqual({ select: '["a,b=c"].d\\e' });
    expect(resolve('ci.yml', 'jobs.test.steps.1.run')).toEqual({
      select: 'jobs.test.steps.1.run',
    });
  });

  it('takes the text verbatim for a path no plugin claims', () => {
    expect(resolve('data.bin', 'a=b')).toEqual({ select: 'a=b' });
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
    const resolved = resolve('src/api.ts', 'name=abc,kind=function');
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
    { path: 'docs/guide.md', raw: 'heading=Install' },
    { path: 'docs/guide.md', raw: 'Install' },
    { path: 'docs/guide.md', raw: 'level=x' },
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
      { path: 'docs/guide.md', select: { heading: 'Install' } },
    ]);
    expect(declaration.shorthands).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      code: 'E_SELECT',
      file: 'CLAUDE.md',
      subject: 'docs/guide.md:level=x',
    });
  });
});

describe('§8.7 selectorFields of a plugin', () => {
  const plugin = (selectorFields: unknown) => () =>
    validatePlugins([{ name: 'p', apiVersion: 1, files: ['**/*.md'], extract, selectorFields }]);

  it('is kept when valid', () => {
    const [valid] = plugin({ main: 'a', fields: { a: 'string', b: 'integer', c: ['x'] } })();
    expect(valid!.selectorFields).toEqual({
      main: 'a',
      fields: { a: 'string', b: 'integer', c: ['x'] },
    });
  });

  it.each([
    [{ main: 'a', fields: { a: 'integer' } }],
    [{ main: 'b', fields: { a: 'string' } }],
    [{ main: 'a', fields: { a: 'string', b: 'float' } }],
    [{ main: 'a', fields: { a: 'string', b: [] } }],
    [{ main: 'a', fields: { a: 'string', b: [1] } }],
    [{ main: 'a' }],
    ['a'],
    [null],
  ])('is E_PLUGIN for %j', (selectorFields) => {
    try {
      plugin(selectorFields)();
    } catch (error) {
      expect(error).toBeInstanceOf(Raised);
      expect((error as Raised).diagnostics[0]).toMatchObject({ code: 'E_PLUGIN' });
      return;
    }
    throw new Error('no Raised');
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
    const { declaration, problems } = block('    - src\n    - "docs/guide.md:level=2,heading=X"\n');
    expect(problems).toEqual([]);
    expect(declaration.dependencies).toEqual(['src']);
    expect(declaration.shorthands).toEqual([{ path: 'docs/guide.md', raw: 'level=2,heading=X' }]);
  });

  it('is E_BLOCK for a glob path in an inline block', () => {
    const { problems } = block('    - src\n    - "src/*.ts:x"\n');
    expect(problems[0]).toMatchObject({ code: 'E_BLOCK', subject: 'dependencies' });
  });
});
