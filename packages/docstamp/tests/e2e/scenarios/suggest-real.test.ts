import { expect } from 'vitest';
import { scenario, type Repo } from '../harness/index.ts';

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

// base 60 days ago, then five commits inside the 30-day window, each touching one area
function history(repo: Repo): void {
  repo.commit('base', ago(60));
  repo.append('src/engine/parse.ts', 'one\n');
  repo.commit('parser', ago(10));
  repo.append('src/cli/main.ts', 'one\n');
  repo.commit('cli', ago(5));
  repo.append('docs/guide/setup.md', 'one\n');
  repo.commit('guide', ago(3));
  repo.append('scripts/build.mjs', 'one\n');
  repo.commit('script', ago(2));
  repo.append('package.json', 'one\n');
  repo.commit('bump', ago(1));
}

scenario(
  '§13.10 a shallow clone has no usable history and suggest still answers',
  { fixture: 'suggest' },
  async (repo) => {
    history(repo);
    const clone = repo.shallowClone('clone');
    const result = await clone.run(['suggest', 'README.md']);
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain('n/a');
    expect(result.stderr).toBe('');
  },
);
