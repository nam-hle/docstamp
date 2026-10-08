import { expect } from 'vitest';
import { config, scenario, type Repo } from '../harness/index.ts';

const fixture = 'inline-docs';
const HASH_LINE = /^ {2}hash: [0-9a-f]{64}\r?$/u;

const withoutHashLines = (text: string): string[] =>
  text.split('\n').filter((line) => !HASH_LINE.test(line));

async function reviewedRepo(repo: Repo): Promise<void> {
  repo.commit('initial');
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.commit('review');
}

scenario(
  '§6 and §9.6 a repo with only inline docs needs no configuration and no lockfile',
  { fixture },
  async (repo) => {
    repo.commit('initial');
    const first = await repo.run([], { show: ['README.md'] });
    expect(first.exit).toBe(1);
    expect(first.stdout).toBe(
      'STALE    README.md  (unrecorded)\n' +
        '  depends   src/cli\n' +
        '  depends   docs/GUIDE.md\n' +
        'STALE    docs/GUIDE.md  (unrecorded)\n' +
        '  depends   src/core\n' +
        '0 ok, 2 stale, 0 invalid\n' +
        'next: review each stale file against its dependencies, then run: ' +
        'docstamp update README.md docs/GUIDE.md\n',
    );

    const update = await repo.run(['update', '--all'], { show: ['README.md', 'docs/GUIDE.md'] });
    expect(update.stdout).toBe('written  README.md\nwritten  docs/GUIDE.md\n');
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);
    expect(repo.exists('docstamp.yaml')).toBe(false);
    repo.commit('review');
    const ok = await repo.run([]);
    expect(ok).toMatchObject({ exit: 0, stdout: '2 ok, 0 stale, 0 invalid\n', stderr: '' });

    repo.append('src/cli/run.ts', 'export const more = 1;\n');
    repo.commit('edit a dependency');
    const stale = await repo.run([]);
    expect(stale.exit).toBe(1);
    expect(stale.stdout.replace(/[0-9a-f]{40}/u, '<C>')).toBe(
      'STALE    README.md  (content-changed)\n' +
        '  modified  src/cli/run.ts\n' +
        '  review: git diff -M <C> -- src/cli/run.ts\n' +
        '1 ok, 1 stale, 0 invalid\n' +
        'next: review each stale file against its dependencies, then run: docstamp update README.md\n',
    );
    const json = (await repo.run(['--json'])).json();
    expect(json.files[0]).toMatchObject({
      file: 'README.md',
      state: 'stale',
      reasons: ['content-changed'],
      dependencies: ['src/cli', 'docs/GUIDE.md'],
      changes: [{ status: 'modified', path: 'src/cli/run.ts' }],
    });

    await repo.run(['update', 'README.md'], { expectExit: 0, show: ['README.md'] });
    repo.commit('review again');
    expect((await repo.run([])).stdout).toBe('2 ok, 0 stale, 0 invalid\n');
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);
  },
);

scenario(
  '§6 a .git file marks the root, so a linked work tree needs no configuration',
  { fixture, git: false },
  async (repo) => {
    repo.write('.git', 'gitdir: ../elsewhere\n');
    const nested = await repo.run(['GUIDE.md'], { cwd: 'docs' });
    expect(nested.exit).toBe(1);
    expect(nested.stdout).toContain('STALE    docs/GUIDE.md  (unrecorded)\n');
    await repo.run(['update', '--all'], { cwd: 'src/cli', expectExit: 0 });
    expect((await repo.run([], { cwd: 'src' })).stdout).toBe('2 ok, 0 stale, 0 invalid\n');
    expect(repo.exists('src/docstamp-lock.yaml')).toBe(false);
  },
);

scenario(
  '§6 no configuration file and no .git is E_CONFIG_MISSING',
  { fixture, git: false },
  async (repo) => {
    const result = await repo.run([]);
    expect(result.exit).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('error: E_CONFIG_MISSING: ');
  },
);

scenario(
  '§12.2 no configuration file and no inline block is E_CONFIG_MISSING, not a pass',
  { fixture },
  async (repo) => {
    repo.write('README.md', '# plain\n');
    repo.write('docs/GUIDE.md', '---\ntitle: plain\n---\n');
    const result = await repo.run([]);
    expect(result.exit).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('error: E_CONFIG_MISSING: ');
    expect(result.stderr).toContain('docstamp block');
    repo.write('docstamp.yaml', 'version: 2\nfiles: {}\n');
    const empty = await repo.run([], { show: ['docstamp.yaml'] });
    expect(empty).toMatchObject({ exit: 0, stdout: '0 ok, 0 stale, 0 invalid\n', stderr: '' });
  },
);

scenario(
  '§10.2 re-stamping an inline doc never makes a doc that depends on it stale',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    repo.append('src/core/hash.ts', 'export const more = 1;\n');
    const guide = await repo.run([], { label: 'the guide went stale' });
    expect(guide.stdout).toContain('STALE    docs/GUIDE.md  (content-changed)\n');
    expect(guide.stdout).toContain('1 ok, 1 stale, 0 invalid\n');

    const before = repo.read('docs/GUIDE.md');
    await repo.run(['update', 'docs/GUIDE.md'], { expectExit: 0, label: 'restamp the guide' });
    expect(repo.read('docs/GUIDE.md')).not.toBe(before);
    const after = await repo.run([], { label: 'README stays ok after the guide is re-stamped' });
    expect(after).toMatchObject({ exit: 0, stdout: '2 ok, 0 stale, 0 invalid\n' });

    repo.write('docs/GUIDE.md', repo.read('docs/GUIDE.md').replace('compares', 'also compares'));
    const prose = await repo.run([], { label: 'guide prose edited' });
    expect(prose.exit).toBe(1);
    expect(prose.stdout).toContain('STALE    README.md  (content-changed)\n');
    expect(prose.stdout).toContain('1 ok, 1 stale, 0 invalid\n');
    await repo.run(['update', 'README.md'], { expectExit: 0, label: 'review README' });

    repo.write(
      'docs/GUIDE.md',
      repo
        .read('docs/GUIDE.md')
        .replace('    - src/core\n', '    - src/core\n    - src/index.ts\n'),
    );
    const dependencies = await repo.run([], { label: 'guide dependencies edited' });
    expect(dependencies.exit).toBe(1);
    expect(dependencies.stdout).toContain('STALE    README.md  (content-changed)\n');
    expect(dependencies.stdout).toContain('STALE    docs/GUIDE.md  (content-changed)\n');

    await repo.run(['update', 'docs/GUIDE.md', 'README.md'], { expectExit: 0 });
    expect((await repo.run([])).stdout).toBe('2 ok, 0 stale, 0 invalid\n');
  },
);

scenario(
  '§9.6.4 update rewrites only the hash line, keeping every other byte',
  { fixture },
  async (repo) => {
    const readme = repo.read('README.md');
    const guide = repo.read('docs/GUIDE.md');
    await repo.run(['update', '--all'], { expectExit: 0 });
    expect(
      repo
        .read('README.md')
        .split('\n')
        .filter((l) => !HASH_LINE.test(l)),
    ).toEqual(readme.split('\n'));
    expect(repo.read('README.md')).toMatch(
      /^---\ntitle: Project README\ndocstamp:\n {2}dependencies: \[src\/cli, docs\/GUIDE\.md\]\n {2}hash: [0-9a-f]{64}\n---\n/u,
    );
    expect(repo.read('docs/GUIDE.md')).toMatch(/\n {4}- src\/core\n {2}hash: [0-9a-f]{64}\n---\n/u);
    expect(withoutHashLines(repo.read('docs/GUIDE.md'))).toEqual(guide.split('\n'));

    const stamped = repo.read('README.md');
    const again = await repo.run(['update', 'README.md', 'docs/GUIDE.md'], { expectExit: 0 });
    expect(again.stdout).toBe('unchanged  README.md\nunchanged  docs/GUIDE.md\n');
    expect(repo.read('README.md')).toBe(stamped);

    repo.append('src/cli/run.ts', 'export const more = 1;\n');
    const hashBefore = /[0-9a-f]{64}/u.exec(stamped)![0];
    await repo.run(['update', 'README.md'], { expectExit: 0 });
    const restamped = repo.read('README.md');
    expect(restamped).toBe(stamped.replace(hashBefore, /[0-9a-f]{64}/u.exec(restamped)![0]));
    expect(restamped).not.toBe(stamped);
    expect(repo.list()).toEqual(['README.md', 'docs', 'src']);
    expect(repo.list('docs')).toEqual(['GUIDE.md', 'NOTES.md']);
  },
);

scenario(
  '§9.6.4 CR LF, a byte order mark, comments and a block in the middle survive an update',
  { fixture },
  async (repo) => {
    repo.write(
      'docs/WIN.md',
      '---\r\ntitle: Win\r\ndocstamp:\r\n  # why: reviewed by hand\r\n  dependencies: [src/core]\r\n---\r\nBody\r\n',
    );
    repo.write(
      'docs/BOM.md',
      '﻿---\ntitle: Bom\ndocstamp:\n  dependencies: [src/core] # core\n  hash: ' +
        '0'.repeat(64) +
        '   # old\nafter: kept\n---\nBody\n',
    );
    repo.write(
      'docs/MID.md',
      '---\ndocstamp:\n    dependencies:\n      - src/core # a\n\n    # trailing note\ntail: 1\n---\nBody\n',
    );
    const originals = Object.fromEntries(
      ['docs/WIN.md', 'docs/BOM.md', 'docs/MID.md'].map((path) => [path, repo.read(path)]),
    );
    await repo.run(['update', 'docs/WIN.md', 'docs/BOM.md', 'docs/MID.md'], {
      expectExit: 0,
      show: ['docs/WIN.md', 'docs/BOM.md', 'docs/MID.md'],
    });

    const win = repo.read('docs/WIN.md');
    expect(win).toMatch(
      /^---\r\ntitle: Win\r\ndocstamp:\r\n {2}# why: reviewed by hand\r\n {2}dependencies: \[src\/core\]\r\n {2}hash: [0-9a-f]{64}\r\n---\r\nBody\r\n$/u,
    );
    expect(win.replaceAll('\r\n', '')).not.toContain('\n');

    const bom = repo.read('docs/BOM.md');
    expect(bom.startsWith('﻿---\n')).toBe(true);
    expect(bom).toMatch(/\n {2}hash: [0-9a-f]{64} {3}# old\nafter: kept\n---\nBody\n$/u);
    expect(bom).not.toContain('0'.repeat(64));
    expect(bom.replace(/[0-9a-f]{64}/u, '' + '0'.repeat(64))).toBe(originals['docs/BOM.md']);

    const mid = repo.read('docs/MID.md');
    expect(mid).toBe(
      originals['docs/MID.md']!.replace(
        '    # trailing note\n',
        `    # trailing note\n    hash: ${/[0-9a-f]{64}/u.exec(mid)![0]}\n`,
      ),
    );
    const ok = await repo.run(['docs/WIN.md', 'docs/BOM.md', 'docs/MID.md']);
    expect(ok).toMatchObject({ exit: 0, stdout: '3 ok, 0 stale, 0 invalid\n' });
  },
);

scenario(
  '§9.6.3 moving or renaming an inline doc keeps its declaration and its hash valid',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    repo.rename('README.md', 'docs/OVERVIEW.md');
    const moved = await repo.run(['--json'], { label: 'README moved under docs' });
    expect(moved.exit).toBe(0);
    expect(
      moved.json().files.map((f: { file: string; state: string }) => [f.file, f.state]),
    ).toEqual([
      ['docs/GUIDE.md', 'ok'],
      ['docs/OVERVIEW.md', 'ok'],
    ]);
    repo.rename('docs/GUIDE.md', 'docs/guide-core.md');
    const renamed = await repo.run([], { label: 'a dependency of another doc is renamed' });
    expect(renamed.exit).toBe(2);
    expect(renamed.stderr).toContain('E_EMPTY_PATTERN: docs/OVERVIEW.md: docs/GUIDE.md');
  },
);

scenario(
  '§13.6 mixed mode: inline docs and configured files share a repo, the lock holds only configured ones',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', config({ 'CLAUDE.md': ['src/**'] }));
    repo.write('CLAUDE.md', '# claude\n');
    repo.commit('initial');
    const first = await repo.run([]);
    expect(first.exit).toBe(1);
    expect(first.stdout).toContain('3 stale');
    const update = await repo.run(['update', '--all'], { expectExit: 0 });
    expect(update.stdout).toBe('written  CLAUDE.md\nwritten  README.md\nwritten  docs/GUIDE.md\n');
    await repo.snapFile('docstamp-lock.yaml');
    expect(repo.read('docstamp-lock.yaml')).not.toContain('README.md');
    repo.commit('review');
    expect((await repo.run([])).stdout).toBe('3 ok, 0 stale, 0 invalid\n');

    repo.append('src/core/hash.ts', 'export const more = 1;\n');
    const stale = await repo.run([]);
    expect(stale.stdout).toContain('STALE    CLAUDE.md  (content-changed)\n');
    expect(stale.stdout).toContain('STALE    docs/GUIDE.md  (content-changed)\n');
    expect(stale.stdout).toContain('1 ok, 2 stale, 0 invalid\n');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0, label: 'update one configured file' });
    expect((await repo.run(['--json'])).json().summary).toEqual({ ok: 2, stale: 1, invalid: 0 });
  },
);

scenario(
  '§12.2 a lock entry of a file that is now declared only inline is an orphan',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', config({ 'README.md': ['src/cli'], 'CLAUDE.md': ['src/**'] }));
    repo.write('CLAUDE.md', '# claude\n');
    repo.write('README.md', '# plain readme, declared in the configuration file\n');
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.write('docstamp.yaml', config({ 'CLAUDE.md': ['src/**'] }));
    repo.write(
      'README.md',
      '---\ndocstamp:\n  dependencies: [src/cli]\n---\n# readme, now inline\n',
    );
    const orphan = await repo.run([], { show: ['docstamp.yaml'] });
    expect(orphan.stderr).toContain('warning: W_ORPHAN: README.md: ');
    expect(orphan.stdout).toContain('STALE    README.md  (unrecorded)\n');
    const update = await repo.run(['update', '--all'], { expectExit: 0 });
    expect(update.stdout).toContain('removed  README.md\n');
    expect(repo.read('docstamp-lock.yaml')).not.toContain('README.md');
  },
);

scenario(
  '§14.3.3 the next line of an invalid inline file names the docstamp block',
  { fixture },
  async (repo) => {
    repo.write('docs/GUIDE.md', repo.read('docs/GUIDE.md').replace('src/core', 'src/missing'));
    const check = await repo.run(['docs/GUIDE.md'], { show: ['docs/GUIDE.md'] });
    expect(check.exit).toBe(2);
    expect(check.stdout).toContain(
      'next: fix the docstamp block of each invalid file, then run: docstamp check docs/GUIDE.md\n',
    );
  },
);

scenario(
  '§12.2 a file declared inline and under files is E_DUPLICATE_DECLARATION and is not merged',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', config({ 'README.md': ['src/core'] }));
    const check = await repo.run([], { show: ['docstamp.yaml', 'README.md'] });
    expect(check.exit).toBe(2);
    expect(check.stdout).toBe(
      'INVALID  README.md\n' +
        'STALE    docs/GUIDE.md  (unrecorded)\n' +
        '  depends   src/core\n' +
        '0 ok, 1 stale, 1 invalid\n' +
        'next: review each stale file against its dependencies, then run: docstamp update docs/GUIDE.md\n' +
        'next: fix the configuration of each invalid file, then run: docstamp check README.md\n',
    );
    expect(check.stderr).toContain('error: E_DUPLICATE_DECLARATION: README.md: ');
    const before = repo.read('README.md');
    const all = await repo.run(['update', '--all'], { expectExit: 2 });
    expect(all.stdout).toContain('INVALID  README.md\n');
    expect(repo.read('README.md')).toBe(before);
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);
    const named = await repo.run(['update', 'docs/GUIDE.md'], { expectExit: 0 });
    expect(named.stdout).toBe('written  docs/GUIDE.md\n');
  },
);

scenario(
  '§9.6.2 a malformed block makes only its file invalid, with a diagnostic attached to it',
  { fixture },
  async (repo) => {
    const bad: Record<string, string> = {
      'flow.md': '---\ndocstamp: {dependencies: [src/core]}\n---\n',
      'scalar.md': '---\ndocstamp: yes\n---\n',
      'empty.md': '---\ndocstamp:\n---\n',
      'duplicate.md':
        '---\ndocstamp:\n  dependencies: [src/core]\ndocstamp:\n  dependencies: [src/cli]\n---\n',
      'anchor.md': '---\nbase: &b 1\ndocstamp:\n  dependencies: [src/core]\n  other: *b\n---\n',
      'no-deps.md': '---\ndocstamp:\n  hash: ' + '0'.repeat(64) + '\n---\n',
      'empty-deps.md': '---\ndocstamp:\n  dependencies: []\n---\n',
      'string-deps.md': '---\ndocstamp:\n  dependencies: src/core\n---\n',
      'unknown-key.md': '---\ndocstamp:\n  dependencies: [src/core]\n  covers: [src]\n---\n',
      'typo.md': '---\ndocstamp:\n  dependancies: [src/core]\n---\n',
      'bad-pattern.md': '---\ndocstamp:\n  dependencies: ["/src/core"]\n---\n',
      'no-match.md': '---\ndocstamp:\n  dependencies: [nothing/here]\n---\n',
      'short-hash.md': '---\ndocstamp:\n  dependencies: [src/core]\n  hash: abc\n---\n',
      'wrong-prefix.md': `---\ndocstamp:\n  dependencies: [src/core]\n  hash: v2:${'0'.repeat(64)}\n---\n`,
      'quoted-hash.md': `---\ndocstamp:\n  dependencies: [src/core]\n  hash: "${'0'.repeat(64)}"\n---\n`,
    };
    for (const [name, text] of Object.entries(bad)) repo.write(`bad/${name}`, text);
    const check = await repo.run([]);
    expect(check.exit).toBe(2);
    expect(check.stdout).toContain('STALE    README.md  (unrecorded)\n');
    expect(check.stdout).toContain('0 ok, 2 stale, 15 invalid\n');
    for (const name of Object.keys(bad)) expect(check.stdout).toContain(`INVALID  bad/${name}\n`);
    expect(check.stdout).not.toContain('NOTES.md');
    const codes = [...check.stderr.matchAll(/^error: (E_[A-Z_]+): bad\/([^:]+):/gmu)].map(
      (m) => `${m[2]}: ${m[1]}`,
    );
    expect(codes).toEqual([
      'anchor.md: E_BLOCK',
      'bad-pattern.md: E_PATTERN',
      'duplicate.md: E_BLOCK',
      'empty-deps.md: E_BLOCK',
      'empty.md: E_BLOCK',
      'flow.md: E_BLOCK',
      'no-deps.md: E_BLOCK',
      'no-match.md: E_EMPTY_DEPENDENCIES',
      'no-match.md: E_EMPTY_PATTERN',
      'quoted-hash.md: E_BLOCK',
      'scalar.md: E_BLOCK',
      'short-hash.md: E_BLOCK',
      'string-deps.md: E_BLOCK',
      'typo.md: E_UNKNOWN_KEY',
      'unknown-key.md: E_UNKNOWN_KEY',
      'wrong-prefix.md: E_BLOCK',
    ]);

    const refused = await repo.run(['update', '--all'], { expectExit: 2 });
    expect(refused.stdout).toContain('15 invalid');
    expect(repo.read('README.md')).toBe(repo.fixtureText('README.md'));
    const named = await repo.run(['update', 'README.md'], { expectExit: 0 });
    expect(named.stdout).toBe('written  README.md\n');
    const json = (await repo.run(['--json', 'bad/flow.md', 'bad/unknown-key.md'])).json();
    expect(json.files).toMatchObject([
      { file: 'bad/flow.md', state: 'invalid', dependencies: [] },
      { file: 'bad/unknown-key.md', state: 'invalid', dependencies: ['src/core'] },
    ]);
    expect(json.files[0].diagnostics[0]).toMatchObject({
      code: 'E_BLOCK',
      severity: 'error',
      file: 'bad/flow.md',
      subject: 'docstamp',
    });
  },
);

scenario(
  '§9.6.1 frontmatter without a docstamp key is never parsed, whatever YAML it uses',
  { fixture },
  async (repo) => {
    repo.write('docs/TABS.md', '---\n\tkey: [unclosed\nother: *missing\n---\nbody\n');
    repo.write('docs/QUOTED.md', '---\n"docstamp":\n  dependencies: [src]\n---\n');
    repo.write('docs/INDENTED.md', '---\nouter:\n  docstamp:\n    dependencies: [src]\n---\n');
    repo.write('docs/BODY.md', '---\ntitle: t\n---\ndocstamp:\n  dependencies: [src]\n');
    repo.write('docs/NOFRONT.md', 'docstamp:\n  dependencies: [src]\n');
    const list = await repo.run(['list-dependencies']);
    expect(list.exit).toBe(0);
    expect(list.stdout).toBe(
      'README.md\n  depends   src/cli\n  depends   docs/GUIDE.md\n' +
        '  resolved  docs/GUIDE.md\n  resolved  src/cli/run.ts\n' +
        'docs/GUIDE.md\n  depends   src/core\n  resolved  src/core/hash.ts\n',
    );
    expect(list.stderr).toBe('');
  },
);

scenario(
  '§9.3 include replaces the default patterns that search for inline blocks',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', 'version: 2\ninclude:\n  - docs/**\nfiles: {}\n');
    repo.write('docs/note.txt', '---\ndocstamp:\n  dependencies: [src/core]\n---\ntext\n');
    const result = await repo.run([], { show: ['docstamp.yaml'] });
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('STALE    docs/GUIDE.md  (unrecorded)\n');
    expect(result.stdout).toContain('STALE    docs/note.txt  (unrecorded)\n');
    expect(result.stdout).toContain('0 ok, 2 stale, 0 invalid\n');
    expect(result.stdout).not.toContain('README.md');

    repo.write('docstamp.yaml', 'version: 2\ninclude: ["**/*.md", "!docs"]\nfiles: {}\n');
    const negated = await repo.run([], { show: ['docstamp.yaml'] });
    expect(negated.stdout).toBe(
      'STALE    README.md  (unrecorded)\n  depends   src/cli\n  depends   docs/GUIDE.md\n' +
        '0 ok, 1 stale, 0 invalid\n' +
        'next: review each stale file against its dependencies, then run: docstamp update README.md\n',
    );
  },
);

scenario('§9.3 an invalid include is a configuration error', { fixture }, async (repo) => {
  repo.write('docstamp.yaml', 'version: 2\ninclude: []\nfiles: {}\n');
  const empty = await repo.run([], { show: ['docstamp.yaml'] });
  expect(empty.exit).toBe(2);
  expect(empty.stderr).toContain('error: E_CONFIG: include: ');
  repo.write('docstamp.yaml', 'version: 2\ninclude: ["/abs/*.md"]\nfiles: {}\n');
  const pattern = await repo.run([], { show: ['docstamp.yaml'] });
  expect(pattern.exit).toBe(2);
  expect(pattern.stderr).toContain('error: E_PATTERN: /abs/*.md: ');
});

scenario(
  '§13.7 and §13.8 list-dependencies and list-dependents see inline docs',
  { fixture },
  async (repo) => {
    const all = await repo.run(['list-dependencies']);
    expect(all.stdout).toContain('README.md\n');
    expect(all.stdout).toContain('docs/GUIDE.md\n');
    expect(all.stdout).not.toContain('NOTES.md');
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);
    const one = await repo.run(['list-dependencies', 'docs/GUIDE.md']);
    expect(one.stdout).toBe('docs/GUIDE.md\n  depends   src/core\n  resolved  src/core/hash.ts\n');

    const dependents = await repo.run([
      'list-dependents',
      'src/cli/run.ts',
      'docs/GUIDE.md',
      'src/index.ts',
    ]);
    expect(dependents.stdout).toBe(
      'docs/GUIDE.md\n  README.md   via docs/GUIDE.md\n' +
        'src/cli/run.ts\n  README.md   via src/cli\n' +
        'src/index.ts\n  (no dependents)\n',
    );
    const json = (await repo.run(['list-dependents', '--json', 'src/core/hash.ts'])).json();
    expect(json.files).toEqual([
      {
        file: 'src/core/hash.ts',
        dependents: [{ file: 'docs/GUIDE.md', via: ['src/core'] }],
        diagnostics: [],
      },
    ]);
    const list = (await repo.run(['list-dependencies', '--json'])).json();
    expect(list.files).toEqual([
      {
        file: 'README.md',
        dependencies: ['src/cli', 'docs/GUIDE.md'],
        resolvedFiles: ['docs/GUIDE.md', 'src/cli/run.ts'],
        diagnostics: [],
      },
      {
        file: 'docs/GUIDE.md',
        dependencies: ['src/core'],
        resolvedFiles: ['src/core/hash.ts'],
        diagnostics: [],
      },
    ]);
    repo.write('docs/BROKEN.md', '---\ndocstamp:\n  dependencies: [src/core]\n  extra: 1\n---\n');
    const skipped = await repo.run(['list-dependents', 'src/core/hash.ts']);
    expect(skipped.exit).toBe(2);
    expect(skipped.stdout).toBe('src/core/hash.ts\n  docs/GUIDE.md   via src/core\n');
    expect(skipped.stderr).toContain('error: E_UNKNOWN_KEY: docs/BROKEN.md: extra: ');
  },
);

scenario(
  '§9.6.4 a formatter that reflows the frontmatter makes the docs that depend on it stale',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    const reflowed = repo.read('docs/GUIDE.md').replace('    - src/core\n', '    - "src/core"\n');
    repo.write('docs/GUIDE.md', reflowed);
    const result = await repo.run([], { show: ['docs/GUIDE.md'] });
    expect(result.exit).toBe(1);
    expect(result.stdout.replace(/[0-9a-f]{40}/u, '<C>')).toBe(
      'STALE    README.md  (content-changed)\n' +
        '  modified  docs/GUIDE.md\n' +
        '  review: git diff -M <C> -- docs/GUIDE.md\n' +
        '1 ok, 1 stale, 0 invalid\n' +
        'next: review each stale file against its dependencies, then run: docstamp update README.md\n',
    );

    const quoted = reflowed.replace(/hash: ([0-9a-f]{64})/u, 'hash: "$1"');
    repo.write('docs/GUIDE.md', quoted);
    const invalid = await repo.run([], { show: ['docs/GUIDE.md'] });
    expect(invalid.exit).toBe(2);
    expect(invalid.stdout).toContain('INVALID  docs/GUIDE.md\n');
    expect(invalid.stderr).toContain('error: E_BLOCK: docs/GUIDE.md: hash: ');
  },
);

scenario(
  '§12.3 the changed-file report of an inline doc comes from the history of its hash line',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    repo.append('src/cli/run.ts', 'export const a = 1;\n');
    repo.commit('edit one');
    repo.git('commit', '--amend', '-q', '-m', 'reworded');
    repo.write('src/cli/added.ts', 'export const b = 2;\n');
    const result = await repo.run(['--json']);
    expect(result.json().files[0].changes).toEqual([
      { status: 'added', path: 'src/cli/added.ts', via: ['src/cli'] },
      { status: 'modified', path: 'src/cli/run.ts', via: ['src/cli'] },
    ]);
    const shallow = repo.shallowClone('clone');
    const text = await shallow.run([], { label: 'a shallow clone cannot tell' });
    expect(text.stdout).toContain('  depends   src/cli\n');
  },
);
