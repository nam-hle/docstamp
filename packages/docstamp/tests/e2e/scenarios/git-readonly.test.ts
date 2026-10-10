import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { scenario } from '../harness/index.ts';

// Asking git for history must not change the repository (SPEC §12.3 step 1, §13.9, §13.10): the
// in-process scenarios cannot check this, because their git is a fake.
scenario(
  '§12.3 step 1 reading history never writes to the repository',
  { fixture: 'docs-site' },
  async (repo) => {
    repo.commit('initial');
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.commit('review');
    repo.append('src/util.ts', '// edit\n');
    const index = readFileSync(repo.path('.git/index'));
    const status = repo.git('status', '--porcelain');

    const check = await repo.run([], { snapshot: false });
    expect(check.json).toBeDefined();
    await repo.run(['stats', '--from', 'HEAD~1'], { snapshot: false });
    await repo.run(['suggest', 'README.md'], { snapshot: false });

    expect(readFileSync(repo.path('.git/index')).equals(index)).toBe(true);
    expect(repo.git('status', '--porcelain')).toBe(status);
  },
);
