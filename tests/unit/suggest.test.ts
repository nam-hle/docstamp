import { describe, expect, it } from 'vitest';
import { propose, statusOf } from '../../src/engine/suggest.ts';

const tree = (...paths: string[]) => paths.sort();
const REPO = tree(
  'README.md',
  'package.json',
  'src/a.ts',
  'src/b.ts',
  'src/c.ts',
  'src/cli/args.ts',
  'src/cli/run.ts',
  'pkg/args.ts',
  'pkg/run.ts',
  'pkg/run.test.ts',
  'pkg/__tests__/x.ts',
  'docs/SPEC.md',
  'docs/guide/intro.md',
  'scripts/build.mjs',
  'scripts/lint.mjs',
  'big/1.ts',
  'big/2.ts',
  'big/3.ts',
  'big/4.ts',
  'big/5.ts',
  'big/6.ts',
  'big/sub/7.ts',
  'tests/unit/a.test.ts',
  'tests/unit/helper.ts',
);

const patterns = (
  text: string,
  options: { doc?: string; universe?: string[]; ignored?: string[] } = {},
) =>
  propose(
    options.doc ?? 'README.md',
    text,
    options.universe ?? REPO,
    (path) => options.ignored?.includes(path) ?? false,
  ).suggestions.map((s) => s.pattern);

describe('§12.6 Proposal', () => {
  describe('step 1 reading', () => {
    it('never reads the inline block, so writing it changes nothing', () => {
      const body = 'See `src/cli` and `docs/SPEC.md`.\n';
      const block = '---\ndocstamp:\n  dependencies:\n    - src/a.ts\n    - scripts\n---\n';
      expect(patterns(block + body)).toEqual(patterns(body));
      expect(patterns(block + body)).toEqual(['docs/SPEC.md', 'src/cli']);
    });
    it('skips fenced code blocks, backtick and tilde, and one that is never closed', () => {
      expect(patterns('```sh\nsrc/cli\n```\n`docs/SPEC.md`\n')).toEqual(['docs/SPEC.md']);
      expect(patterns('~~~\nsrc/cli\n~~~\n`docs/SPEC.md`\n')).toEqual(['docs/SPEC.md']);
      expect(patterns('`docs/SPEC.md`\n````\nsrc/cli\n```\nstill fenced\n')).toEqual([
        'docs/SPEC.md',
      ]);
      expect(patterns('```\nsrc/cli\n')).toEqual([]);
    });
    it('a line of three backticks with more backticks after it is not a fence', () => {
      expect(patterns('```src/cli``` and `docs/SPEC.md`\n')).toEqual(['docs/SPEC.md', 'src/cli']);
    });
    it('a closing fence needs the same character and at least as many', () => {
      expect(patterns('````\n```\nsrc/cli\n````\n`docs/SPEC.md`\n')).toEqual(['docs/SPEC.md']);
      expect(patterns('```\n~~~\nsrc/cli\n```\n`docs/SPEC.md`\n')).toEqual(['docs/SPEC.md']);
    });
  });

  describe('step 2 code spans', () => {
    it('takes a span without blanks, with or without a slash', () => {
      expect(patterns('`src/cli` `docs` `README.md`')).toEqual(['docs', 'src/cli']);
    });
    it('ignores a span with blanks, and the words of a command', () => {
      expect(patterns('`docstamp suggest src/cli`')).toEqual([]);
      expect(patterns('`  src/cli  `')).toEqual(['src/cli']);
    });
    it('handles longer backtick runs', () => {
      expect(patterns('``src/cli`` and ``` docs ```')).toEqual(['docs', 'src/cli']);
    });
    it('a span does not cross a line', () => {
      expect(patterns('`docs/SPEC.md\nsrc/a.ts` `a`')).toEqual(['docs/SPEC.md', 'src/a.ts']);
      expect(patterns('`docs\nsrc/a.ts`')).toEqual(['src/a.ts']);
    });
  });

  describe('step 3 links', () => {
    it('resolves a target against the directory of the doc', () => {
      const doc = 'docs/guide/index.md';
      const universe = tree(doc, ...REPO);
      expect(patterns('[a](../SPEC.md) [b](intro.md) [c](./intro.md)', { doc, universe })).toEqual([
        'docs/SPEC.md',
        'docs/guide/intro.md',
      ]);
    });
    it('a leading slash is relative to the root', () => {
      const doc = 'docs/guide/index.md';
      expect(patterns('[a](/src/cli)', { doc, universe: tree(doc, ...REPO) })).toEqual(['src/cli']);
    });
    it('strips the fragment and the query', () => {
      expect(patterns('[a](docs/SPEC.md#8-patterns) [b](src/a.ts?plain=1)')).toEqual([
        'docs/SPEC.md',
        'src/a.ts',
      ]);
    });
    it('ignores a scheme, a pure fragment and a target that leaves the root', () => {
      expect(
        patterns(
          '[a](https://example.com/src/a.ts) [b](#top) [c](mailto:x@y.z) [d](../../src/a.ts) [e](//cdn/src/a.ts)',
        ),
      ).toEqual([]);
    });
    it('reads angle brackets, images and percent escapes', () => {
      const universe = tree(...REPO, 'my docs/a b.md');
      expect(patterns('![i](<my docs/a b.md>) [j](my%20docs/a%20b.md)', { universe })).toEqual([
        'my docs/a b.md',
      ]);
    });
    it('a malformed percent escape stays as written', () => {
      const universe = tree(...REPO, '100%.md');
      expect(patterns('[a](100%.md)', { universe })).toEqual(['100%.md']);
    });
    it('reads a reference definition', () => {
      expect(patterns('see [spec]\n\n[spec]: docs/SPEC.md "Spec"\n')).toEqual(['docs/SPEC.md']);
    });
    it('a link target is not read again as a root-relative word', () => {
      const doc = 'docs/guide/index.md';
      const universe = tree(doc, ...REPO);
      expect(patterns('[a](intro.md) and [b](docs/SPEC.md)', { doc, universe })).toEqual([
        'docs/guide/intro.md',
      ]);
    });
    it('link syntax inside a code span is not a link', () => {
      expect(patterns('`[a](src/a.ts)`')).toEqual([]);
    });
  });

  describe('step 4 bare words', () => {
    it('takes a word with a slash, in prose and in parentheses', () => {
      expect(patterns('The code in src/cli (and docs/SPEC.md) is typed.')).toEqual([
        'docs/SPEC.md',
        'src/cli',
      ]);
    });
    it('a word without a slash is not a mention', () => {
      expect(patterns('README.md and src and docs')).toEqual([]);
    });
    it('a word that starts with * is emphasis, not a glob', () => {
      expect(patterns('**src/cli** and *docs/SPEC.md*')).toEqual([]);
    });
    it('splits at quotes, pipes and semicolons', () => {
      expect(patterns('<a href="docs/SPEC.md">x</a>; src/cli|src/a.ts')).toEqual([
        'docs/SPEC.md',
        'src/a.ts',
        'src/cli',
      ]);
    });
  });

  describe('step 5 normalization', () => {
    it('strips trailing punctuation from a bare word, not from a span', () => {
      expect(patterns('Look at src/cli, docs/SPEC.md. Also src/a.ts!')).toEqual([
        'docs/SPEC.md',
        'src/a.ts',
        'src/cli',
      ]);
      const universe = tree(...REPO, 'odd.');
      expect(patterns('`odd.`', { universe })).toEqual(['odd.']);
    });
    it('strips a line and column suffix and a fragment', () => {
      expect(patterns('`big/1.ts:12` `big/2.ts:3:4` `docs/SPEC.md#8` big/3.ts:9.')).toEqual([
        'big/1.ts',
        'big/2.ts',
        'big/3.ts',
        'docs/SPEC.md',
      ]);
    });
    it('strips ./ and a leading and trailing slash', () => {
      expect(patterns('`./src/a.ts` `/src/b.ts` `src/cli/` `./`')).toEqual([
        'src/a.ts',
        'src/b.ts',
        'src/cli',
      ]);
    });
    it('drops a scheme, a backslash and a dot or empty segment', () => {
      const universe = tree(...REPO, 'c:/x', 'a/b.ts');
      expect(
        patterns('`https://src/a.ts` `src\\a.ts` `src/./a.ts` `src/../src/a.ts` `a//b.ts`', {
          universe,
        }),
      ).toEqual([]);
    });
    it('puts a name in NFC', () => {
      const universe = tree(...REPO, '\u00e9/a.ts');
      expect(patterns('`e\u0301/a.ts`', { universe })).toEqual(['\u00e9/a.ts']);
    });
  });

  describe('step 6 classification', () => {
    it('a file, a directory, and a name that exists nowhere', () => {
      expect(patterns('`src/a.ts` `docs` `nowhere/x.ts`')).toEqual(['docs', 'src/a.ts']);
    });
    it('a directory counts only when it holds a file other than the doc', () => {
      const universe = tree('docs/only.md', 'src/a.ts');
      expect(patterns('`docs` `src`', { doc: 'docs/only.md', universe })).toEqual(['src']);
    });
    it('the doc itself is never proposed', () => {
      expect(patterns('`README.md` and `./README.md`')).toEqual([]);
    });
    it('a mention of an ignored path is a note, never a proposal', () => {
      const result = propose('README.md', '`dist/index.js` `dist` `src/a.ts`', REPO, (path) =>
        path.startsWith('dist'),
      );
      expect(result.suggestions.map((s) => s.pattern)).toEqual(['src/a.ts']);
      expect(result.ignored).toEqual(['dist', 'dist/index.js']);
    });
    it('the doc itself is not listed as ignored', () => {
      const result = propose('README.md', '`README.md`', REPO, () => true);
      expect(result.ignored).toEqual([]);
    });
    it('a glob is kept when it selects a file of the universe', () => {
      expect(patterns('`scripts/*.mjs` `src/**/*.ts` `nowhere/*.x`')).toEqual([
        'scripts/*.mjs',
        'src/**/*.ts',
      ]);
    });
    it('a glob in a bare word and with an alternation', () => {
      expect(patterns('see scripts/{build,lint}.mjs and docs/*/intro.md')).toEqual([
        'docs/*/intro.md',
        'scripts/{build,lint}.mjs',
      ]);
    });
    it('a glob that is not a valid pattern is dropped', () => {
      expect(patterns('`src/[a-.ts` `src/**a/x` `!src/*.ts` `src/{a}.ts`')).toEqual([]);
    });
    it('a glob made only of wildcards is never proposed', () => {
      expect(patterns('`*` `**` `*/*` `**/*`')).toEqual([]);
    });
    it('a glob that selects only generic files is dropped', () => {
      expect(patterns('`*.json`')).toEqual([]);
    });
    it('a glob that selects a generic file as well as another is kept as written', () => {
      const universe = tree(...REPO, 'tsconfig.json', 'schema.json');
      const result = propose('README.md', '`*.json`', universe, () => false);
      expect(result.suggestions).toEqual([
        { pattern: '*.json', files: ['package.json', 'schema.json', 'tsconfig.json'] },
      ]);
    });
    it('a literal that is not a valid pattern as written is dropped', () => {
      const universe = tree(...REPO, 'a,b.ts', 'c]d.ts');
      expect(patterns('`a,b.ts` `c]d.ts`', { universe })).toEqual([]);
    });
    it('a name starting with ! is dropped', () => {
      const universe = tree(...REPO, '!x/a.ts');
      expect(patterns('`!x/a.ts`', { universe })).toEqual([]);
    });
  });

  describe('step 7 generic files', () => {
    const GENERIC = [
      'package.json',
      'package-lock.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'yarn.lock',
      'bun.lock',
      'bun.lockb',
      'deno.json',
      'deno.jsonc',
      'pyproject.toml',
      'requirements.txt',
      'setup.py',
      'setup.cfg',
      'poetry.lock',
      'uv.lock',
      'Cargo.toml',
      'Cargo.lock',
      'go.mod',
      'go.sum',
      'pom.xml',
      'Gemfile',
      'Gemfile.lock',
      'composer.json',
      'composer.lock',
      'build.gradle',
      'build.gradle.kts',
      'settings.gradle',
      'settings.gradle.kts',
      'gradle.properties',
      'Makefile',
      'CMakeLists.txt',
      'LICENSE',
      'LICENSE.md',
      'LICENSE.txt',
      'LICENCE',
      'COPYING',
      'CHANGELOG.md',
      '.gitignore',
      '.gitattributes',
      'docstamp.yaml',
      'docstamp.config.ts',
      'docstamp.config.mts',
      'docstamp.config.js',
      'docstamp.config.mjs',
      'docstamp-lock.yaml',
      'tsconfig.json',
      'tsconfig.lib.json',
      'tsconfig.build.prod.json',
    ];
    it.each(GENERIC)('%s at the root is never proposed', (name) => {
      expect(patterns(`\`${name}\` and \`src/a.ts\``, { universe: tree(...REPO, name) })).toEqual([
        'src/a.ts',
      ]);
    });
    it('the same name below the root is an ordinary file', () => {
      const universe = tree(...REPO, 'src/package.json', 'src/tsconfig.json', 'src/CHANGELOG.md');
      expect(
        patterns('`src/package.json` `src/tsconfig.json` `src/CHANGELOG.md`', { universe }),
      ).toEqual(['src/CHANGELOG.md', 'src/package.json', 'src/tsconfig.json']);
    });
    it('a name that only looks like a tsconfig is ordinary', () => {
      const universe = tree(...REPO, 'tsconfig.md', 'mytsconfig.json');
      expect(patterns('`tsconfig.md` `mytsconfig.json`', { universe })).toEqual([
        'mytsconfig.json',
        'tsconfig.md',
      ]);
    });
  });

  describe('step 8 collapse', () => {
    it('three files of a directory with at most five files become the directory', () => {
      expect(
        patterns('`src/a.ts` `src/b.ts` `src/c.ts`', {
          universe: tree('src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'),
        }),
      ).toEqual(['src']);
    });
    it('two files of a directory stay files', () => {
      expect(
        patterns('`src/a.ts` `src/b.ts`', { universe: tree('src/a.ts', 'src/b.ts', 'src/c.ts') }),
      ).toEqual(['src/a.ts', 'src/b.ts']);
    });
    it('three files of a larger directory stay files unless all of it was mentioned', () => {
      expect(patterns('`big/1.ts` `big/2.ts` `big/3.ts`')).toEqual([
        'big/1.ts',
        'big/2.ts',
        'big/3.ts',
      ]);
      const universe = tree(...Array.from({ length: 7 }, (_, i) => `d/${i}.ts`));
      const all = universe.map((path) => `\`${path}\``).join(' ');
      expect(patterns(all, { universe })).toEqual(['d']);
      expect(patterns(all.replace('`d/6.ts`', ''), { universe })).toEqual(universe.slice(0, 6));
    });
    it('the files below a subdirectory count towards the size of the directory', () => {
      expect(
        patterns('`big/1.ts` `big/2.ts` `big/3.ts` `big/4.ts` `big/5.ts` `big/6.ts`'),
      ).toHaveLength(6);
      const small = tree('s/1.ts', 's/2.ts', 's/3.ts', 's/sub/4.ts', 's/sub/5.ts');
      expect(patterns('`s/1.ts` `s/2.ts` `s/3.ts`', { universe: small })).toEqual(['s']);
    });
    it('exactly five files collapse, six do not', () => {
      const five = tree(...Array.from({ length: 5 }, (_, i) => `d/${i}.ts`));
      const six = tree(...Array.from({ length: 6 }, (_, i) => `d/${i}.ts`));
      expect(patterns('`d/0.ts` `d/1.ts` `d/2.ts`', { universe: five })).toEqual(['d']);
      expect(patterns('`d/0.ts` `d/1.ts` `d/2.ts`', { universe: six })).toHaveLength(3);
    });
    it('files at the root never collapse', () => {
      const universe = tree('a.ts', 'b.ts', 'c.ts', 'README.md');
      expect(patterns('`a.ts` `b.ts` `c.ts`', { universe })).toEqual(['a.ts', 'b.ts', 'c.ts']);
    });
    it('a generic file does not count as a mention', () => {
      const universe = tree('README.md', 'package.json', 'a.ts');
      expect(patterns('`package.json` `a.ts`', { universe })).toEqual(['a.ts']);
    });
  });

  describe('step 9 coverage and test exclusions', () => {
    it('a directory covers the files and the directories below it', () => {
      expect(patterns('`src` `src/a.ts` `src/cli` `src/cli/args.ts`')).toEqual(['src']);
    });
    it('proposes an exclusion for each test shape that matches a file', () => {
      const universe = tree(
        'README.md',
        'src/a.ts',
        'src/a.spec.ts',
        'src/x/__test__/b.ts',
        'src/y/__tests__/c.ts',
        'src/d.test.js',
      );
      expect(patterns('`src`', { universe })).toEqual([
        'src',
        '!src/**/*.test.*',
        '!src/**/*.spec.*',
        '!src/**/__test__',
        '!src/**/__tests__',
      ]);
    });
    it('proposes no exclusion that matches nothing', () => {
      expect(patterns('`docs`')).toEqual(['docs']);
      expect(patterns('`scripts`')).toEqual(['scripts']);
    });
    it('proposes none for a directory that is itself a place of tests', () => {
      expect(patterns('`tests/unit`')).toEqual(['tests/unit']);
      expect(patterns('`pkg/__tests__`')).toEqual(['pkg/__tests__']);
    });
    it('an exclusion is a Suggestion with the files it matches; the directory has the rest', () => {
      const result = propose('README.md', '`pkg`', REPO, () => false);
      expect(result.suggestions).toEqual([
        { pattern: 'pkg', files: ['pkg/args.ts', 'pkg/run.ts'] },
        { pattern: '!pkg/**/*.test.*', files: ['pkg/run.test.ts'] },
        { pattern: '!pkg/**/__tests__', files: ['pkg/__tests__/x.ts'] },
      ]);
    });
    it('a test file that is mentioned by name is kept, after the exclusion that cuts it', () => {
      expect(patterns('`pkg` and `pkg/run.test.ts`')).toEqual([
        'pkg',
        '!pkg/**/*.test.*',
        '!pkg/**/__tests__',
        'pkg/run.test.ts',
      ]);
    });
    it('a mentioned file that no exclusion cuts is covered by the directory', () => {
      expect(patterns('`pkg` and `pkg/run.ts`')).toEqual([
        'pkg',
        '!pkg/**/*.test.*',
        '!pkg/**/__tests__',
      ]);
    });
    it('exclusions are proposed for a directory that collapsed too', () => {
      const universe = tree('README.md', 'd/a.ts', 'd/b.ts', 'd/c.ts', 'd/c.test.ts');
      expect(patterns('`d/a.ts` `d/b.ts` `d/c.ts`', { universe })).toEqual(['d', '!d/**/*.test.*']);
      expect(patterns('`d/a.ts` `d/b.ts` `d/c.test.ts`', { universe })).toEqual([
        'd',
        '!d/**/*.test.*',
        'd/c.test.ts',
      ]);
    });
  });

  describe('step 10 subsumption', () => {
    it('drops a glob that the directory covers, as in packages/* under packages', () => {
      const universe = tree(
        'docs/guide.md',
        'packages/a/src/x.ts',
        'packages/a/src/x.test.ts',
        'packages/b/src/y.ts',
      );
      const text =
        'All code lives in `packages`. Each package has its own folder under `packages/*`.\n\n' +
        'See `packages/a/src/x.ts` too.\n';
      const result = propose('docs/guide.md', text, universe, () => false);
      expect(result.suggestions).toEqual([
        { pattern: 'packages', files: ['packages/a/src/x.ts', 'packages/b/src/y.ts'] },
        { pattern: '!packages/**/*.test.*', files: ['packages/a/src/x.test.ts'] },
      ]);
    });
    it('drops a directory and a file below a mentioned directory or glob', () => {
      const universe = tree('README.md', 'docs/a.md', 'docs/reference/b.md', 'docs/reference/c.md');
      expect(patterns('`docs` and `docs/reference/*`', { universe })).toEqual(['docs']);
      expect(patterns('`scripts/*.mjs` and `scripts/build.mjs`')).toEqual(['scripts/*.mjs']);
    });
    it('keeps the first in path order of two that select the same files', () => {
      expect(patterns('`scripts` and `scripts/*.mjs`')).toEqual(['scripts']);
    });
    it('keeps an inclusion that selects a file the other does not', () => {
      expect(patterns('`src/*.ts` and `src/cli/args.ts`')).toEqual(['src/*.ts', 'src/cli/args.ts']);
    });
  });

  describe('step 11 order', () => {
    it('is path order of the inclusions, then every exclusion', () => {
      expect(patterns('`pkg` `src/cli` `docs/SPEC.md` `scripts/*.mjs` `big/1.ts`')).toEqual([
        'big/1.ts',
        'docs/SPEC.md',
        'pkg',
        'scripts/*.mjs',
        'src/cli',
        '!pkg/**/*.test.*',
        '!pkg/**/__tests__',
      ]);
    });
    it('an inclusion before the exclusions has the files they leave', () => {
      const universe = tree('README.md', 'p/a/x.ts', 'p/a/x.test.ts', 'p/b.ts', 'p2/q.ts');
      const { suggestions } = propose('README.md', '`p` and `p*/*.ts`', universe, () => false);
      expect(suggestions).toEqual([
        { pattern: 'p', files: ['p/a/x.ts', 'p/b.ts'] },
        { pattern: 'p*/*.ts', files: ['p/b.ts', 'p2/q.ts'] },
        { pattern: '!p/**/*.test.*', files: ['p/a/x.test.ts'] },
      ]);
    });
    it('lists each file once, whatever the number of mentions', () => {
      expect(patterns('`src/a.ts` src/a.ts [x](src/a.ts) `./src/a.ts`')).toEqual(['src/a.ts']);
    });
    it('counts the files of a pattern in the universe without the doc', () => {
      const result = propose(
        'docs/a.md',
        '`docs`',
        tree('docs/a.md', 'docs/b.md', 'docs/c.md'),
        () => false,
      );
      expect(result.suggestions).toEqual([{ pattern: 'docs', files: ['docs/b.md', 'docs/c.md'] }]);
    });
    it('no mention is no suggestion', () => {
      expect(propose('README.md', 'Nothing here.\n', REPO, () => false)).toEqual({
        suggestions: [],
        ignored: [],
      });
    });
  });
});

describe('§13.10 step 4 status', () => {
  const files = REPO.filter((path) => path !== 'README.md');
  const status = (pattern: string, selected: string[], declared: string[]) =>
    statusOf({ pattern, files: selected }, declared, files);
  it('declared when the pattern is in the list as written', () => {
    expect(status('src/a.ts', ['src/a.ts'], ['src/a.ts'])).toBe('declared');
    expect(status('!src/**/*.test.*', [], ['src', '!src/**/*.test.*'])).toBe('declared');
  });
  it('covered when the declared patterns select every file of it', () => {
    expect(status('src/a.ts', ['src/a.ts'], ['src/**/*.ts'])).toBe('covered');
    expect(status('src/cli', ['src/cli/args.ts', 'src/cli/run.ts'], ['src'])).toBe('covered');
  });
  it('new when one file is not selected, an exclusion cuts it, or the pattern is invalid', () => {
    expect(status('pkg', ['pkg/args.ts', 'pkg/run.ts'], ['pkg/args.ts'])).toBe('new');
    expect(status('src/a.ts', ['src/a.ts'], ['src', '!src/a.ts'])).toBe('new');
    expect(status('src/a.ts', ['src/a.ts'], ['src/[', 'docs'])).toBe('new');
  });
  it('an exclusion and a pattern with no files are never covered', () => {
    expect(status('!pkg/**/*.test.*', ['pkg/run.test.ts'], ['pkg'])).toBe('new');
    expect(status('src', [], ['src/**'])).toBe('new');
  });
});
