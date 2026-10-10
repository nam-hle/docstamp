import { expect } from 'vitest';
import { scenario, type Repo } from '../harness/index.ts';

const fixture = 'docs-site';

const MODES: [string, string[]][] = [
  ['check', []],
  ['check json', ['--json']],
  ['list-dependencies', ['list-dependencies']],
  ['list-dependents', ['list-dependents', 'src/cli/run.ts', 'README.md']],
];

async function everything(repo: Repo, env: Record<string, string> = {}) {
  const outputs: Record<string, [number, string, string]> = {};
  for (const [name, args] of MODES) {
    const r = await repo.run(args, { env, snapshot: false });
    outputs[name] = [r.exit, r.stdout, r.stderr];
  }
  const update = await repo.run(['update', '--all', '--json'], { env, snapshot: false });
  outputs['update json'] = [update.exit, update.stdout, update.stderr];
  outputs['lock'] = [0, repo.read('docstamp-lock.yaml'), ''];
  return outputs;
}

scenario(
  '§2 locale, time zone, color settings and root path do not change a byte',
  { fixture },
  async (repo) => {
    const baseline = await everything(repo);
    repo.remove('docstamp-lock.yaml');
    const shifted = await everything(repo, {
      LC_ALL: 'tr_TR.UTF-8',
      LANG: 'tr_TR.UTF-8',
      TZ: 'Pacific/Kiritimati',
      NO_COLOR: '',
      FORCE_COLOR: '1',
      CLICOLOR_FORCE: '1',
      TERM: 'xterm-256color',
    });
    expect(shifted).toEqual(baseline);
    repo.remove('docstamp-lock.yaml');
    const copy = repo.copyTo('a-completely-different-and-longer-directory-name');
    expect(await everything(copy)).toEqual(baseline);
    const text = await copy.run([], { label: 'check in the copy: root path is normalized' });
    expect(text.stdout).not.toContain('different');
    expect(text.stdout + text.stderr).not.toContain('\u001b');
  },
);
