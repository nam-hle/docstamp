import { expect } from 'vitest';
import { config, scenario, type Repo } from './harness/index.ts';

const fixture = 'renames';

async function reviewed(repo: Repo): Promise<void> {
  repo.commit('initial');
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.commit('review');
}

scenario(
  '§14.3.1 the same renames under a second stale file are one same line',
  { fixture },
  async (repo) => {
    await reviewed(repo);
    repo.rename('src/lib/keep.ts', 'src/lib/kept.ts');
    repo.rename('src/lib/old-name.ts', 'src/lib/new-name.ts');
    const result = await repo.run([]);
    expect(result.exit).toBe(1);
    const review =
      '  review: git diff -M ' +
      /review: git diff -M (\S+)/u.exec(result.stdout)![1]! +
      ' -- src/lib/keep.ts src/lib/kept.ts src/lib/new-name.ts src/lib/old-name.ts\n';
    expect(result.stdout).toContain(
      'STALE    README.md  (content-changed)\n' +
        '  renamed   src/lib/keep.ts -> src/lib/kept.ts\n' +
        '  renamed   src/lib/old-name.ts -> src/lib/new-name.ts\n' +
        review,
    );
    expect(result.stdout).toContain(
      'STALE    docs/api.md  (content-changed)\n' +
        '  renamed   (same 2 renames as README.md)\n' +
        review,
    );

    const json = (await repo.run(['--json'])).json();
    const paths = (i: number) => json.files[i].changes.map((c: { pair: string }) => c.pair);
    expect(paths(1)).toEqual(paths(0));
    expect(paths(1)).toHaveLength(4);
  },
);

scenario('§12.1 moving a dependency out of every pattern', { fixture }, async (repo) => {
  await reviewed(repo);
  repo.rename('src/lib/keep.ts', 'elsewhere/keep.ts');
  const result = await repo.run([]);
  expect(result.exit).toBe(1);
  expect(result.stdout).toContain('  deleted   src/lib/keep.ts\n');
  expect(result.stdout).not.toContain('elsewhere');
});

scenario(
  '§9.4 renaming the stamped file itself is E_FILE_MISSING plus an orphan',
  { fixture },
  async (repo) => {
    await reviewed(repo);
    repo.rename('README.md', 'GUIDE.md');
    const result = await repo.run([]);
    expect(result.exit).toBe(2);
    expect(result.stdout).toContain('INVALID  README.md');
    expect(result.stdout).toContain('1 ok, 0 stale, 1 invalid');
    expect(result.stderr).toContain('error: E_FILE_MISSING: README.md');

    const list = await repo.run(['list-dependencies', 'README.md']);
    expect(list.exit).toBe(2);

    repo.write('docstamp.yaml', repo.read('docstamp.yaml').replace('README.md', 'GUIDE.md'));
    const renamedKey = await repo.run([], {
      label: 'config key renamed too',
      show: ['docstamp.yaml'],
    });
    expect(renamedKey.exit).toBe(1);
    expect(renamedKey.stdout).toContain('STALE    GUIDE.md  (unrecorded)');
    expect(renamedKey.stderr).toContain('warning: W_ORPHAN: README.md');

    const update = await repo.run(['update', 'GUIDE.md']);
    expect(update.stdout).toBe('written  GUIDE.md\nremoved  README.md\n');
    await repo.snapFile('docstamp-lock.yaml');
    expect((await repo.run([])).exit).toBe(0);
  },
);

scenario(
  '§12.1 a rename that changes nothing a pattern selects leaves the file ok',
  { fixture },
  async (repo) => {
    await reviewed(repo);
    repo.write('notes/draft.txt', 'outside every pattern\n');
    repo.rename('notes/draft.txt', 'notes/final.txt');
    const result = await repo.run([]);
    expect(result).toMatchObject({ exit: 0, stdout: '2 ok, 0 stale, 0 invalid\n' });
  },
);

scenario(
  '§12.7 without git the E_EMPTY_PATTERN message names no renamed path',
  { fixture, git: false },
  async (repo) => {
    repo.write('docstamp.yaml', config({ 'docs/api.md': ['src/lib/old-name.ts'] }));
    repo.rename('src/lib/old-name.ts', 'src/lib/new-name.ts');
    const result = await repo.run(['--root', '.']);
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain(
      'error: E_EMPTY_PATTERN: docs/api.md: src/lib/old-name.ts: ' +
        'Correct or remove the pattern; it matches no file.\n',
    );
  },
);
