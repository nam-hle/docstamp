import { expect } from 'vitest';
import { scenario, type Repo } from '../harness/index.ts';

const fixture = 'inline-docs';
async function reviewedRepo(repo: Repo): Promise<void> {
  repo.commit('initial');
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.commit('review');
}

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
