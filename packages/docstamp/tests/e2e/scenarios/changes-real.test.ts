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
      `  review: git diff -M ${base} -- ':(literal)src/[id].ts' src/d.ts 'src/my file.ts' src/util.ts\n`,
    );
    const shown = repo.git('diff', '--name-only', base, '--', 'src/d.ts', 'src/util.ts');
    expect(shown).toBe('src/d.ts\nsrc/util.ts\n');

    const rooted = await repo.run(['--root', repo.root]);
    expect(rooted.stdout).toContain(`  review: git -C ${gitPath(repo.root)} diff -M ${base} -- `);
  },
);

scenario(
  '§14.3.4 a plain mv: the review line uses -M and names the untracked path to add',
  { fixture: 'renames' },
  async (repo) => {
    repo.commit('initial');
    await repo.run(['update', '--all'], { expectExit: 0 });
    const base = repo.commit('review');
    repo.rename('src/lib/old-name.ts', 'src/lib/new-name.ts');
    const text = await repo.run(['README.md']);
    expect(text.exit).toBe(1);
    expect(text.stdout).toContain(
      '  renamed   src/lib/old-name.ts -> src/lib/new-name.ts\n' +
        `  review: git diff -M ${base} -- src/lib/new-name.ts src/lib/old-name.ts\n` +
        '  untracked: git add -N -- src/lib/new-name.ts\n',
    );
    const shown = (): string =>
      repo.git(
        '-c',
        'core.autocrlf=false',
        'diff',
        '-M',
        '--name-status',
        base,
        '--',
        'src/lib/new-name.ts',
        'src/lib/old-name.ts',
      );
    expect(shown()).toBe('D\tsrc/lib/old-name.ts\n');
    repo.git('add', '-N', '--', 'src/lib/new-name.ts');
    expect(shown()).toMatch(/^R\d+\tsrc\/lib\/old-name\.ts\tsrc\/lib\/new-name\.ts\n$/u);
    const added = await repo.run(['README.md'], { label: 'after git add -N' });
    expect(added.stdout).toContain(
      `  review: git diff -M ${base} -- src/lib/new-name.ts src/lib/old-name.ts\n0 ok`,
    );
  },
);
