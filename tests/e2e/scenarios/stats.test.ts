import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { config, scenario, type Repo } from '../harness/index.ts';

const DOCS = {
  'NARROW.md': ['src/a.ts'],
  'MID.md': ['src/a.ts', 'src/b.ts'],
  'BROAD.md': ['src'],
};
const HEADER = 'file       patterns  files  commits  days   stale   sweep\n';

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

scenario(
  '§13.9 stats ranks narrow and broad lists, counts days, and only reports',
  async (repo) => {
    const base = timeline(repo);
    const index = readFileSync(repo.path('.git/index'));
    const text = await repo.run(['stats', '--from', base]);
    expect(text.exit).toBe(0);
    expect(text.stdout).toBe(
      HEADER +
        'BROAD.md          1      4        4     3  0.6667  0.0000\n' +
        'MID.md            2      2        3     2  0.5000  0.0000\n' +
        'NARROW.md         1      1        2     2  0.3333  0.0000\n' +
        `window: 6 commits in ${base}..HEAD, 2 make no file stale\n`,
    );
    expect(text.stderr).toBe('');

    const json = await repo.run(['stats', '--json', '--from', base]);
    expect(doc(json)).toEqual({
      version: 2,
      mode: 'stats',
      exitCode: 0,
      window: { kind: 'revision', value: base, commits: 6, untouched: 2 },
      files: [
        {
          file: 'BROAD.md',
          patterns: 1,
          resolvedCount: 4,
          staleCommits: 4,
          days: 3,
          staleRate: 0.6667,
          sweepCommits: 0,
          sweepShare: 0,
          diagnostics: [],
        },
        {
          file: 'MID.md',
          patterns: 2,
          resolvedCount: 2,
          staleCommits: 3,
          days: 2,
          staleRate: 0.5,
          sweepCommits: 0,
          sweepShare: 0,
          diagnostics: [],
        },
        {
          file: 'NARROW.md',
          patterns: 1,
          resolvedCount: 1,
          staleCommits: 2,
          days: 2,
          staleRate: 0.3333,
          sweepCommits: 0,
          sweepShare: 0,
          diagnostics: [],
        },
      ],
      diagnostics: [],
    });

    expect(readFileSync(repo.path('.git/index')).equals(index)).toBe(true);
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);
  },
);

scenario('§12.5 a sweep is a stale commit that touches more than 200 files', async (repo) => {
  repo.write('docstamp.yaml', config({ 'NARROW.md': ['src/a.ts'], 'BROAD.md': ['src'] }));
  repo.write('NARROW.md', 'doc\n');
  repo.write('BROAD.md', 'doc\n');
  repo.write('src/a.ts', 'a\n');
  const base = repo.commit('base', '2026-01-01T09:00:00Z');
  repo.append('src/a.ts', 'one\n');
  repo.commit('small', '2026-01-02T09:00:00Z');
  repo.append('src/a.ts', 'two\n');
  for (let i = 0; i < 199; i++) repo.write(`src/gen/f${i}.ts`, `${i}\n`);
  repo.commit('exactly 200 files', '2026-01-03T09:00:00Z');
  repo.append('src/a.ts', 'three\n');
  for (let i = 0; i < 200; i++) repo.write(`src/gen/g${i}.ts`, `${i}\n`);
  repo.commit('201 files', '2026-01-04T09:00:00Z');
  const result = await repo.run(['stats', '--from', base]);
  expect(result.exit).toBe(0);
  expect(result.stdout).toBe(
    HEADER +
      'BROAD.md          1    400        3     3  1.0000  0.3333\n' +
      'NARROW.md         1      1        3     3  1.0000  0.3333\n' +
      `window: 3 commits in ${base}..HEAD, 0 make no file stale\n`,
  );
  const json = await repo.run(['stats', '--json', '--from', base], { snapshot: false });
  expect(doc(json).files[1]).toMatchObject({ sweepCommits: 1, sweepShare: 0.3333 });
});

scenario('§12.4 --since <n>d is the last n days by committer time, from now', async (repo) => {
  repo.write('docstamp.yaml', config({ 'A.md': ['src/a.ts'], 'B.md': ['src'] }));
  repo.write('A.md', 'doc\n');
  repo.write('B.md', 'doc\n');
  repo.write('src/a.ts', 'a\n');
  repo.write('src/b.ts', 'b\n');
  repo.commit('old', ago(400));
  repo.append('src/b.ts', 'one\n');
  repo.commit('edit b 20 days ago', ago(20));
  repo.append('src/a.ts', 'one\n');
  repo.commit('edit a 10 days ago', ago(10));
  repo.commit('empty 2 days ago', ago(2));
  repo.append('src/a.ts', 'two\n');
  repo.commit('edit a an hour ago', ago(0, 1));

  const month = await repo.run(['stats', '--since', '30d']);
  expect(month.exit).toBe(0);
  expect(month.stdout).toBe(
    'file  patterns  files  commits  days   stale   sweep\n' +
      'B.md         1      2        3     3  0.7500  0.0000\n' +
      'A.md         1      1        2     2  0.5000  0.0000\n' +
      'window: 4 commits in the last 30 days, 1 make no file stale\n',
  );
  const implicit = await repo.run(['stats'], { label: 'the default is 30d' });
  expect(implicit.stdout).toBe(month.stdout);
  const fortnight = await repo.run(['stats', '--since=15d', '--json']);
  expect(doc(fortnight).window).toEqual({ kind: 'days', value: '15d', commits: 3, untouched: 1 });
  expect(doc(fortnight).files.map((f: { staleCommits: number }) => f.staleCommits)).toEqual([2, 2]);
  const day = await repo.run(['stats', '--since', '1d']);
  expect(day.stdout).toContain('window: 1 commits in the last 1 days, 0 make no file stale\n');
  const year = await repo.run(['stats', '--since', '3650d']);
  expect(year.stdout).toContain('window: 5 commits in the last 3650 days, 1 make no file stale\n');
});

scenario('§12.4 --from <rev> is the commits of <rev>..HEAD, and names a commit', async (repo) => {
  const base = timeline(repo);
  const head = repo.git('rev-parse', 'HEAD').trim();

  const relative = await repo.run(['stats', '--from', 'HEAD~2']);
  expect(relative.stdout).toContain('window: 2 commits in HEAD~2..HEAD, 1 make no file stale\n');
  repo.git('tag', 'v0.1', base);
  const tagged = await repo.run(['stats', '--from', 'v0.1', '--json']);
  expect(doc(tagged).window).toEqual({ kind: 'revision', value: 'v0.1', commits: 6, untouched: 2 });
  const branch = await repo.run(['stats', '--from=main']);
  expect(branch.stdout).toContain('window: 0 commits in main..HEAD, 0 make no file stale\n');
  const empty = await repo.run(['stats', '--from', head]);
  expect(empty.exit).toBe(0);
  expect(empty.stdout).toContain('NARROW.md         1      1        0     0  0.0000  0.0000\n');

  const missing = await repo.run(['stats', '--from', 'no-such-rev']);
  expect(missing.exit).toBe(2);
  expect(missing.stdout).toBe('');
  expect(missing.stderr).toContain('error: E_HISTORY: no-such-rev: --from names no commit');
  const tree = await repo.run(['stats', '--from', 'HEAD^{tree}']);
  expect(tree.exit).toBe(2);
  expect(tree.stderr).toContain('E_HISTORY');
  const json = await repo.run(['stats', '--json', '--from', 'no-such-rev']);
  expect(doc(json)).toMatchObject({
    exitCode: 2,
    window: null,
    files: [],
    diagnostics: [{ code: 'E_HISTORY', severity: 'error', file: null, subject: 'no-such-rev' }],
  });
});

scenario(
  '§13.2 --since and --from are refused together, and bad values are E_USAGE',
  async (repo) => {
    timeline(repo);
    const both = await repo.run(['stats', '--since', '7d', '--from', 'HEAD~1']);
    expect(both.exit).toBe(2);
    expect(both.stdout).toBe('');
    expect(both.stderr).toContain('E_USAGE: --since:');
    expect(both.stderr).toContain('--from');
    for (const value of ['30', '30.days', '2 weeks ago', '2026-01-01', '0d', '3651d']) {
      const result = await repo.run(['stats', '--since', value], { label: `bad since ${value}` });
      expect(result.exit, value).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('error: E_USAGE:');
      expect(result.stderr).toContain('like 30d');
    }
  },
);

scenario(
  '§13.9 named files are measured against the commits that make none stale',
  async (repo) => {
    const base = timeline(repo);
    const named = await repo.run(['stats', '--from', base, 'NARROW.md', './MID.md']);
    expect(named.exit).toBe(0);
    expect(named.stdout).toBe(
      HEADER +
        'MID.md            2      2        3     2  0.5000  0.0000\n' +
        'NARROW.md         1      1        2     2  0.3333  0.0000\n' +
        `window: 6 commits in ${base}..HEAD, 3 make no file stale\n`,
    );
    const unknown = await repo.run(['stats', '--from', base, 'nope.md', 'NARROW.md']);
    expect(unknown.exit).toBe(2);
    expect(unknown.stdout).toBe('');
    expect(unknown.stderr).toContain('E_UNKNOWN_FILE: nope.md');
    const json = await repo.run(['stats', '--json', '--from', base, 'nope.md']);
    expect(doc(json)).toMatchObject({ exitCode: 2, window: null, files: [] });
  },
);

scenario(
  '§12.4 a rename is a deletion and an addition, and the deleted path is unseen',
  async (repo) => {
    repo.write(
      'docstamp.yaml',
      config({ 'FROM.md': ['src/from'], 'TO.md': ['src/to'], 'ELSE.md': ['src/else'] }),
    );
    for (const doc of ['FROM.md', 'TO.md', 'ELSE.md']) repo.write(doc, 'doc\n');
    repo.write('src/from/moved.ts', 'a long enough body to be detected as a rename\n'.repeat(5));
    repo.write('src/from/stays.ts', 'stays\n');
    repo.write('src/to/there.ts', 'there\n');
    repo.write('src/else/e.ts', 'e\n');
    const base = repo.commit('base', '2026-01-01T09:00:00Z');
    repo.rename('src/from/moved.ts', 'src/to/moved.ts');
    repo.commit('move', '2026-01-02T09:00:00Z');
    const result = await repo.run(['stats', '--from', base]);
    expect(result.exit).toBe(0);
    expect(result.stdout).toBe(
      'file     patterns  files  commits  days   stale   sweep\n' +
        'TO.md           1      2        1     1  1.0000  0.0000\n' +
        'ELSE.md         1      1        0     0  0.0000  0.0000\n' +
        'FROM.md         1      1        0     0  0.0000  0.0000\n' +
        `window: 1 commits in ${base}..HEAD, 0 make no file stale\n`,
    );
  },
);

scenario('§13.9 inline and configured docs are measured together', async (repo) => {
  repo.write('docstamp.yaml', config({ 'docs/big list.md': ['src'] }));
  repo.write('docs/big list.md', 'doc\n');
  repo.write(
    'README.md',
    '---\ntitle: README\ndocstamp:\n  dependencies: [src/a.ts]\n---\n\n# Readme\n',
  );
  repo.write('src/a.ts', 'a\n');
  repo.write('src/b.ts', 'b\n');
  const base = repo.commit('base', '2026-01-01T09:00:00Z');
  repo.append('src/b.ts', 'one\n');
  repo.commit('edit b', '2026-01-02T09:00:00Z');
  repo.append('src/a.ts', 'one\n');
  repo.commit('edit a', '2026-01-03T09:00:00Z');
  const result = await repo.run(['stats', '--from', base]);
  expect(result.exit).toBe(0);
  expect(result.stdout).toBe(
    'file                patterns  files  commits  days   stale   sweep\n' +
      '"docs/big list.md"         1      2        2     2  1.0000  0.0000\n' +
      'README.md                  1      1        1     1  0.5000  0.0000\n' +
      `window: 2 commits in ${base}..HEAD, 0 make no file stale\n`,
  );
  const json = await repo.run(['stats', '--json', '--from', base]);
  expect(doc(json).files.map((f: { file: string }) => f.file)).toEqual([
    'docs/big list.md',
    'README.md',
  ]);
  expect(repo.exists('docstamp-lock.yaml')).toBe(false);
});

scenario('§13.9 an invalid file stops the replay, with the diagnostics only', async (repo) => {
  repo.write('docstamp.yaml', config({ 'OK.md': ['src/a.ts'], 'BAD.md': ['src/missing.ts'] }));
  repo.write('OK.md', 'doc\n');
  repo.write('BAD.md', 'doc\n');
  repo.write('src/a.ts', 'a\n');
  const base = repo.commit('base', '2026-01-01T09:00:00Z');
  const result = await repo.run(['stats', '--from', base]);
  expect(result.exit).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('E_EMPTY_PATTERN: BAD.md: src/missing.ts');
  const named = await repo.run(['stats', '--from', base, 'OK.md'], { label: 'only the valid one' });
  expect(named.exit).toBe(0);
  const json = await repo.run(['stats', '--json', '--from', base]);
  expect(doc(json)).toMatchObject({ exitCode: 2, window: null, files: [] });
});

scenario('§13.9 nothing declared is E_CONFIG_MISSING, as everywhere', async (repo) => {
  repo.write('a.md', 'no block\n');
  repo.commit('base', '2026-01-01T09:00:00Z');
  const result = await repo.run(['stats']);
  expect(result.exit).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('E_CONFIG_MISSING');
});

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

scenario(
  '§13.2 stats option errors exit 2 before anything is read',
  { git: false },
  async (repo) => {
    for (const argv of [
      ['stats', '--since'],
      ['stats', '--since=-5d'],
      ['stats', '--since', '30'],
      ['stats', '--since', '7d', '--since', '8d'],
      ['stats', '--from'],
      ['stats', '--from=-x'],
      ['stats', '--max-fire-ratio', '0.5'],
      ['stats', '--sweep-threshold=5'],
      ['check', '--since', '30d'],
      ['--from', 'v1'],
      ['list-dependencies', '--since=7d'],
    ]) {
      const result = await repo.run(argv, { label: argv.join(' ') });
      expect(result.exit, argv.join(' ')).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('error: E_USAGE');
    }
  },
);

scenario('§13.9 stats reports the warnings of list-dependencies, and exits 0', async (repo) => {
  repo.write('docstamp.yaml', config({ 'DOC.md': ['src', '!src/**/*.spec.ts'] }));
  repo.write('DOC.md', 'doc\n');
  repo.write('src/a.ts', 'a\n');
  const base = repo.commit('base', '2026-01-01T09:00:00Z');
  repo.append('src/a.ts', 'one\n');
  repo.commit('edit', '2026-01-02T09:00:00Z');
  const listed = await repo.run(['list-dependencies'], { snapshot: false });
  const text = await repo.run(['stats', '--from', base]);
  expect(text.exit).toBe(0);
  expect(text.stdout).toContain('DOC.md');
  expect(text.stderr).toBe(listed.stderr);
  expect(text.stderr).toContain('warning: W_EMPTY_EXCLUSION: DOC.md: !src/**/*.spec.ts');
  const json = await repo.run(['stats', '--json', '--from', base]);
  expect(doc(json).files[0].diagnostics).toEqual(
    (await repo.run(['list-dependencies', '--json'], { snapshot: false })).json().files[0]
      .diagnostics,
  );
  expect(doc(json).files[0].diagnostics[0]).toMatchObject({ code: 'W_EMPTY_EXCLUSION' });
});
