import { expect } from 'vitest';
import { config, scenario, type Repo } from '../harness/index.ts';

const DOCS = {
  'NARROW.md': ['src/a.ts'],
  'MID.md': ['src/a.ts', 'src/b.ts'],
  'BROAD.md': ['src'],
};
// base, then six commits: two on day 2, one on day 3, 4 and two on day 5; two touch no file
function timeline(repo: Repo): string {
  repo.write('docstamp.yaml', config(DOCS));
  for (const doc of Object.keys(DOCS)) repo.write(doc, 'doc\n');
  for (const name of ['a', 'b', 'c']) repo.write(`src/${name}.ts`, `${name}\n`);
  repo.write('README.md', 'readme\n');
  const base = repo.commit('base', '2026-01-01T09:00:00Z');
  repo.append('src/a.ts', 'one\n');
  repo.commit('edit a', '2026-01-02T08:00:00Z');
  repo.append('src/b.ts', 'one\n');
  repo.commit('edit b', '2026-01-02T23:59:59Z');
  repo.append('README.md', 'one\n');
  repo.commit('edit readme', '2026-01-03T00:00:00Z');
  repo.append('src/a.ts', 'two\n');
  repo.write('src/gen.ts', 'g\n');
  repo.commit('edit a and add gen', '2026-01-04T12:00:00Z');
  repo.append('src/c.ts', 'one\n');
  repo.commit('edit c', '2026-01-05T08:00:00Z');
  repo.commit('empty', '2026-01-05T09:00:00Z');
  return base;
}

const doc = (result: { json: () => any }) => result.json();
const ago = (days: number, hours = 0) =>
  new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();

scenario('§12.4 a shallow clone is E_HISTORY', async (repo) => {
  const base = timeline(repo);
  const clone = repo.shallowClone('clone');
  expect(clone.git('rev-parse', '--is-shallow-repository').trim()).toBe('true');
  const text = await clone.run(['stats', '--from', base]);
  expect(text.exit).toBe(2);
  expect(text.stdout).toBe('');
  expect(text.stderr).toContain('error: E_HISTORY: The repository is shallow');
  const json = await clone.run(['stats', '--json']);
  expect(json.exit).toBe(2);
  expect(doc(json)).toMatchObject({
    window: null,
    diagnostics: [{ code: 'E_HISTORY', subject: null }],
  });
  const verdict = await clone.run(['check'], { snapshot: false });
  expect(verdict.exit).toBe(1);
});

scenario(
  '§12.4 no git, no work tree and no commit are E_HISTORY',
  { fixture: 'no-git', git: false },
  async (repo) => {
    const none = await repo.run(['stats'], { label: 'not a git work tree' });
    expect(none.exit).toBe(2);
    expect(none.stdout).toBe('');
    expect(none.stderr).toContain('error: E_HISTORY: Run docstamp stats with git installed');

    repo.git('init', '-q');
    const unborn = await repo.run(['stats'], { label: 'a work tree with no commit' });
    expect(unborn.exit).toBe(2);
    expect(unborn.stderr).toContain('E_HISTORY');

    repo.commit('base', ago(1));
    const fine = await repo.run(['stats', '--since', '7d'], { snapshot: false });
    expect(fine.exit).toBe(0);
    expect(fine.stdout).toContain('window: 1 commits in the last 7 days, 0 make no file stale\n');
    const hidden = await repo.run(['stats'], {
      label: 'git is not on the PATH',
      env: { PATH: '/nonexistent' },
    });
    expect(hidden.exit).toBe(2);
    expect(hidden.stderr).toContain('E_HISTORY');
  },
);

scenario('§12.4 an inherited GIT_DIR selects no repository', async (repo) => {
  const base = timeline(repo);
  const foreign = repo.at('foreign');
  foreign.mkdir('');
  foreign.git('init', '-q');
  foreign.write('x.txt', 'x\n');
  foreign.commit('foreign');
  const result = await repo.run(['stats', '--json', '--from', base], {
    env: { GIT_DIR: foreign.path('.git'), GIT_WORK_TREE: foreign.root },
  });
  expect(doc(result).window).toMatchObject({ commits: 6, untouched: 2 });
});

scenario(
  '§12.4 Root below the top level counts every commit of the work tree',
  { git: false },
  async (repo) => {
    const top = repo.at('.');
    top.git('init', '-q');
    repo.write('other.txt', 'outside\n');
    repo.write('pkg/docstamp.yaml', config({ 'pkg/DOC.md': ['pkg/src'] }).replace(/pkg\//gu, ''));
    repo.write('pkg/DOC.md', 'doc\n');
    repo.write('pkg/src/a.ts', 'a\n');
    const base = repo.commit('base', '2026-01-01T09:00:00Z');
    repo.append('other.txt', 'one\n');
    repo.commit('outside', '2026-01-02T09:00:00Z');
    repo.append('pkg/src/a.ts', 'one\n');
    repo.commit('inside', '2026-01-03T09:00:00Z');
    const result = await repo.run(['stats', '--from', base], { cwd: 'pkg' });
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain('DOC.md');
    expect(result.stdout).toContain(`window: 2 commits in ${base}..HEAD, 1 make no file stale\n`);
  },
);
