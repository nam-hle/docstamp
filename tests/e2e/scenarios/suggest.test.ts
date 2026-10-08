import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect } from 'vitest';
import { scenario, type Repo } from '../harness/index.ts';

const OVERVIEW = 'docs/overview.md';
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

// base 60 days ago, then five commits inside the 30-day window, each touching one area
function history(repo: Repo): void {
  repo.commit('base', ago(60));
  repo.append('src/engine/parse.ts', 'one\n');
  repo.commit('parser', ago(10));
  repo.append('src/cli/main.ts', 'one\n');
  repo.commit('cli', ago(5));
  repo.append('docs/guide/setup.md', 'one\n');
  repo.commit('guide', ago(3));
  repo.append('scripts/build.mjs', 'one\n');
  repo.commit('script', ago(2));
  repo.append('package.json', 'one\n');
  repo.commit('bump', ago(1));
}

function tree(repo: Repo, dir = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of repo.list(dir)) {
    const path = dir === '' ? name : `${dir}/${name}`;
    if (statSync(repo.path(path)).isDirectory()) Object.assign(out, tree(repo, path));
    else out[path] = repo.read(path);
  }
  return out;
}

const patterns = (doc: { [key: string]: any }): string[] =>
  (doc['files'][0].suggestions as Array<{ pattern: string }>).map((s) => s.pattern);

scenario(
  '§13.10 suggest proposes the paths a doc mentions, with counts and stale rates',
  { fixture: 'suggest' },
  async (repo) => {
    history(repo);
    const before = tree(repo);
    const text = await repo.run(['suggest', OVERVIEW], { show: [OVERVIEW] });
    expect(text.exit).toBe(0);
    expect(text.stdout).toBe(
      'suggest docs/overview.md\n' +
        '  pattern                   files   stale\n' +
        '  docs/guide/setup.md           1  0.2000\n' +
        '  scripts/*.mjs                 2  0.2000\n' +
        '  src/cli                       3  0.2000\n' +
        '  src/engine                    3  0.2000\n' +
        '  src/util                      4  0.0000\n' +
        '  tests/unit                    1  0.0000\n' +
        '  !src/engine/**/*.test.*      -1\n' +
        '  !src/engine/**/__tests__     -1\n' +
        '  ignored  build/output.js\n',
    );
    expect(text.stderr).toBe('');

    const json = await repo.run(['suggest', '--json', OVERVIEW]);
    expect(json.exit).toBe(0);
    expect(json.json()).toEqual({
      version: 2,
      mode: 'suggest',
      exitCode: 0,
      files: [
        {
          file: OVERVIEW,
          suggestions: [
            { pattern: 'docs/guide/setup.md', resolvedCount: 1, staleRate: 0.2 },
            { pattern: 'scripts/*.mjs', resolvedCount: 2, staleRate: 0.2 },
            { pattern: 'src/cli', resolvedCount: 3, staleRate: 0.2 },
            { pattern: 'src/engine', resolvedCount: 3, staleRate: 0.2 },
            { pattern: 'src/util', resolvedCount: 4, staleRate: 0 },
            { pattern: 'tests/unit', resolvedCount: 1, staleRate: 0 },
            { pattern: '!src/engine/**/*.test.*', resolvedCount: 1, staleRate: null },
            { pattern: '!src/engine/**/__tests__', resolvedCount: 1, staleRate: null },
          ],
          ignored: ['build/output.js'],
          declared: null,
          diagnostics: [],
        },
      ],
      diagnostics: [],
    });
    expect(tree(repo)).toEqual(before);
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);
  },
);

scenario(
  '§12.6 generic files, URLs, fenced code, missing paths and the doc itself are never proposed',
  { fixture: 'suggest' },
  async (repo) => {
    const result = await repo.run(['suggest', '--json', OVERVIEW], { snapshot: false });
    const proposed = patterns(result.json());
    for (const never of [
      'package.json',
      'pnpm-lock.yaml',
      'tsconfig.json',
      'Makefile',
      'LICENSE',
      'docs/missing.md',
      'build/output.js',
      OVERVIEW,
      'src/cli/main.ts',
    ]) {
      expect(proposed).not.toContain(never);
    }
    expect(proposed).toContain('src/cli');
    expect(result.json().files[0].ignored).toEqual(['build/output.js']);
  },
);

scenario(
  '§12.6 step 8 and 9 three files collapse into their directory and test files are excluded',
  { fixture: 'suggest' },
  async (repo) => {
    repo.write('docs/two.md', 'Only `src/util/a.ts` and `src/util/b.ts`.\n');
    repo.write('docs/three.md', 'Now `src/util/a.ts`, `src/util/b.ts` and `src/util/c.ts`.\n');
    repo.write(
      'docs/tests.md',
      'Also `src/engine/parse.ts`, `src/engine/emit.ts` and `src/engine/parse.test.ts`.\n',
    );
    const docs = ['docs/two.md', 'docs/three.md', 'docs/tests.md'];
    const result = await repo.run(['suggest', ...docs], { show: docs });
    expect(result.exit).toBe(0);
    expect(result.stdout).toBe(
      'suggest docs/tests.md\n' +
        '  pattern                   files  stale\n' +
        '  src/engine                    3    n/a\n' +
        '  !src/engine/**/*.test.*      -1\n' +
        '  !src/engine/**/__tests__     -1\n' +
        '  src/engine/parse.test.ts      1    n/a\n' +
        'suggest docs/three.md\n' +
        '  pattern   files  stale\n' +
        '  src/util      4    n/a\n' +
        'suggest docs/two.md\n' +
        '  pattern        files  stale\n' +
        '  src/util/a.ts      1    n/a\n' +
        '  src/util/b.ts      1    n/a\n',
    );
  },
);

scenario(
  '§13.10 stale rate is n/a without git and without commits in the window',
  { fixture: 'suggest', git: false },
  async (repo) => {
    const result = await repo.run(['suggest', 'docs/nothing.md', 'README.md', '--root', repo.root]);
    expect(result.exit).toBe(0);
    expect(result.stdout).toBe(
      'suggest README.md\n  pattern     files  stale\n  docs/guide      1    n/a\n' +
        'suggest docs/nothing.md\n  no paths found\n',
    );
    const json = await repo.run(['suggest', '--json', 'README.md', '--root', repo.root]);
    expect(json.json().files[0].suggestions[0].staleRate).toBeNull();
  },
);

scenario(
  '§13.10 a window with no commit gives n/a, not a rate of zero',
  { fixture: 'suggest' },
  async (repo) => {
    repo.commit('old', '2020-01-01T00:00:00Z');
    const result = await repo.run(['suggest', 'README.md']);
    expect(result.exit).toBe(0);
    expect(result.stdout).toBe(
      'suggest README.md\n  pattern     files  stale\n  docs/guide      1    n/a\n',
    );
  },
);

scenario(
  '§13.10 a shallow clone has no usable history and suggest still answers',
  { fixture: 'suggest' },
  async (repo) => {
    history(repo);
    const clone = repo.shallowClone('clone');
    const result = await clone.run(['suggest', 'README.md']);
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain('n/a');
    expect(result.stderr).toBe('');
  },
);

scenario('§13.10 no paths found is a success', { fixture: 'suggest' }, async (repo) => {
  const text = await repo.run(['suggest', 'docs/nothing.md']);
  expect(text.exit).toBe(0);
  expect(text.stdout).toBe('suggest docs/nothing.md\n  no paths found\n');
  const json = await repo.run(['suggest', '--json', 'docs/nothing.md']);
  expect(json.json().files[0]).toEqual({
    file: 'docs/nothing.md',
    suggestions: [],
    ignored: [],
    declared: null,
    diagnostics: [],
  });
  const written = await repo.run(['suggest', '--write', 'docs/nothing.md'], {
    show: ['docs/nothing.md'],
  });
  expect(written.exit).toBe(0);
  expect(written.stdout).toBe(
    'suggest docs/nothing.md\n  no paths found\nunchanged  docs/nothing.md\n',
  );
  expect(repo.read('docs/nothing.md')).toBe(repo.fixtureText('docs/nothing.md'));
});

scenario(
  '§9.6.5 write creates the frontmatter of a doc that has none, twice gives the same bytes',
  { fixture: 'suggest' },
  async (repo) => {
    const first = await repo.run(['suggest', '--write', OVERVIEW], { show: [OVERVIEW] });
    expect(first.exit).toBe(0);
    expect(first.stdout).toContain(`written  ${OVERVIEW}\n`);
    await repo.snapFile(OVERVIEW);
    const bytes = repo.read(OVERVIEW);
    expect(bytes.startsWith('---\ndocstamp:\n  dependencies:\n')).toBe(true);
    expect(bytes).not.toContain('hash:');
    expect(bytes.endsWith(repo.fixtureText(OVERVIEW))).toBe(true);

    const second = await repo.run(['suggest', '--write', OVERVIEW]);
    expect(second.stdout).toContain(`unchanged  ${OVERVIEW}\n`);
    expect(repo.read(OVERVIEW)).toBe(bytes);

    const json = await repo.run(['suggest', '--json', '--write', OVERVIEW]);
    expect(json.json().files[0].written).toBe(false);
    expect(repo.read(OVERVIEW)).toBe(bytes);
  },
);

scenario(
  '§9.6.5 and §13.6 the written block is unrecorded until an update, and then it is never overwritten',
  { fixture: 'suggest' },
  async (repo) => {
    await repo.run(['suggest', '--write', OVERVIEW], { snapshot: false });
    const check = await repo.run(['check', OVERVIEW]);
    expect(check.exit).toBe(1);
    expect(check.stdout).toContain(`STALE    ${OVERVIEW}  (unrecorded)`);
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);

    await repo.run(['update', OVERVIEW], { expectExit: 0 });
    expect(repo.read(OVERVIEW)).toContain('hash: ');
    const stamped = repo.read(OVERVIEW);

    const refused = await repo.run(['suggest', '--write', OVERVIEW]);
    expect(refused.exit).toBe(2);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toContain('error: E_USAGE: docs/overview.md: ');
    expect(refused.stderr).toContain('by hand');
    expect(repo.read(OVERVIEW)).toBe(stamped);

    const plain = await repo.run(['suggest', OVERVIEW]);
    expect(plain.exit).toBe(0);
    await repo.run(['check', OVERVIEW], { expectExit: 0, snapshot: false });
  },
);

scenario(
  '§9.6.5 write inserts the block into an existing frontmatter and keeps CR LF and the BOM',
  { fixture: 'suggest' },
  async (repo) => {
    repo.write(
      'docs/crlf.md',
      '﻿---\r\ntitle: Setup\r\ntags: [a, b]\r\n---\r\n# Setup\r\n\r\nSee `src/cli/main.ts` and `scripts/*.mjs`.\r\n',
    );
    repo.write('docs/lf.md', '---\ntitle: Plain\n---\nSee `src/cli/main.ts`.\n');
    const result = await repo.run(['suggest', '--write', 'docs/crlf.md', 'docs/lf.md']);
    expect(result.exit).toBe(0);
    await repo.snapFile('docs/crlf.md');
    await repo.snapFile('docs/lf.md');
    const crlf = repo.read('docs/crlf.md');
    expect(crlf.startsWith('﻿---\r\ntitle: Setup\r\ntags: [a, b]\r\ndocstamp:\r\n')).toBe(true);
    expect(crlf.replaceAll('\r\n', '')).not.toContain('\n');
    expect(crlf.endsWith('# Setup\r\n\r\nSee `src/cli/main.ts` and `scripts/*.mjs`.\r\n')).toBe(
      true,
    );
    expect(repo.read('docs/lf.md')).toBe(
      '---\ntitle: Plain\ndocstamp:\n  dependencies:\n    - src/cli/main.ts\n---\nSee `src/cli/main.ts`.\n',
    );
    const again = await repo.run(['suggest', '--write', 'docs/crlf.md', 'docs/lf.md']);
    expect(again.stdout).toContain('unchanged  docs/crlf.md\nunchanged  docs/lf.md\n');
    expect(repo.read('docs/crlf.md')).toBe(crlf);
  },
);

scenario(
  '§9.6.5 write replaces the dependencies of a block that has no hash and keeps the rest',
  { fixture: 'suggest' },
  async (repo) => {
    repo.write(
      'docs/block.md',
      '---\ntitle: Block\ndocstamp: # keep this comment\n  dependencies: [src/util]\nauthor: me\n---\nSee `src/cli` and `src/engine/parse.ts`.\n',
    );
    const result = await repo.run(['suggest', '--write', 'docs/block.md']);
    expect(result.exit).toBe(0);
    await repo.snapFile('docs/block.md');
    expect(repo.read('docs/block.md')).toBe(
      '---\ntitle: Block\ndocstamp: # keep this comment\n  dependencies:\n    - src/cli\n    - src/engine/parse.ts\nauthor: me\n---\nSee `src/cli` and `src/engine/parse.ts`.\n',
    );
    await repo.run(['check', 'docs/block.md'], { expectExit: 1, snapshot: false });
  },
);

scenario(
  '§13.10 write refuses a configured doc, an ignored doc and a doc outside include, and writes nothing',
  { fixture: 'suggest' },
  async (repo) => {
    repo.write('build/note.md', 'See `src/cli`.\n');
    const before = tree(repo);
    const configured = await repo.run(['suggest', '--write', 'docs/configured.md', OVERVIEW]);
    expect(configured.exit).toBe(2);
    expect(configured.stdout).toBe('');
    expect(configured.stderr).toBe(
      'error: E_USAGE: docs/configured.md: docs/configured.md is declared in the configuration file; edit it there by hand.\n',
    );
    const ignored = await repo.run(['suggest', '--write', 'build/note.md', 'notes.txt', OVERVIEW]);
    expect(ignored.exit).toBe(2);
    expect(ignored.stderr).toContain('error: E_USAGE: build/note.md: ');
    expect(ignored.stderr).toContain('error: E_USAGE: notes.txt: ');
    expect(tree(repo)).toEqual(before);

    const json = await repo.run(['suggest', '--json', '--write', 'docs/configured.md']);
    expect(json.exit).toBe(2);
    expect(json.stderr).toBe('');
    expect(json.json().files).toEqual([]);
    expect(json.json().diagnostics[0]).toMatchObject({
      code: 'E_USAGE',
      subject: 'docs/configured.md',
    });
  },
);

scenario(
  '§13.10 without write a configured doc, an ignored doc and a text file are only read',
  { fixture: 'suggest' },
  async (repo) => {
    repo.write('build/note.md', 'See `src/cli`.\n');
    repo.write('notes.txt', 'See `src/cli` and `scripts/check.mjs`.\n');
    const before = tree(repo);
    const result = await repo.run(['suggest', 'docs/configured.md', 'build/note.md', 'notes.txt']);
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain('suggest build/note.md\n');
    expect(result.stdout).toContain('suggest docs/configured.md\n');
    expect(result.stdout).toContain('suggest notes.txt\n');
    expect(tree(repo)).toEqual(before);
  },
);

scenario(
  '§13.10 write needs every file to be writable before it writes any',
  { fixture: 'suggest' },
  async (repo) => {
    const before = tree(repo);
    const result = await repo.run([
      'suggest',
      '--write',
      OVERVIEW,
      'docs/configured.md',
      'README.md',
    ]);
    expect(result.exit).toBe(2);
    expect(tree(repo)).toEqual(before);

    repo.write(
      'docs/hashed.md',
      `---\ndocstamp:\n  dependencies: [src]\n  hash: ${'a'.repeat(64)}\n---\nSee \`src/cli\`.\n`,
    );
    const refused = await repo.run(['suggest', '--write', OVERVIEW, 'docs/hashed.md']);
    expect(refused.exit).toBe(2);
    expect(refused.stderr).toContain('error: E_USAGE: docs/hashed.md: ');
    expect(repo.read(OVERVIEW)).toBe(repo.fixtureText(OVERVIEW));
  },
);

scenario(
  '§13.10 an inline block of the doc is never read, so a recorded doc proposes what its text says',
  { fixture: 'suggest' },
  async (repo) => {
    repo.write(
      'docs/inline.md',
      '---\ndocstamp:\n  dependencies:\n    - scripts\n    - src/util\n---\nOnly `src/cli` here.\n',
    );
    const result = await repo.run(['suggest', '--json', 'docs/inline.md']);
    expect(patterns(result.json())).toEqual(['src/cli']);
  },
);

scenario(
  '§13.10 and §13.4 files are resolved against cwd, listed once in path order, and must be inside the root',
  { fixture: 'suggest' },
  async (repo) => {
    repo.write(
      'docs/guide/page.md',
      'Reads [args](../../src/cli/args.ts) and `docs/guide/setup.md`.\n',
    );
    const nested = await repo.run(['suggest', 'page.md', '../nothing.md', './page.md'], {
      cwd: 'docs/guide',
    });
    expect(nested.exit).toBe(0);
    expect(nested.stdout).toBe(
      'suggest docs/guide/page.md\n  pattern              files  stale\n' +
        '  docs/guide/setup.md      1    n/a\n  src/cli/args.ts          1    n/a\n' +
        'suggest docs/nothing.md\n  no paths found\n',
    );
    const outside = await repo.run(['suggest', '../outside.md', 'docs/nothing.md']);
    expect(outside.exit).toBe(2);
    expect(outside.stdout).toBe('');
    expect(outside.stderr.replaceAll('\\', '/')).toBe(
      (
        'error: E_USAGE: ../outside.md: The argument is resolved against the current directory ' +
        `(${repo.root}) to ${dirname(repo.root)}/outside.md, which is outside the root ` +
        `${repo.root}; name a file inside the root.\n`
      ).replaceAll('\\', '/'),
    );
    const json = await repo.run(['suggest', '--json', '../outside.md']);
    expect(json.json().files).toEqual([]);
    expect(json.stderr).toBe('');
  },
);

scenario(
  '§12.6 steps 10 and 11 exclusions come after every inclusion, and a covered glob is dropped',
  async (repo) => {
    repo.write('packages/a/src/x.ts', 'export const x = 1;\n');
    repo.write('packages/a/src/x.test.ts', 'import { x } from "./x.ts";\n');
    repo.write('packages/b/src/y.ts', 'export const y = 2;\n');
    repo.write(
      'docs/guide.md',
      '# Guide\n\nAll code lives in `packages`. Each package has its own folder under ' +
        '`packages/*`.\n\nSee `packages/a/src/x.ts` too.\n',
    );
    repo.commit('init');
    const text = await repo.run(['suggest', 'docs/guide.md'], { show: ['docs/guide.md'] });
    expect(text.exit).toBe(0);
    expect(text.stdout).toBe(
      'suggest docs/guide.md\n' +
        '  pattern                files  stale\n' +
        '  packages                   2    n/a\n' +
        '  !packages/**/*.test.*     -1\n',
    );
    const written = await repo.run(['suggest', '--write', 'docs/guide.md'], { expectExit: 0 });
    expect(written.stdout).toContain('written  docs/guide.md\n');
    await repo.snapFile('docs/guide.md');
    expect(repo.read('docs/guide.md')).toContain(
      'docstamp:\n  dependencies:\n    - packages\n    - "!packages/**/*.test.*"\n---\n',
    );
    const listed = await repo.run(['list-dependencies', '--json', 'docs/guide.md']);
    const resolved: string[] = listed.json().files[0].resolvedFiles;
    expect(resolved).toEqual(['packages/a/src/x.ts', 'packages/b/src/y.ts']);
    expect(resolved.filter((path) => path.includes('.test.'))).toEqual([]);
  },
);

scenario('§12.6 step 11 a test file the doc names is listed after the exclusions', async (repo) => {
  repo.write('packages/a/src/x.ts', 'export const x = 1;\n');
  repo.write('packages/a/src/x.test.ts', 'import { x } from "./x.ts";\n');
  repo.write('packages/b/src/y.ts', 'export const y = 2;\n');
  repo.write(
    'docs/guide.md',
    'Code in `packages`, and `packages/*`; its test is `packages/a/src/x.test.ts`.\n',
  );
  repo.commit('init');
  await repo.run(['suggest', '--write', 'docs/guide.md'], { expectExit: 0 });
  await repo.snapFile('docs/guide.md');
  const listed = await repo.run(['list-dependencies', '--json', 'docs/guide.md']);
  expect(listed.json().files[0].dependencies).toEqual([
    'packages',
    '!packages/**/*.test.*',
    'packages/a/src/x.test.ts',
  ]);
  expect(listed.json().files[0].resolvedFiles).toEqual([
    'packages/a/src/x.test.ts',
    'packages/a/src/x.ts',
    'packages/b/src/y.ts',
  ]);
});

scenario('§9.6.5 step 3 the block follows the indent of the frontmatter', async (repo) => {
  repo.write('src/x.ts', 'export const x = 1;\n');
  repo.write('docs/guide.md', '---\nmeta:\n    owner: me\n---\nSee `src/x.ts`.\n');
  repo.commit('init');
  await repo.run(['suggest', '--write', 'docs/guide.md'], { expectExit: 0 });
  await repo.snapFile('docs/guide.md');
  expect(repo.read('docs/guide.md')).toBe(
    '---\nmeta:\n    owner: me\ndocstamp:\n    dependencies:\n      - src/x.ts\n---\nSee `src/x.ts`.\n',
  );
  expect((await repo.run(['list-dependencies', 'docs/guide.md'])).exit).toBe(0);
});

scenario(
  '§13.10 a missing file, a directory and a binary file are E_UNREADABLE',
  { fixture: 'suggest' },
  async (repo) => {
    repo.write('blob.md', new Uint8Array([0x23, 0x00, 0x01]));
    const result = await repo.run(['suggest', 'missing.md', 'docs', 'blob.md', 'README.md']);
    expect(result.exit).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'error: E_UNREADABLE: blob.md: Cannot read blob.md as text; name a readable text file.\n' +
        'error: E_UNREADABLE: docs: Cannot read docs as text; name a readable text file.\n' +
        'error: E_UNREADABLE: missing.md: Cannot read missing.md as text; name a readable text file.\n',
    );
  },
);

scenario(
  '§13.10 a repository with no configuration and no inline doc is no error for suggest',
  { fixture: 'suggest' },
  async (repo) => {
    repo.remove('docstamp.yaml');
    repo.remove('docs/configured.md');
    const text = await repo.run(['suggest', 'README.md']);
    expect(text.exit).toBe(0);
    await repo.run(['suggest', '--write', 'README.md'], { expectExit: 0 });
    await repo.snapFile('README.md');
    const check = await repo.run(['check']);
    expect(check.exit).toBe(1);
    expect(check.stdout).toContain('STALE    README.md  (unrecorded)');
  },
);

scenario(
  '§13.2 suggest needs a file, and --write is for suggest alone',
  { fixture: 'suggest' },
  async (repo) => {
    const none = await repo.run(['suggest'], { expectExit: 2 });
    expect(none.stdout).toBe('');
    expect(none.stderr).toContain('error: E_USAGE: suggest: ');
    const writing = await repo.run(['check', '--write'], { expectExit: 2 });
    expect(writing.stderr).toContain('error: E_USAGE: --write: ');
    expect(writing.stderr).toContain('docstamp update');
    await repo.run(['suggest', '--all', 'README.md'], { expectExit: 2 });
    await repo.run(['suggest', '--since', '30d', 'README.md'], { expectExit: 2 });
  },
);

scenario(
  '§17.3 a file named suggest is still reached after --',
  { fixture: 'suggest' },
  async (repo) => {
    repo.write('suggest', '# suggest\n');
    const asCommand = await repo.run(['suggest'], { expectExit: 2 });
    expect(asCommand.stderr).toContain('E_USAGE');
    const asFile = await repo.run(['--', 'suggest'], { expectExit: 2 });
    expect(asFile.stderr).toContain('E_UNKNOWN_FILE: suggest');
  },
);

scenario(
  '§13.10 step 4 a declared file shows which proposals are declared and which are new',
  { fixture: 'suggest' },
  async (repo) => {
    repo.write(
      'docstamp.yaml',
      'version: 2\nfiles:\n  docs/configured.md:\n    dependencies:\n' +
        '      - src/cli/main.ts\n      - src/gone\n',
    );
    const configured = await repo.run(['suggest', 'docs/configured.md'], {
      label: 'a configured file',
      show: ['docstamp.yaml'],
    });
    expect(configured.exit).toBe(0);
    expect(configured.stdout).toBe(
      'suggest docs/configured.md\n' +
        '  pattern          files  stale  status\n' +
        '  src/cli/main.ts      1    n/a  declared\n' +
        '  src/util             4    n/a  new\n' +
        '  only declared  src/gone\n',
    );
    const json = await repo.run(['suggest', '--json', 'docs/configured.md'], { snapshot: false });
    expect(json.json().files[0].declared).toEqual(['src/cli/main.ts', 'src/gone']);

    const text = repo.read(OVERVIEW);
    repo.write(
      OVERVIEW,
      `---\ndocstamp:\n  dependencies:\n    - src/cli\n    - old/dir\n---\n${text}`,
    );
    const inline = await repo.run(['suggest', OVERVIEW], { label: 'an inline block' });
    expect(inline.exit).toBe(0);
    expect(inline.stdout).toContain('  src/cli                       3    n/a  declared\n');
    expect(inline.stdout).toContain('  src/engine                    3    n/a  new\n');
    expect(inline.stdout).toContain('  only declared  old/dir\n');
    const written = await repo.run(['suggest', '--write', OVERVIEW], { snapshot: false });
    expect(written.stdout).toContain('  only declared  old/dir\n');
    const again = await repo.run(['suggest', '--json', OVERVIEW], { snapshot: false });
    expect(again.json().files[0].declared).toEqual(patterns(again.json()));
  },
);
