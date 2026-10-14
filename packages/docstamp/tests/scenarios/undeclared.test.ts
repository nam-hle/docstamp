import { expect } from 'vitest';
import { scenario, type Repo } from './harness/index.ts';

const CONFIG =
  'version: 2\nfiles:\n  docs/a.md:\n    dependencies:\n      - src/old.ts\n      - src/lib\n';
const DOC_A =
  '# A\n\nSee `src/old.ts`, `src/new.ts` and the folder `src/lib`. The `package.json` is generic.\n';
const DOC_B =
  '---\ndocstamp:\n  dependencies:\n    - src/lib/**\n---\n\n' +
  'Reads `src/lib/x.ts` and `src/new.ts`; `scripts/*.mjs` is a glob.\n';

async function repoWithGap(repo: Repo): Promise<void> {
  repo.write('docstamp.yaml', CONFIG);
  repo.write('src/old.ts', 'export const old = 1;\n');
  repo.write('src/new.ts', 'export const added = 1;\n');
  repo.write('src/lib/x.ts', 'export const x = 1;\n');
  repo.write('scripts/build.mjs', 'export {};\n');
  repo.write('package.json', '{}\n');
  repo.write('docs/a.md', DOC_A);
  repo.write('docs/b.md', DOC_B);
  repo.commit('init');
  await repo.run(['update', '--all'], { expectExit: 0, snapshot: false });
}

scenario(
  '§13.5 --undeclared fails on a literal path a file mentions and does not declare',
  async (repo) => {
    await repoWithGap(repo);
    const plain = await repo.run(['check']);
    expect(plain.exit).toBe(0);

    const result = await repo.run(['check', '--undeclared']);
    expect(result.exit).toBe(1);
    expect(result.stdout).toBe(
      '2 ok, 0 stale, 0 invalid\n' +
        'UNDECLARED docs/a.md  mentions src/new.ts\n' +
        'UNDECLARED docs/b.md  mentions src/new.ts\n' +
        'next: declare each mentioned path in its file, or stop mentioning it; ' +
        'see docstamp help suggest\n',
    );
    expect(result.stderr).toBe('');
  },
);

scenario(
  '§13.5 --undeclared ignores covered paths, directories, globs and generic files',
  async (repo) => {
    await repoWithGap(repo);
    const result = await repo.run(['check', '--undeclared', '--json'], { snapshot: false });
    expect(result.json().undeclared).toEqual([
      { file: 'docs/a.md', path: 'src/new.ts' },
      { file: 'docs/b.md', path: 'src/new.ts' },
    ]);
  },
);

scenario('§13.5 --undeclared is limited to the named files', async (repo) => {
  await repoWithGap(repo);
  const result = await repo.run(['check', '--undeclared', 'docs/b.md']);
  expect(result.exit).toBe(1);
  expect(result.stdout).toContain('UNDECLARED docs/b.md  mentions src/new.ts');
  expect(result.stdout).not.toContain('docs/a.md');
});

scenario('§14.3 --quiet does not hide an undeclared path', async (repo) => {
  await repoWithGap(repo);
  const result = await repo.run(['check', '--undeclared', '--quiet']);
  expect(result.exit).toBe(1);
  expect(result.stdout.startsWith('UNDECLARED docs/a.md')).toBe(true);
});

scenario('§13.5 declaring the path makes --undeclared pass', async (repo) => {
  await repoWithGap(repo);
  repo.write('docstamp.yaml', CONFIG + '      - src/new.ts\n');
  repo.write('docs/b.md', DOC_B.replace('- src/lib/**', '- src/lib/**\n    - src/new.ts'));
  await repo.run(['update', '--all'], { expectExit: 0, snapshot: false });
  const result = await repo.run(['check', '--undeclared', '--quiet']);
  expect(result.exit).toBe(0);
  expect(result.stdout).toBe('');
  const json = await repo.run(['check', '--undeclared', '--json'], { snapshot: false });
  expect(json.json().undeclared).toEqual([]);
});

scenario('§14.5 the undeclared member exists only with --undeclared', async (repo) => {
  await repoWithGap(repo);
  const result = await repo.run(['check', '--json'], { snapshot: false });
  expect(result.exit).toBe(0);
  expect(Object.keys(result.json())).toEqual([
    'version',
    'mode',
    'exitCode',
    'summary',
    'files',
    'diagnostics',
  ]);
});

scenario('§16 a stale file and an undeclared path both exit 1, an invalid one 2', async (repo) => {
  await repoWithGap(repo);
  repo.append('src/old.ts', 'export const more = 1;\n');
  const stale = await repo.run(['check', '--undeclared']);
  expect(stale.exit).toBe(1);
  expect(stale.stdout).toContain('STALE    docs/a.md');
  expect(stale.stdout).toContain('UNDECLARED docs/a.md  mentions src/new.ts');
  repo.write('docstamp.yaml', 'version: 2\nfiles:\n  docs/a.md:\n    dependencies:\n      - "["\n');
  const invalid = await repo.run(['check', '--undeclared']);
  expect(invalid.exit).toBe(2);
});

scenario('§13.2 --undeclared belongs to check alone', async (repo) => {
  await repoWithGap(repo);
  const result = await repo.run(['list-dependencies', '--undeclared']);
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_USAGE: --undeclared');
});

scenario('§13.10 suggest --all lists only the new proposals, grouped by file', async (repo) => {
  await repoWithGap(repo);
  const result = await repo.run(['suggest', '--all']);
  expect(result.exit).toBe(0);
  expect(result.stdout).toBe(
    'suggest docs/a.md\n' +
      '  pattern     files  stale  status\n' +
      '  src/new.ts      1    n/a  new\n' +
      'suggest docs/b.md\n' +
      '  pattern        files  stale  status\n' +
      '  scripts/*.mjs      1    n/a  new\n' +
      '  src/new.ts         1    n/a  new\n',
  );
  const json = await repo.run(['suggest', '--all', '--json'], { snapshot: false });
  const doc = json.json();
  expect(doc.all).toBe(true);
  expect(doc.files.map((f: { file: string }) => f.file)).toEqual(['docs/a.md', 'docs/b.md']);
  expect(doc.files[0].suggestions).toEqual([
    { pattern: 'src/new.ts', resolvedCount: 1, staleRate: null, status: 'new' },
  ]);
  expect(Object.keys(doc).at(-1)).toBe('all');
});

scenario('§13.10 suggest --all prints nothing when no file has a gap', async (repo) => {
  await repoWithGap(repo);
  repo.write('docs/a.md', '# A\n\nOnly `src/old.ts`.\n');
  repo.write('docs/b.md', DOC_B.replace(' and `src/new.ts`; `scripts/*.mjs` is a glob', ''));
  const result = await repo.run(['suggest', '--all']);
  expect(result.exit).toBe(0);
  expect(result.stdout).toBe('');
});

scenario(
  '§13.10 step 2 suggest --all without any declaration is E_CONFIG_MISSING',
  async (repo) => {
    repo.write('docs/a.md', DOC_A);
    const result = await repo.run(['suggest', '--all']);
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_CONFIG_MISSING');
  },
);

scenario('§13.2 suggest --all is not combined with files or --write', async (repo) => {
  await repoWithGap(repo);
  for (const args of [
    ['suggest', '--all', 'docs/a.md'],
    ['suggest', '--all', '--write'],
  ]) {
    const result = await repo.run(args);
    expect(result.exit, args.join(' ')).toBe(2);
    expect(result.stderr).toContain('E_USAGE: --all');
  }
});
