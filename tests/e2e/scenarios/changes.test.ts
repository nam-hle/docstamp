import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { config, scenario, type Repo } from '../harness/index.ts';

const fixture = 'docs-site';
const CLAUDE = { 'CLAUDE.md': ['src/**', '!src/**/*.test.ts'] };

async function reviewedRepo(repo: Repo): Promise<void> {
  repo.write('docstamp.yaml', config(CLAUDE));
  repo.remove('README.md');
  repo.remove('docs/guide.md');
  repo.write('src/c.ts', 'c\n');
  repo.write('src/d.ts', 'd\n');
  repo.commit('initial');
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  repo.commit('review');
}

function changeEverything(repo: Repo): void {
  repo.append('src/util.ts', 'more\n');
  repo.write('src/new.ts', 'n\n');
  repo.remove('src/c.ts');
  repo.commit('edits');
  repo.append('src/d.ts', 'more\n');
  repo.write('src/untracked.ts', 'u\n');
}

const EXPECTED_TEXT =
  'STALE    CLAUDE.md  (content-changed)\n' +
  '  deleted   src/c.ts\n' +
  '  modified  src/d.ts\n' +
  '  added     src/new.ts\n' +
  '  added     src/untracked.ts\n' +
  '  modified  src/util.ts\n' +
  '0 ok, 1 stale, 0 invalid\n';

scenario(
  '§12.3 ChangedSince lists modified, added and deleted files, committed or not',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    const index = readFileSync(repo.path('.git/index'));
    changeEverything(repo);
    const indexBefore = readFileSync(repo.path('.git/index'));

    const text = await repo.run([]);
    expect(text.exit).toBe(1);
    expect(text.stdout.startsWith(EXPECTED_TEXT)).toBe(true);
    expect(text.stdout).not.toContain('depends');
    expect(text.stderr).toBe('');

    const json = await repo.run(['--json']);
    expect(json.json().files[0].changes).toEqual([
      { status: 'deleted', path: 'src/c.ts' },
      { status: 'modified', path: 'src/d.ts' },
      { status: 'added', path: 'src/new.ts' },
      { status: 'added', path: 'src/untracked.ts' },
      { status: 'modified', path: 'src/util.ts' },
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
      'STALE    CLAUDE.md  (content-changed)\n  modified  src/d.ts\n0 ok',
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
    'STALE    CLAUDE.md  (content-changed)\n  modified  src/a.ts\n0 ok',
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
      { status: 'modified', path: 'src/index.ts' },
      { status: 'modified', path: 'src/util.ts' },
      { status: 'added', path: 'src/z.ts' },
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
  expect(result.json().files[0].changes).toEqual([{ status: 'modified', path: 'src/util.ts' }]);
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
