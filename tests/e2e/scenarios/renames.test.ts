import { expect } from 'vitest';
import { scenario, type Repo } from '../harness/index.ts';

const fixture = 'renames';

async function reviewed(repo: Repo): Promise<void> {
  repo.commit('initial');
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.commit('review');
}

scenario('§12.1 renaming a dependency inside a dependency directory', { fixture }, async (repo) => {
  await reviewed(repo);
  repo.rename('src/lib/old-name.ts', 'src/lib/new-name.ts');
  const result = await repo.run([]);
  expect(result.exit).toBe(1);
  expect(result.stdout).toContain(
    'STALE    README.md  (content-changed)\n  added     src/lib/new-name.ts\n  deleted   src/lib/old-name.ts\n',
  );
  expect(result.stdout).toContain(
    'STALE    docs/api.md  (content-changed)\n  added     src/lib/new-name.ts\n  deleted   src/lib/old-name.ts\n',
  );
  expect(result.stdout).toContain('0 ok, 2 stale, 0 invalid');

  repo.commit('rename');
  const committed = await repo.run(['--json'], { label: 'rename committed' });
  expect(committed.json().files[0].changes).toEqual([
    { status: 'added', path: 'src/lib/new-name.ts' },
    { status: 'deleted', path: 'src/lib/old-name.ts' },
  ]);

  repo.rename('src/lib/new-name.ts', 'src/lib/old-name.ts');
  expect((await repo.run([], { label: 'renamed back' })).exit).toBe(0);
});

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
