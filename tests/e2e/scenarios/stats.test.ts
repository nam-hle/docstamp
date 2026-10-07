import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { config, scenario, type Repo } from '../harness/index.ts';

const DOCS = {
  'NARROW.md': ['src/a.ts'],
  'MID.md': ['src/a.ts', 'src/b.ts'],
  'BROAD.md': ['src'],
};

// base, then six commits: a sweep on day 4, two commits that fire nothing, one on days 2 and 5 each
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
  for (const name of ['gen1', 'gen2', 'gen3', 'gen4']) repo.write(`src/${name}.ts`, 'g\n');
  repo.commit('sweep', '2026-01-04T12:00:00Z');
  repo.append('src/c.ts', 'one\n');
  repo.commit('edit c', '2026-01-05T08:00:00Z');
  repo.commit('empty', '2026-01-05T09:00:00Z');
  return base;
}

const doc = (result: { json: () => any }) => result.json();

scenario('§13.9 stats ranks narrow and broad lists, counts days and sweeps', async (repo) => {
  const base = timeline(repo);
  const index = readFileSync(repo.path('.git/index'));
  const text = await repo.run(['stats', '--since', base, '--sweep-threshold', '3']);
  expect(text.exit).toBe(0);
  expect(text.stdout).toBe(
    'file       patterns  files  commits  days   ratio   sweep\n' +
      'BROAD.md          1      7        4     3  0.6667  0.2500\n' +
      'MID.md            2      2        3     2  0.5000  0.3333\n' +
      'NARROW.md         1      1        2     2  0.3333  0.5000\n' +
      `window: 6 commits since ${base} (revision), 2 fire nothing\n`,
  );
  expect(text.stderr).toBe('');

  const json = await repo.run(['stats', '--json', '--since', base, '--sweep-threshold', '3']);
  expect(doc(json)).toEqual({
    version: 2,
    mode: 'stats',
    exitCode: 0,
    window: { since: base, kind: 'revision', commits: 6, firingNothing: 2 },
    sweepThreshold: 3,
    maxFireRatio: null,
    exceeding: [],
    files: [
      {
        file: 'BROAD.md',
        patterns: 1,
        resolvedCount: 7,
        commits: 4,
        days: 3,
        ratio: 0.6667,
        sweepCommits: 1,
        sweepShare: 0.25,
        diagnostics: [],
      },
      {
        file: 'MID.md',
        patterns: 2,
        resolvedCount: 2,
        commits: 3,
        days: 2,
        ratio: 0.5,
        sweepCommits: 1,
        sweepShare: 0.3333,
        diagnostics: [],
      },
      {
        file: 'NARROW.md',
        patterns: 1,
        resolvedCount: 1,
        commits: 2,
        days: 2,
        ratio: 0.3333,
        sweepCommits: 1,
        sweepShare: 0.5,
        diagnostics: [],
      },
    ],
    diagnostics: [],
  });

  const wide = await repo.run(['stats', '--since', base], { label: 'default sweep threshold' });
  expect(wide.stdout).toContain('NARROW.md         1      1        2     2  0.3333  0.0000\n');

  expect(readFileSync(repo.path('.git/index')).equals(index)).toBe(true);
  expect(repo.git('status', '--porcelain')).toBe('');
  expect(repo.exists('docstamp-lock.yaml')).toBe(false);
});

scenario('§13.9 the default window is 90 days back from now', async (repo) => {
  timeline(repo);
  const result = await repo.run(['stats', '--json'], { snapshot: false });
  expect(result.exit).toBe(0);
  expect(doc(result).window).toEqual({
    since: '90.days',
    kind: 'date',
    commits: 0,
    firingNothing: 0,
  });
  expect(doc(result).files.map((f: { ratio: number }) => f.ratio)).toEqual([0, 0, 0]);
});

scenario('§13.9 --max-fire-ratio exits 1 above the ratio, 0 at or below it', async (repo) => {
  const base = timeline(repo);
  const run = (ratio: string, ...more: string[]) =>
    repo.run(['stats', '--since', base, '--max-fire-ratio', ratio, ...more]);
  const at = await run('0.6667');
  expect(at.exit).toBe(0);
  expect(at.stdout).not.toContain('over');
  const below = await run('0.6666');
  expect(below.exit).toBe(1);
  expect(below.stdout).toContain('over --max-fire-ratio 0.6666: BROAD.md\n');
  const two = await run('0.4');
  expect(two.exit).toBe(1);
  expect(two.stdout).toContain('over --max-fire-ratio 0.4: BROAD.md MID.md\n');
  expect((await run('1')).exit).toBe(0);
  expect((await run('1.0')).exit).toBe(0);
  expect((await run('0')).exit).toBe(1);
  const named = await run('0.4', 'NARROW.md');
  expect(named.exit).toBe(0);
  const json = await run('0.4', '--json');
  expect(json.exit).toBe(1);
  expect(doc(json)).toMatchObject({
    exitCode: 1,
    maxFireRatio: 0.4,
    exceeding: ['BROAD.md', 'MID.md'],
  });
  expect((await run('0.5', '--json')).json().exceeding).toEqual(['BROAD.md']);
});

scenario(
  '§13.9 named files are measured against the commits that fire none of them',
  async (repo) => {
    const base = timeline(repo);
    const named = await repo.run(['stats', '--since', base, 'NARROW.md', './MID.md']);
    expect(named.exit).toBe(0);
    expect(named.stdout).toBe(
      'file       patterns  files  commits  days   ratio   sweep\n' +
        'MID.md            2      2        3     2  0.5000  0.0000\n' +
        'NARROW.md         1      1        2     2  0.3333  0.0000\n' +
        `window: 6 commits since ${base} (revision), 3 fire nothing\n`,
    );
    const unknown = await repo.run(['stats', '--since', base, 'nope.md', 'NARROW.md']);
    expect(unknown.exit).toBe(2);
    expect(unknown.stdout).toBe('');
    expect(unknown.stderr).toContain('E_UNKNOWN_FILE: nope.md');
    const json = await repo.run(['stats', '--json', '--since', base, 'nope.md']);
    expect(doc(json)).toMatchObject({ exitCode: 2, window: null, files: [] });
  },
);

scenario('§12.4 --since is a commit when it names one, else a date or a duration', async (repo) => {
  const base = timeline(repo);
  const head = repo.git('rev-parse', 'HEAD').trim();

  const revision = await repo.run(['stats', '--since', 'HEAD~2']);
  expect(revision.stdout).toContain('window: 2 commits since HEAD~2 (revision), 1 fire nothing\n');

  const date = await repo.run(['stats', '--since', '2026-01-03']);
  expect(date.stdout).toContain('window: 4 commits since 2026-01-03 (date), 2 fire nothing\n');
  const exact = await repo.run(['stats', '--since', '2026-01-03T00:00:00Z']);
  expect(exact.stdout).toContain('(date), 2 fire nothing\n');
  const after = await repo.run(['stats', '--since=2026-01-02 23:59:59']);
  expect(after.stdout).toContain('window: 5 commits since "2026-01-02 23:59:59" (date)');
  const zoned = await repo.run(['stats', '--since', '2026-01-03T01:00:00+01:00']);
  expect(zoned.stdout).toContain('window: 4 commits since 2026-01-03T01:00:00+01:00 (date)');

  repo.git('tag', '2026-01-04', base);
  const tagged = await repo.run(['stats', '--since', '2026-01-04']);
  expect(tagged.stdout).toContain('window: 6 commits since 2026-01-04 (revision)');
  const forced = await repo.run(['stats', '--since', '2026-01-04T00:00:00Z']);
  expect(forced.stdout).toContain('window: 3 commits since 2026-01-04T00:00:00Z (date)');

  const empty = await repo.run(['stats', '--since', head, '--max-fire-ratio', '0']);
  expect(empty.exit).toBe(0);
  expect(empty.stdout).toContain('window: 0 commits since');
  expect(empty.stdout).toContain('NARROW.md         1      1        0     0  0.0000  0.0000\n');
});

scenario('§12.4 a --since that is neither a commit nor a date is E_HISTORY', async (repo) => {
  timeline(repo);
  for (const value of ['garbage', '2026-02-30', '90days', 'yesterday', 'nobranch..HEAD']) {
    const result = await repo.run(['stats', '--since', value], {
      label: `bad since ${value}`,
    });
    expect(result.exit).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`error: E_HISTORY: ${value}:`);
  }
  const json = await repo.run(['stats', '--json', '--since', 'garbage']);
  expect(json.exit).toBe(2);
  expect(doc(json)).toMatchObject({
    exitCode: 2,
    window: null,
    files: [],
    diagnostics: [{ code: 'E_HISTORY', severity: 'error', file: null, subject: 'garbage' }],
  });
});

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
    const result = await repo.run(['stats', '--since', base, '--sweep-threshold', '1']);
    expect(result.exit).toBe(0);
    expect(result.stdout).toBe(
      'file     patterns  files  commits  days   ratio   sweep\n' +
        'TO.md           1      2        1     1  1.0000  1.0000\n' +
        'ELSE.md         1      1        0     0  0.0000  0.0000\n' +
        'FROM.md         1      1        0     0  0.0000  0.0000\n' +
        `window: 1 commits since ${base} (revision), 0 fire nothing\n`,
    );
    const wider = await repo.run(['stats', '--json', '--since', base, '--sweep-threshold', '2']);
    expect(doc(wider).files[0]).toMatchObject({ file: 'TO.md', commits: 1, sweepCommits: 0 });
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
  const result = await repo.run(['stats', '--since', base]);
  expect(result.exit).toBe(0);
  expect(result.stdout).toBe(
    'file                patterns  files  commits  days   ratio   sweep\n' +
      '"docs/big list.md"         1      2        2     2  1.0000  0.0000\n' +
      'README.md                  1      1        1     1  0.5000  0.0000\n' +
      `window: 2 commits since ${base} (revision), 0 fire nothing\n`,
  );
  const json = await repo.run(['stats', '--json', '--since', base]);
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
  const result = await repo.run(['stats', '--since', base]);
  expect(result.exit).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('E_EMPTY_PATTERN: BAD.md: src/missing.ts');
  const named = await repo.run(['stats', '--since', base, 'OK.md'], {
    label: 'only the valid one',
  });
  expect(named.exit).toBe(0);
  const json = await repo.run(['stats', '--json', '--since', base]);
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
  const text = await clone.run(['stats', '--since', base]);
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

    repo.commit('base', '2026-01-01T09:00:00Z');
    const fine = await repo.run(['stats', '--since', '2026-01-01'], { label: 'with a commit' });
    expect(fine.exit).toBe(0);
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
  const result = await repo.run(['stats', '--json', '--since', base], {
    env: { GIT_DIR: foreign.path('.git'), GIT_WORK_TREE: foreign.root },
  });
  expect(doc(result).window).toMatchObject({ commits: 6, firingNothing: 2 });
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
    const result = await repo.run(['stats', '--since', base], { cwd: 'pkg' });
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain('DOC.md');
    expect(result.stdout).toContain(`window: 2 commits since ${base} (revision), 1 fire nothing\n`);
  },
);

scenario(
  '§13.2 stats option errors exit 2 before anything is read',
  { git: false },
  async (repo) => {
    for (const argv of [
      ['stats', '--max-fire-ratio', '2'],
      ['stats', '--max-fire-ratio=0.'],
      ['stats', '--max-fire-ratio'],
      ['stats', '--sweep-threshold', '-1'],
      ['stats', '--sweep-threshold=1.5'],
      ['stats', '--since'],
      ['stats', '--since=-x'],
      ['stats', '--since', 'a', '--since', 'b'],
      ['check', '--since', '90.days'],
      ['--sweep-threshold', '5'],
      ['list-dependencies', '--max-fire-ratio=1'],
    ]) {
      const result = await repo.run(argv, { label: argv.join(' ') });
      expect(result.exit, argv.join(' ')).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('error: E_USAGE');
    }
  },
);

scenario(
  '§13.9 stats reports the warnings of list-dependencies, and they never gate',
  async (repo) => {
    repo.write('docstamp.yaml', config({ 'DOC.md': ['src', '!src/**/*.spec.ts'] }));
    repo.write('DOC.md', 'doc\n');
    repo.write('src/a.ts', 'a\n');
    const base = repo.commit('base', '2026-01-01T09:00:00Z');
    repo.append('src/a.ts', 'one\n');
    repo.commit('edit', '2026-01-02T09:00:00Z');
    const listed = await repo.run(['list-dependencies'], { snapshot: false });
    const text = await repo.run(['stats', '--since', base, '--max-fire-ratio', '1']);
    expect(text.exit).toBe(0);
    expect(text.stdout).toContain('DOC.md');
    expect(text.stderr).toBe(listed.stderr);
    expect(text.stderr).toContain('warning: W_EMPTY_EXCLUSION: DOC.md: !src/**/*.spec.ts');
    const json = await repo.run(['stats', '--json', '--since', base]);
    expect(doc(json).files[0].diagnostics).toEqual(
      (await repo.run(['list-dependencies', '--json'], { snapshot: false })).json().files[0]
        .diagnostics,
    );
    expect(doc(json).files[0].diagnostics[0]).toMatchObject({ code: 'W_EMPTY_EXCLUSION' });
  },
);
