import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from '../../src/cli/workspace.ts';
import { readConfig } from '../../src/config/read-config.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import { evaluate } from '../../src/engine/evaluate.ts';
import { expandPresets } from '../../src/engine/presets.ts';
import { parseBlock } from '../../src/inline/block.ts';
import { scanFrontmatter } from '../../src/inline/frontmatter.ts';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';

afterEach(cleanupTrees);

const presets = new Map<string, readonly string[]>([
  ['tests', ['!**/*.test.ts', '!**/__test__/**']],
  ['spec', ['docs/SPEC.md']],
]);

const raised = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Raised) return e.diagnostics.map((d) => [d.code, d.file, d.subject]);
    throw e;
  }
  return [];
};

describe('§8.6 ExpandPresets', () => {
  it('returns a declaration with no use as it is', () => {
    const declaration = { file: 'a.md', dependencies: ['src'] };
    expect(expandPresets(declaration, presets, [], true)).toBe(declaration);
  });

  it('puts the own patterns first, then each preset in use order', () => {
    const expanded = expandPresets(
      { file: 'a.md', dependencies: ['src', '!src/x'], use: ['spec', 'tests'] },
      presets,
      [],
      true,
    );
    expect(expanded.dependencies).toEqual([
      'src',
      '!src/x',
      'docs/SPEC.md',
      '!**/*.test.ts',
      '!**/__test__/**',
    ]);
    expect(expanded.origins).toEqual([null, null, 'spec', 'tests', 'tests']);
  });

  it('the order of use is the order of the patterns', () => {
    const forward = expandPresets(
      { file: 'a.md', dependencies: ['src'], use: ['tests', 'spec'] },
      presets,
      [],
      true,
    );
    expect(forward.dependencies.slice(1)).toEqual([
      '!**/*.test.ts',
      '!**/__test__/**',
      'docs/SPEC.md',
    ]);
  });

  it('raises E_UNKNOWN_PRESET for every unknown name, attached to the file', () => {
    const found = raised(() =>
      expandPresets(
        { file: 'a.md', dependencies: ['src'], use: ['nope', 'tests', 'gone'] },
        presets,
        [],
        true,
      ),
    );
    expect(found).toEqual([
      ['E_UNKNOWN_PRESET', 'a.md', 'nope'],
      ['E_UNKNOWN_PRESET', 'a.md', 'gone'],
    ]);
  });

  it('says that presets live in a configuration file when there is none', () => {
    try {
      expandPresets({ file: 'a.md', dependencies: ['src'], use: ['tests'] }, new Map(), [], false);
      expect.unreachable();
    } catch (e) {
      expect((e as Raised).diagnostics[0]!.message).toContain('no configuration file');
    }
  });

  it('a preset cannot name another preset: its entries are patterns, never names', () => {
    const nested = new Map([
      ['outer', ['inner']],
      ['inner', ['src']],
    ]);
    const expanded = expandPresets(
      { file: 'a.md', dependencies: ['x'], use: ['outer'] },
      nested,
      [],
      true,
    );
    expect(expanded.dependencies).toEqual(['x', 'inner']);
  });
});

describe('§9.3 presets and use in the configuration file', () => {
  const read = (yaml: string) => readConfig(makeTree({ 'docstamp.yaml': yaml }));
  const failures = (yaml: string) =>
    raised(() => read(yaml)).map(([code, file, subject]) => [code, file, subject]);
  const files = 'files:\n  a.md:\n    dependencies: [src]\n';

  it('reads presets in order of the file and use on a declaration', () => {
    const { config, attached } = read(
      `version: 2\npresets:\n  tests: ["!**/*.test.ts"]\n  spec: [docs/SPEC.md]\n` +
        `files:\n  a.md:\n    dependencies: [src]\n    use: [tests, spec]\n  b.md:\n    dependencies: [x]\n`,
    );
    expect([...config.presets]).toEqual([
      ['tests', ['!**/*.test.ts']],
      ['spec', ['docs/SPEC.md']],
    ]);
    expect(config.declarations).toEqual([
      { file: 'a.md', dependencies: ['src'], use: ['tests', 'spec'] },
      { file: 'b.md', dependencies: ['x'] },
    ]);
    expect(attached).toEqual([]);
  });

  it('presets is optional and empty by default', () => {
    expect(read(`version: 2\n${files}`).config.presets.size).toBe(0);
  });

  it.each([
    ['not a mapping', 'presets: [a]', [['E_CONFIG', '', 'presets']]],
    ['an upper case name', 'presets:\n  Tests: [a]', [['E_CONFIG', '', 'presets.Tests']]],
    ['a name that starts with a digit', 'presets:\n  1a: [a]', [['E_CONFIG', '', 'presets.1a']]],
    ['an underscore in a name', 'presets:\n  a_b: [a]', [['E_CONFIG', '', 'presets.a_b']]],
    ['an empty list', 'presets:\n  a: []', [['E_CONFIG', '', 'presets.a']]],
    ['a string instead of a list', 'presets:\n  a: x', [['E_CONFIG', '', 'presets.a']]],
    ['a mapping instead of a list', 'presets:\n  a: {use: [b]}', [['E_CONFIG', '', 'presets.a']]],
    ['a non-string pattern', 'presets:\n  a: [1]', [['E_CONFIG', '', 'presets.a']]],
    ['an invalid pattern', 'presets:\n  a: ["/abs"]', [['E_PATTERN', '', '/abs']]],
  ])('presets with %s is a configuration error', (_name, presetsYaml, expected) => {
    expect(failures(`version: 2\n${presetsYaml}\n${files}`)).toEqual(expected);
  });

  it.each([
    ['empty', '[]'],
    ['a string', 'tests'],
    ['a non-string element', '[1]'],
    ['a repeated name', '[tests, tests]'],
  ])('use that is %s is E_CONFIG on the file', (_name, use) => {
    expect(
      failures(
        `version: 2\npresets:\n  tests: [a]\nfiles:\n  a.md:\n    dependencies: [src]\n    use: ${use}\n`,
      ),
    ).toEqual([['E_CONFIG', 'a.md', 'use']]);
  });

  it('an unknown key next to use is still E_UNKNOWN_KEY', () => {
    expect(
      failures(`version: 2\nfiles:\n  a.md:\n    dependencies: [src]\n    uses: [x]\n`),
    ).toEqual([['E_UNKNOWN_KEY', 'a.md', 'uses']]);
  });
});

describe('§9.6.2 use in an inline block', () => {
  const parse = (block: string) =>
    parseBlock('d.md', scanFrontmatter(`---\ndocstamp:\n${block}\n---\n`)!);
  const subjects = (block: string) => parse(block).problems.map((d) => [d.code, d.subject]);

  it('reads use into the declaration', () => {
    const { declaration, problems } = parse('  dependencies: [src]\n  use: [tests, spec]');
    expect(problems).toEqual([]);
    expect(declaration).toEqual({
      file: 'd.md',
      dependencies: ['src'],
      use: ['tests', 'spec'],
      inline: { recorded: null },
    });
  });

  it.each([
    ['an empty list', '  use: []'],
    ['a string', '  use: tests'],
    ['a non-string element', '  use: [1]'],
    ['a repeated name', '  use: [tests, tests]'],
    ['a null', '  use:'],
  ])('use with %s is E_BLOCK', (_name, use) => {
    expect(subjects(`  dependencies: [src]\n${use}`)).toEqual([['E_BLOCK', 'use']]);
  });

  it('use does not stand in for dependencies', () => {
    expect(subjects('  use: [tests]')).toEqual([['E_BLOCK', 'dependencies']]);
  });
});

describe('§12.2 presets in a workspace', () => {
  const doc = (use: string) =>
    `---\ndocstamp:\n  dependencies: [src]\n  use: [${use}]\n---\nbody\n`;
  const tree = {
    'docstamp.yaml':
      'version: 2\npresets:\n  quiet: ["!src/**/*.test.ts"]\nfiles:\n  CLAUDE.md:\n    dependencies: [src]\n    use: [quiet]\n',
    'CLAUDE.md': '# c\n',
    'src/a.ts': 'a\n',
    'src/a.test.ts': 't\n',
  };

  it('expands a configured declaration and an inline one alike', () => {
    const ws = loadWorkspace(makeTree({ ...tree, 'docs/G.md': doc('quiet') }));
    expect(ws.attached).toEqual([]);
    expect(ws.declarations.map((d) => [d.file, d.dependencies, d.origins])).toEqual([
      ['CLAUDE.md', ['src', '!src/**/*.test.ts'], [null, 'quiet']],
      ['docs/G.md', ['src', '!src/**/*.test.ts'], [null, 'quiet']],
    ]);
  });

  it('an unknown preset is attached to the file and leaves the others alone', () => {
    const ws = loadWorkspace(makeTree({ ...tree, 'docs/G.md': doc('nope') }));
    expect(ws.attached.map((d) => [d.code, d.file, d.subject])).toEqual([
      ['E_UNKNOWN_PRESET', 'docs/G.md', 'nope'],
    ]);
    expect(ws.declarations.find((d) => d.file === 'docs/G.md')?.dependencies).toEqual(['src']);
  });

  it('an inline file that uses a preset needs a configuration file', () => {
    const ws = loadWorkspace(makeTree({ 'docs/G.md': doc('quiet'), 'src/a.ts': 'a\n' }));
    expect(ws.attached).toHaveLength(1);
    expect(ws.attached[0]).toMatchObject({ code: 'E_UNKNOWN_PRESET', subject: 'quiet' });
    expect(ws.attached[0]!.message).toContain('no configuration file');
  });

  it('a preset exclusion that matches nothing gives no warning, an own one does', () => {
    const universe = ['a.md', 'src/a.ts'];
    const evaluateWith = (declaration: Parameters<typeof evaluate>[0]) =>
      evaluate(declaration, universe, { entries: new Map() }, [], {
        isStampedFile: () => true,
        fileHash: () => 'h',
      });
    const preset = expandPresets(
      { file: 'a.md', dependencies: ['src'], use: ['tests'] },
      presets,
      [],
      true,
    );
    expect(evaluateWith(preset).diagnostics).toEqual([]);
    const own = evaluateWith({ file: 'a.md', dependencies: ['src', '!**/*.test.ts'] });
    expect(own.diagnostics.map((d) => d.code)).toEqual(['W_EMPTY_EXCLUSION']);
  });

  it('a preset pattern that matches nothing names the preset', () => {
    const declaration = expandPresets(
      { file: 'a.md', dependencies: ['src'], use: ['spec'] },
      presets,
      [],
      true,
    );
    const result = evaluate(declaration, ['a.md', 'src/a.ts'], { entries: new Map() }, [], {
      isStampedFile: () => true,
      fileHash: () => 'h',
    });
    expect(result.state).toBe('invalid');
    expect(result.diagnostics.map((d) => [d.code, d.subject])).toEqual([
      ['E_EMPTY_PATTERN', 'docs/SPEC.md'],
    ]);
    expect(result.diagnostics[0]!.message).toContain('preset "spec"');
  });

  it('the Result keeps the effective patterns, the use and the origins', () => {
    const declaration = expandPresets(
      { file: 'a.md', dependencies: ['src'], use: ['tests'] },
      presets,
      [],
      true,
    );
    const result = evaluate(declaration, ['a.md', 'src/a.ts'], { entries: new Map() }, [], {
      isStampedFile: () => true,
      fileHash: () => 'h',
    });
    expect(result).toMatchObject({
      dependencies: ['src', '!**/*.test.ts', '!**/__test__/**'],
      use: ['tests'],
      origins: [null, 'tests', 'tests'],
      resolved: ['src/a.ts'],
    });
  });
});

describe('§8.6 default presets', () => {
  it('appends the default presets after the own patterns of a declaration without use', () => {
    const expanded = expandPresets(
      { file: 'a.md', dependencies: ['src'] },
      presets,
      ['tests'],
      true,
    );
    expect(expanded.dependencies).toEqual(['src', '!**/*.test.ts', '!**/__test__/**']);
    expect(expanded.origins).toEqual([null, 'tests', 'tests']);
    expect(expanded.use).toBeUndefined();
  });

  it('an own use replaces the default presets, and use: [] uses none', () => {
    const own = expandPresets(
      { file: 'a.md', dependencies: ['src'], use: ['spec'] },
      presets,
      ['tests'],
      true,
    );
    expect(own.origins).toEqual([null, 'spec']);
    const none = { file: 'a.md', dependencies: ['src'], use: [] };
    expect(expandPresets(none, presets, ['tests'], true)).toBe(none);
  });
});

describe('§9.3 default-presets in the configuration file', () => {
  const read = (yaml: string) => readConfig(makeTree({ 'docstamp.yaml': yaml }));
  const failures = (yaml: string) => raised(() => read(yaml));
  const head = 'version: 2\npresets:\n  tests: [a]\n';

  it('reads default-presets into the config, and use: [] on a file', () => {
    const { config } = read(
      `${head}default-presets: [tests]\nfiles:\n  a.md:\n    dependencies: [src]\n    use: []\n` +
        '  b.md:\n    dependencies: [src]\n',
    );
    expect(config.defaultPresets).toEqual(['tests']);
    expect(config.declarations).toEqual([
      { file: 'a.md', dependencies: ['src'], use: [] },
      { file: 'b.md', dependencies: ['src'] },
    ]);
  });

  it('is empty when absent', () => {
    expect(read(`${head}files: {}\n`).config.defaultPresets).toEqual([]);
  });

  it.each([
    ['empty', '[]'],
    ['a string', 'tests'],
    ['a non-string element', '[1]'],
    ['a repeated name', '[tests, tests]'],
  ])('default-presets that is %s is a global E_CONFIG', (_name, value) => {
    expect(failures(`${head}default-presets: ${value}\nfiles: {}\n`)).toEqual([
      ['E_CONFIG', '', 'default-presets'],
    ]);
  });

  it('an unknown name is a global E_UNKNOWN_PRESET, also without presets', () => {
    expect(failures(`${head}default-presets: [tests, nope]\nfiles: {}\n`)).toEqual([
      ['E_UNKNOWN_PRESET', '', 'nope'],
    ]);
    expect(failures('version: 2\ndefault-presets: [tests]\nfiles: {}\n')).toEqual([
      ['E_UNKNOWN_PRESET', '', 'tests'],
    ]);
  });

  it('use: [] without default-presets stays E_CONFIG on the file', () => {
    expect(failures(`${head}files:\n  a.md:\n    dependencies: [src]\n    use: []\n`)).toEqual([
      ['E_CONFIG', 'a.md', 'use'],
    ]);
  });

  it('a near miss of default-presets names it', () => {
    try {
      read(`${head}default-preset: [tests]\nfiles: {}\n`);
      expect.unreachable();
    } catch (e) {
      const [found] = (e as Raised).diagnostics;
      expect(found).toMatchObject({ code: 'E_UNKNOWN_KEY', subject: 'default-preset' });
      expect(found!.message).toContain('"default-presets"');
    }
  });
});

describe('§9.6.2 use: [] in an inline block', () => {
  const scan = scanFrontmatter('---\ndocstamp:\n  dependencies: [src]\n  use: []\n---\n')!;

  it('is accepted only when there are default presets', () => {
    expect(parseBlock('d.md', scan, true)).toMatchObject({
      declaration: { use: [] },
      problems: [],
    });
    expect(parseBlock('d.md', scan, false).problems.map((d) => d.subject)).toEqual(['use']);
  });
});

describe('§12.2 default presets in a workspace', () => {
  const config =
    'version: 2\npresets:\n  quiet: ["!src/**/*.test.ts"]\ndefault-presets: [quiet]\n' +
    'files:\n  A.md:\n    dependencies: [src]\n  B.md:\n    dependencies: [src]\n    use: []\n';
  const tree = {
    'docstamp.yaml': config,
    'A.md': '# a\n',
    'B.md': '# b\n',
    'docs/G.md': '---\ndocstamp:\n  dependencies: [src]\n---\n',
    'docs/H.md': '---\ndocstamp:\n  dependencies: [src]\n  use: []\n---\n',
    'src/a.ts': 'a\n',
    'src/a.test.ts': 't\n',
  };

  it('applies to configured and inline declarations without a use key', () => {
    const ws = loadWorkspace(makeTree(tree));
    expect(ws.attached).toEqual([]);
    expect(ws.declarations.map((d) => [d.file, d.dependencies.length, d.origins])).toEqual([
      ['A.md', 2, [null, 'quiet']],
      ['B.md', 1, undefined],
      ['docs/G.md', 2, [null, 'quiet']],
      ['docs/H.md', 1, undefined],
    ]);
  });
});
