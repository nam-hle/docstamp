import { expect } from 'vitest';
import { scenario, type Repo } from '../harness/index.ts';

const fixture = 'docs-site';
const LOCK = 'docstamp-lock.yaml';

interface Side {
  edit: string;
  update: string;
}

async function branches(repo: Repo, first: Side, second: Side): Promise<void> {
  await repo.run(['update', '--all'], { expectExit: 0, snapshot: false });
  repo.commit('base');
  for (const [name, side] of [
    ['first', first],
    ['second', second],
  ] as const) {
    repo.git('switch', '-q', 'main');
    repo.git('switch', '-q', '-c', name);
    repo.append(side.edit, `// edited on ${name}\n`);
    await repo.run(['update', side.update], { expectExit: 0, snapshot: false });
    repo.commit(name);
  }
  repo.git('switch', '-q', 'first');
}

function merge(repo: Repo): 'clean' | 'conflict' {
  try {
    repo.git('merge', '-q', '--no-edit', 'second');
    return 'clean';
  } catch {
    return 'conflict';
  }
}

async function staleFiles(repo: Repo, label: string): Promise<string[]> {
  const result = await repo.run(['--json'], { label, expectExit: 1 });
  return result
    .json()
    .files.filter((entry: { state: string }) => entry.state === 'stale')
    .map((entry: { file: string }) => entry.file);
}

async function resolve(repo: Repo, side: '--ours' | '--theirs'): Promise<void> {
  repo.git('checkout', side, LOCK);
  repo.git('add', LOCK);
  repo.git('commit', '-q', '--no-edit');
}

scenario(
  '§11.2 two branches that update docs apart in the lock merge it cleanly',
  { fixture },
  async (repo) => {
    await branches(
      repo,
      { edit: 'src/util.ts', update: 'CLAUDE.md' },
      { edit: 'src/cli/run.ts', update: 'docs/guide.md' },
    );
    expect(merge(repo)).toBe('clean');
    expect(await staleFiles(repo, 'merged lock')).toEqual(['CLAUDE.md']);
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0, snapshot: false });
    await repo.run([], { expectExit: 0, label: 'after reviewing CLAUDE.md' });
  },
);

scenario(
  '§11.2 neighbouring lock lines of different docs conflict in git',
  { fixture },
  async (repo) => {
    await branches(
      repo,
      { edit: 'src/util.ts', update: 'CLAUDE.md' },
      { edit: 'src/index.ts', update: 'README.md' },
    );
    expect(merge(repo)).toBe('conflict');
    await repo.run([], { expectExit: 2, label: 'conflict markers in the lock' });

    await resolve(repo, '--ours');
    expect(await staleFiles(repo, 'took our side')).toEqual(['CLAUDE.md', 'README.md']);
    await repo.run(['update', 'CLAUDE.md', 'README.md'], { expectExit: 0, snapshot: false });
    await repo.run([], { expectExit: 0, label: 'after reviewing both' });
  },
);

scenario(
  '§11.2 two branches that update one doc conflict, either side resolves',
  { fixture },
  async (repo) => {
    await branches(
      repo,
      { edit: 'src/util.ts', update: 'CLAUDE.md' },
      { edit: 'src/cli/run.ts', update: 'CLAUDE.md' },
    );
    expect(merge(repo)).toBe('conflict');
    expect(repo.read(LOCK)).toContain('<<<<<<<');
    const conflicted = await repo.run([], { expectExit: 2, label: 'conflict markers in the lock' });
    expect(conflicted.stderr).toContain('E_LOCK');

    for (const side of ['--ours', '--theirs'] as const) {
      await resolve(repo, side);
      expect(await staleFiles(repo, `took ${side.slice(2)}`)).toEqual([
        'CLAUDE.md',
        'docs/guide.md',
      ]);
      repo.git('reset', '-q', '--hard', 'HEAD~1');
      expect(merge(repo)).toBe('conflict');
    }

    await resolve(repo, '--theirs');
    await repo.run(['update', 'CLAUDE.md', 'docs/guide.md'], { expectExit: 0, snapshot: false });
    await repo.run([], { expectExit: 0, label: 'after reviewing the stale files' });
  },
);
