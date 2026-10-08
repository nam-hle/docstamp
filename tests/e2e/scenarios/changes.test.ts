import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { config, scenario, type Repo } from '../harness/index.ts';

// docstamp single-quotes a path with a backslash in the review line.
const gitPath = (path: string): string => (path.includes('\\') ? `'${path}'` : path);

const fixture = 'docs-site';
const CLAUDE = { 'CLAUDE.md': ['src/**', '!src/**/*.test.ts'] };

async function reviewedRepo(repo: Repo): Promise<string> {
  repo.write('docstamp.yaml', config(CLAUDE));
  repo.remove('README.md');
  repo.remove('docs/guide.md');
  repo.write('src/c.ts', 'c\n');
  repo.write('src/d.ts', 'd\n');
  repo.commit('initial');
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  return repo.commit('review');
}

function changeEverything(repo: Repo): void {
  repo.append('src/util.ts', 'more\n');
  repo.write('src/new.ts', 'n\n');
  repo.remove('src/c.ts');
  repo.commit('edits');
  repo.append('src/d.ts', 'more\n');
  repo.write('src/untracked.ts', 'u\n');
}

const expectedText = (base: string) =>
  'STALE    CLAUDE.md  (content-changed)\n' +
  '  changed   2 modified, 2 added, 1 deleted\n' +
  '  deleted   src/c.ts\n' +
  '  modified  src/d.ts\n' +
  '  added     src/new.ts\n' +
  '  added     src/untracked.ts\n' +
  '  modified  src/util.ts\n' +
  `  review: git diff ${base} -- src/c.ts src/d.ts src/new.ts src/untracked.ts src/util.ts\n` +
  '0 ok, 1 stale, 0 invalid\n';

scenario(
  '§12.3 ChangedSince lists modified, added and deleted files, committed or not',
  { fixture },
  async (repo) => {
    const base = await reviewedRepo(repo);
    const index = readFileSync(repo.path('.git/index'));
    changeEverything(repo);
    const indexBefore = readFileSync(repo.path('.git/index'));

    const text = await repo.run([]);
    expect(text.exit).toBe(1);
    expect(text.stdout.startsWith(expectedText(base))).toBe(true);
    expect(text.stdout).not.toContain('depends');
    expect(text.stderr).toBe('');

    const json = await repo.run(['--json']);
    expect(json.json().files[0].changes).toEqual([
      { status: 'deleted', path: 'src/c.ts', via: ['src/**'] },
      { status: 'modified', path: 'src/d.ts', via: ['src/**'] },
      { status: 'added', path: 'src/new.ts', via: ['src/**'] },
      { status: 'added', path: 'src/untracked.ts', via: ['src/**'] },
      { status: 'modified', path: 'src/util.ts', via: ['src/**'] },
    ]);
    expect('resolvedFiles' in json.json().files[0]).toBe(false);
    expect(readFileSync(repo.path('.git/index')).equals(indexBefore)).toBe(true);
    expect(index.length).toBeGreaterThan(0);
  },
);

scenario('§12.3 the review commit may be amended, rebased or merged', { fixture }, async (repo) => {
  await reviewedRepo(repo);
  const before = repo.git('rev-parse', 'HEAD');
  repo.git('commit', '--amend', '-q', '-m', 'review, reworded');
  expect(repo.git('rev-parse', 'HEAD')).not.toBe(before);
  repo.append('src/util.ts', 'one\n');
  const amended = await repo.run([], { label: 'after amending the review commit' });
  expect(amended.stdout).toContain('  modified  src/util.ts\n');
  repo.commit('edit one');

  repo.git('checkout', '-q', '-b', 'feature');
  repo.append('src/d.ts', 'feature\n');
  repo.commit('feature work');
  repo.git('checkout', '-q', 'main');
  repo.write('other.txt', 'unrelated\n');
  repo.commit('main moves on');
  repo.git('checkout', '-q', 'feature');
  repo.git('rebase', '-q', 'main');
  const rebased = await repo.run([], { label: 'on the rebased feature branch' });
  expect(rebased.stdout).toContain('  modified  src/d.ts\n  modified  src/util.ts\n');

  repo.git('checkout', '-q', 'main');
  repo.append('src/c.ts', 'main side\n');
  repo.commit('main side edit');
  repo.git('merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');
  const merged = await repo.run([], { label: 'after merging feature into main' });
  expect(merged.exit).toBe(1);
  expect(merged.stdout).toContain(
    'STALE    CLAUDE.md  (content-changed)\n  modified  src/c.ts\n  modified  src/d.ts\n  modified  src/util.ts\n',
  );
});

scenario(
  '§12.3 an edit squashed into the review commit is not reported',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    repo.append('src/util.ts', 'one\n');
    repo.commit('edit');
    repo.git('reset', '--soft', 'HEAD~2');
    repo.commit('squashed review and edit');
    repo.append('src/d.ts', 'two\n');
    const result = await repo.run([]);
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain(
      'STALE    CLAUDE.md  (content-changed)\n  modified  src/d.ts\n  review: git diff',
    );
    expect(result.stdout).not.toContain('src/util.ts');
  },
);

scenario('§12.3 Root below the top level of the work tree', { git: false }, async (repo) => {
  const top = repo.at('.');
  top.git('init', '-q');
  repo.write('docstamp.yaml', config({ 'CLAUDE.md': ['src/**'] }));
  repo.write('CLAUDE.md', '# doc\n');
  repo.write('src/a.ts', 'a\n');
  top.write('outside.txt', 'o\n');
  top.commit('initial');
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  top.commit('review');
  repo.append('src/a.ts', 'more\n');
  top.append('outside.txt', 'more\n');
  const result = await repo.run([]);
  expect(result.stdout).toContain(
    'STALE    CLAUDE.md  (content-changed)\n  modified  src/a.ts\n  review: git diff',
  );
  repo.write('src/a.ts', 'a\n');
  repo.rename('src/a.ts', 'src/b.ts');
  const renamed = await repo.run([], { label: 'a rename below the top level' });
  expect(renamed.stdout).toContain(
    'STALE    CLAUDE.md  (content-changed)\n  renamed   src/a.ts -> src/b.ts\n',
  );
});

scenario('§2 the verdict and the exit code do not depend on git', { fixture }, async (repo) => {
  await reviewedRepo(repo);
  repo.append('src/util.ts', 'more\n');
  const withGit = await repo.run(['--json']);
  repo.rename('.git', 'dot-git-away');
  const without = await repo.run(['--json'], { label: 'the same tree without .git' });
  expect(without.exit).toBe(withGit.exit);
  expect(without.json().files[0].changes).toBeNull();
  const strip = (doc: ReturnType<typeof withGit.json>) =>
    JSON.stringify({ ...doc, files: doc.files.map((f: object) => ({ ...f, changes: null })) });
  expect(strip(without.json())).toBe(strip(withGit.json()));
});

scenario(
  '§12.3 outside a git work tree the report falls back to depends lines',
  { fixture: 'no-git', git: false },
  async (repo) => {
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    repo.append('src/a.ts', 'more\n');
    const result = await repo.run([]);
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('  depends   src/**\n');
    expect(result.stderr).toBe('');
    expect((await repo.run(['--json'])).json().files[0].changes).toBeNull();
  },
);

scenario('§12.3 unknown when the written lock was never committed', { fixture }, async (repo) => {
  await reviewedRepo(repo);
  repo.git('reset', '--hard', '-q', 'HEAD~1');
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  repo.append('src/util.ts', 'more\n');
  const result = await repo.run([]);
  expect(result.stdout).toContain('  depends   src/**\n');
  expect((await repo.run(['--json'])).json().files[0].changes).toBeNull();
});

scenario('§5.4 Changes is null for ok and unrecorded files', { fixture }, async (repo) => {
  await reviewedRepo(repo);
  const ok = await repo.run(['--json']);
  expect(ok.json().files[0]).toMatchObject({ state: 'ok', changes: null });
  repo.write('docstamp.yaml', config({ ...CLAUDE, 'docs/new.md': ['src/**'] }));
  repo.write('docs/new.md', '# new\n');
  const unrecorded = await repo.run(['--json']);
  const entry = unrecorded.json().files.find((f: { file: string }) => f.file === 'docs/new.md');
  expect(entry).toMatchObject({ state: 'stale', reasons: ['unrecorded'], changes: null });
});

scenario(
  '§12.3 a sibling that removed the same Hash later is ignored',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', config({ ...CLAUDE, 'B.md': ['src/**'] }));
    repo.write('B.md', '# b\n');
    repo.remove('README.md');
    repo.remove('docs/guide.md');
    repo.commit('initial');
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.commit('review');
    repo.append('src/util.ts', 'x\n');
    repo.commit('x');
    repo.append('src/index.ts', 'y\n');
    await repo.run(['update', 'B.md'], { expectExit: 0 });
    repo.commit('review b');
    repo.write('src/z.ts', 'z\n');
    const doc = (await repo.run(['--json'])).json();
    const claude = doc.files.find((f: { file: string }) => f.file === 'CLAUDE.md');
    expect(claude.changes).toEqual([
      { status: 'modified', path: 'src/index.ts', via: ['src/**'] },
      { status: 'modified', path: 'src/util.ts', via: ['src/**'] },
      { status: 'added', path: 'src/z.ts', via: ['src/**'] },
    ]);
  },
);

scenario('§12.3 a shallow clone cannot tell what changed', { fixture: 'shallow' }, async (repo) => {
  repo.write('src/b.ts', 'b\n');
  repo.commit('initial');
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.commit('review');
  repo.append('src/a.ts', 'more\n');
  repo.commit('edit');
  const clone = repo.shallowClone('clone');
  expect(clone.git('rev-parse', '--is-shallow-repository').trim()).toBe('true');
  const committed = await clone.run([], { label: 'shallow clone at the edit commit' });
  expect(committed.exit).toBe(1);
  expect(committed.stdout).toContain('  depends   src/**\n');
  clone.append('src/a.ts', 'dirty\n');
  const result = await clone.run([], { label: 'shallow clone with a dirty tree' });
  expect(result.exit).toBe(1);
  expect(result.stdout).toContain('  depends   src/**\n');
  expect((await clone.run(['--json'])).json().files[0].changes).toBeNull();
});

scenario('§12.3 an inherited GIT_DIR selects no repository', { fixture }, async (repo) => {
  await reviewedRepo(repo);
  const foreign = repo.at('foreign');
  foreign.mkdir('');
  foreign.git('init', '-q');
  foreign.write('x.txt', 'x\n');
  foreign.commit('foreign');
  repo.append('src/util.ts', 'more\n');
  const result = await repo.run(['--json'], { env: { GIT_DIR: foreign.path('.git') } });
  expect(result.json().files[0].changes).toEqual([
    { status: 'modified', path: 'src/util.ts', via: ['src/**'] },
  ]);
});

scenario(
  '§12.3 a version 1 or 2 lock in history reads as absent, never an error',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    const v3 = repo.read('docstamp-lock.yaml');
    const hash = /[0-9a-f]{64}/u.exec(v3)![0];
    repo.write('docstamp-lock.yaml', `version: 2\ndependents:\n  "CLAUDE.md": ${hash}\n`);
    repo.commit('lock as version 2');
    repo.write('docstamp-lock.yaml', v3);
    repo.commit('lock as version 3 again');
    repo.append('src/util.ts', 'more\n');
    const result = await repo.run([]);
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('  modified  src/util.ts\n');
    expect(result.stderr).toBe('');
  },
);

scenario(
  '§12.3 only a legacy docsync.lock holding the Hash yields unknown, not an error',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', config(CLAUDE));
    repo.remove('README.md');
    repo.remove('docs/guide.md');
    repo.commit('initial');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    const hash = /[0-9a-f]{64}/u.exec(repo.read('docstamp-lock.yaml'))![0];
    repo.remove('docstamp-lock.yaml');
    repo.write('docsync.lock', `version: 1\ndependents:\n  CLAUDE.md:\n    hash: ${hash}\n`);
    repo.commit('legacy');
    repo.remove('docsync.lock');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    repo.append('src/util.ts', 'more\n');
    const result = await repo.run([]);
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('  depends   src/**\n');
    expect(result.stderr).toBe('');
  },
);

scenario('§14.2 a changed path with a space is quoted', { fixture }, async (repo) => {
  repo.write('src/my file.ts', 'm\n');
  await reviewedRepo(repo);
  repo.append('src/my file.ts', 'more\n');
  const result = await repo.run([]);
  expect(result.stdout).toContain('  modified  "src/my file.ts"\n');
});

scenario(
  '§12.3 an edit that is reverted leaves no report and no stale file',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    repo.append('src/util.ts', 'more\n');
    repo.commit('edit');
    expect((await repo.run([], { label: 'edited' })).exit).toBe(1);
    repo.git('revert', '--no-edit', 'HEAD');
    const reverted = await repo.run([], { label: 'edit reverted' });
    expect(reverted).toMatchObject({ exit: 0, stdout: '1 ok, 0 stale, 0 invalid\n', stderr: '' });
  },
);

scenario(
  '§12.3 step 6 and 7: via names the patterns, whitespaceOnly flags a change of white space',
  { fixture },
  async (repo) => {
    repo.write(
      'docstamp.yaml',
      config({ ...CLAUDE, 'NOTES.md': ['src', 'src/d.ts', '!src/c.ts'] }),
    );
    repo.write('NOTES.md', '# notes\n');
    repo.remove('README.md');
    repo.remove('docs/guide.md');
    repo.write('src/c.ts', 'c\n');
    repo.write('src/d.ts', 'd\n');
    repo.write('src/e.ts', 'let e = 1;\nlet f = 2;\n');
    repo.write('src/crlf.txt', 'one\ntwo\n');
    repo.commit('initial');
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.commit('review');

    repo.write('src/e.ts', '  let e = 1;   \n\n\n\tlet f = 2;\n');
    repo.write('src/crlf.txt', 'one\r\ntwo\r\n');
    repo.append('src/d.ts', 'more\n');
    repo.write('src/c.ts', 'c\n\n');
    const text = await repo.run([]);
    expect(text.exit).toBe(1);
    expect(text.stdout).toContain(
      'STALE    CLAUDE.md  (content-changed)\n' +
        '  changed   5 modified\n' +
        '  modified  src/c.ts (whitespace only)\n' +
        '  modified  src/crlf.txt (whitespace only)\n' +
        '  modified  src/d.ts\n' +
        '  modified  src/e.ts (whitespace only)\n' +
        '  review: ',
    );
    expect(text.stdout).toContain(
      'STALE    NOTES.md  (content-changed)\n' +
        '  modified  src/crlf.txt (whitespace only)\n' +
        '  modified  src/d.ts\n' +
        '  modified  src/e.ts (whitespace only)\n' +
        '  review: ',
    );
    expect(text.stdout).not.toContain('via');

    const doc = (await repo.run(['--json'])).json();
    const byFile = (file: string) => doc.files.find((f: { file: string }) => f.file === file);
    expect(byFile('CLAUDE.md').changes).toEqual([
      { status: 'modified', path: 'src/c.ts', via: ['src/**'], whitespaceOnly: true },
      { status: 'modified', path: 'src/crlf.txt', via: ['src/**'], whitespaceOnly: true },
      { status: 'modified', path: 'src/d.ts', via: ['src/**'] },
      { status: 'modified', path: 'src/e.ts', via: ['src/**'], whitespaceOnly: true },
    ]);
    expect(byFile('NOTES.md').changes).toEqual([
      { status: 'modified', path: 'src/crlf.txt', via: ['src'], whitespaceOnly: true },
      { status: 'modified', path: 'src/d.ts', via: ['src', 'src/d.ts'] },
      { status: 'modified', path: 'src/e.ts', via: ['src'], whitespaceOnly: true },
    ]);
  },
);

scenario(
  '§12.3 step 7: a change of file mode is never whitespace only',
  // No POSIX mode bits on Windows.
  { fixture, skipIf: process.platform === 'win32' },
  async (repo) => {
    repo.write('docstamp.yaml', config(CLAUDE));
    repo.remove('README.md');
    repo.remove('docs/guide.md');
    repo.write('src/d.ts', 'd\n');
    repo.write('src/mode.sh', 'echo\n');
    repo.commit('initial');
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.commit('review');

    // The Dependency Hash reads content, not mode (§10.2): an edit makes the file stale.
    repo.append('src/d.ts', 'more\n');
    repo.chmod('src/mode.sh', 0o755);
    const text = await repo.run([]);
    expect(text.exit).toBe(1);
    expect(text.stdout).toContain(
      'STALE    CLAUDE.md  (content-changed)\n' +
        '  modified  src/d.ts\n' +
        '  modified  src/mode.sh\n',
    );
    expect(text.stdout).not.toContain('whitespace only');

    const doc = (await repo.run(['--json'])).json();
    expect(doc.files[0].changes).toEqual([
      { status: 'modified', path: 'src/d.ts', via: ['src/**'] },
      { status: 'modified', path: 'src/mode.sh', via: ['src/**'] },
    ]);
  },
);

scenario(
  '§14.3.4 the review line is a git command that shows what the report lists',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    const base = repo.git('rev-parse', 'HEAD').trim();
    repo.append('src/util.ts', 'committed\n');
    repo.commit('edit');
    repo.append('src/d.ts', 'not committed\n');
    repo.write('src/my file.ts', 'spaced\n');
    repo.write('src/[id].ts', 'bracket\n');

    const result = await repo.run([]);
    expect(result.stdout).toContain(
      `  review: git diff ${base} -- ':(literal)src/[id].ts' src/d.ts 'src/my file.ts' src/util.ts\n`,
    );
    const shown = repo.git('diff', '--name-only', base, '--', 'src/d.ts', 'src/util.ts');
    expect(shown).toBe('src/d.ts\nsrc/util.ts\n');

    const rooted = await repo.run(['--root', repo.root]);
    expect(rooted.stdout).toContain(`  review: git -C ${gitPath(repo.root)} diff ${base} -- `);
  },
);

scenario(
  '§14.3.4 above 10 changed files the review line is a pathspec of the patterns',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    const base = repo.git('rev-parse', 'HEAD').trim();
    for (let i = 0; i < 11; i++) repo.write(`src/gen/g${String(i).padStart(2, '0')}.ts`, `${i}\n`);
    repo.append('src/util.test.ts', 'excluded by the negation\n');
    repo.append('src/util.ts', 'changed\n');
    const result = await repo.run([]);
    expect(result.stdout).toContain('  added     src/gen/  (11 files)\n');
    expect(result.stdout).toContain(
      `  review: git diff ${base} -- ':(glob)src/**' ':(exclude,glob)src/**/*.test.ts' ` +
        "':(exclude,glob)src/**/*.test.ts/**'\n",
    );
    const listed = repo.git(
      'diff',
      '--name-only',
      base,
      '--',
      ':(glob)src/**',
      ':(exclude,glob)src/**/*.test.ts',
    );
    expect(listed).toBe('src/util.ts\n');

    repo.write('docstamp.yaml', config({ 'CLAUDE.md': ['src/**/*.{ts,js}'] }));
    const braces = await repo.run([], { label: 'alternation in a pattern' });
    expect(braces.stdout).toContain('  added     src/gen/  (11 files)\n');
    expect(braces.stdout).not.toContain('review:');
  },
);

scenario(
  '§12.3 step 1.4 an edited own list is reported, and the Reason stays content-changed',
  { fixture },
  async (repo) => {
    const base = await reviewedRepo(repo);
    repo.write(
      'docstamp.yaml',
      config({ 'CLAUDE.md': ['src/**', '!src/**/*.test.ts', '!src/c.ts'] }),
    );
    const removed = await repo.run([], { label: 'a pattern narrowed', show: ['docstamp.yaml'] });
    expect(removed.exit).toBe(1);
    expect(removed.stdout).toContain(
      'STALE    CLAUDE.md  (content-changed)\n' +
        '  edited    docstamp.yaml  (dependency list)\n' +
        `  review: git diff ${base} -- docstamp.yaml\n`,
    );
    const json = (await repo.run(['--json'])).json().files[0];
    expect(json).toMatchObject({
      reasons: ['content-changed'],
      changes: [],
      dependenciesEdited: true,
    });

    repo.append('src/util.ts', 'more\n');
    const both = await repo.run([], { label: 'and a dependency changed' });
    expect(both.stdout).toContain(
      '  edited    docstamp.yaml  (dependency list)\n' +
        '  modified  src/util.ts\n' +
        `  review: git diff ${base} -- src/util.ts docstamp.yaml\n`,
    );

    repo.write('docstamp.yaml', config(CLAUDE));
    const restored = await repo.run(['--json'], { label: 'own list restored' });
    expect(restored.json().files[0]).not.toHaveProperty('dependenciesEdited');
  },
);

scenario('§12.3 step 1.4 an inline file whose block lost a pattern', async (repo) => {
  const block = (deps: string[]) =>
    `---\ndocstamp:\n  dependencies:\n${deps.map((d) => `    - ${d}\n`).join('')}---\n# Guide\n`;
  repo.write('src/a.ts', 'a\n');
  repo.write('src/b.ts', 'b\n');
  repo.write('guide.md', block(['src/a.ts', 'src/b.ts']));
  repo.commit('initial');
  await repo.run(['update', 'guide.md'], { expectExit: 0 });
  const base = repo.commit('review');
  repo.write('guide.md', repo.read('guide.md').replace('    - src/b.ts\n', ''));
  const result = await repo.run([]);
  expect(result.exit).toBe(1);
  expect(result.stdout).toContain(
    'STALE    guide.md  (content-changed)\n' +
      '  edited    guide.md  (dependency list)\n' +
      `  review: git diff ${base} -- guide.md\n`,
  );
});
