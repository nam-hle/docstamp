import { expect } from 'vitest';
import { config, scenario, type Repo } from '../harness/index.ts';

const fixture = 'renames';

async function reviewed(repo: Repo): Promise<void> {
  repo.commit('initial');
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.commit('review');
}

scenario(
  '§12.7 E_EMPTY_PATTERN names the path a literal dependency was renamed to',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', config({ 'docs/api.md': ['src/lib/old-name.ts'] }));
    await reviewed(repo);
    const hint = 'git shows it renamed to src/lib/new-name.ts; depend on the new path.';
    repo.git('mv', 'src/lib/old-name.ts', 'src/lib/new-name.ts');
    const staged = await repo.run([], { label: 'renamed, not committed' });
    expect(staged.exit).toBe(2);
    expect(staged.stderr).toContain(`error: E_EMPTY_PATTERN: docs/api.md: src/lib/old-name.ts: `);
    expect(staged.stderr).toContain(hint);

    repo.commit('rename');
    const committed = await repo.run(['--json'], { label: 'renamed and committed' });
    expect(committed.exit).toBe(2);
    const empty = committed
      .json()
      .files[0].diagnostics.find((d: { code: string }) => d.code === 'E_EMPTY_PATTERN');
    expect(empty).toMatchObject({ subject: 'src/lib/old-name.ts' });
    expect(empty.message).toContain(hint);
    const listed = await repo.run(['list-dependencies'], { snapshot: false });
    expect(listed.stderr).toContain(hint);

    const shallow = repo.shallowClone('shallow');
    const fromShallow = await shallow.run([], { label: 'a shallow clone', snapshot: false });
    expect(fromShallow.exit).toBe(2);
    expect(fromShallow.stderr).toContain('E_EMPTY_PATTERN');
    expect(fromShallow.stderr).not.toContain('renamed');

    repo.append('src/lib/new-name.ts', 'edited after the move\n');
    const edited = await repo.run([], { label: 'renamed and edited' });
    expect(edited.exit).toBe(2);
    expect(edited.stderr).toContain(
      'error: E_EMPTY_PATTERN: docs/api.md: src/lib/old-name.ts: ' +
        'Correct or remove the pattern; it matches no file.\n',
    );
  },
);
