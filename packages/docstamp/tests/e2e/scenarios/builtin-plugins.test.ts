import { expect } from 'vitest';
import { scenario, type Repo } from '../harness/index.ts';

const options = { fixture: 'structured' };

async function reviewed(repo: Repo): Promise<void> {
  repo.commit('initial');
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  repo.commit('review');
}

scenario(
  '§8.8 builtin plugins work from docstamp.yaml with no registration',
  options,
  async (repo) => {
    repo.commit('initial');
    const first = await repo.run([], { show: ['docstamp.yaml'] });
    expect(first.exit).toBe(1);
    expect(first.stdout).toContain('STALE    CLAUDE.md  (unrecorded)');
    expect(first.stdout).toContain('depends   "package.json#\\"scripts.build\\""');
    expect(first.stdout).toContain('depends   "package.json#\\"scripts.test\\""');
    expect(first.stdout).toContain('depends   "ci.yml#\\"jobs.test.steps.1.run\\""');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    expect(await repo.run([])).toMatchObject({
      exit: 0,
      stdout: '1 ok, 0 stale, 0 invalid\n',
    });
  },
);

scenario('§8.8 a change outside the selected values keeps the file ok', options, async (repo) => {
  await reviewed(repo);
  repo.write(
    'package.json',
    '{"scripts":{"lint":"eslint","test":"vitest","build":"tsc"},"version":"2.0.0","name":"demo"}',
  );
  repo.write('ci.yml', '# renamed\njobs: { test: { steps: [{uses: x}, {run: "pnpm test"}] } }\n');
  expect(await repo.run([])).toMatchObject({
    exit: 0,
    stdout: '1 ok, 0 stale, 0 invalid\n',
  });
});

scenario('§8.8 each of several selectors of one file can make it stale', options, async (repo) => {
  await reviewed(repo);
  repo.write('package.json', repo.read('package.json').replace('"vitest"', '"jest"'));
  const test = await repo.run([]);
  expect(test.exit).toBe(1);
  expect(test.stdout).toContain('(content-changed)');
  repo.write('package.json', repo.read('package.json').replace('"jest"', '"vitest"'));
  expect(await repo.run([])).toMatchObject({ exit: 0 });
  repo.write('ci.yml', repo.read('ci.yml').replace('pnpm test', 'pnpm run test'));
  expect((await repo.run([])).exit).toBe(1);
});

scenario('§8.8 a missing value is E_SELECT_NOT_FOUND, one per selector', options, async (repo) => {
  repo.write('package.json', '{"scripts":{"lint":"oxlint"}}\n');
  const result = await repo.run([], { show: ['package.json'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_SELECT_NOT_FOUND');
  expect(result.stderr).toContain('"package.json#\\"scripts.build\\""');
  expect(result.stderr).toContain('"package.json#\\"scripts.test\\""');
});

scenario('§8.8 text that does not parse is E_SELECT', options, async (repo) => {
  repo.write('package.json', '{"scripts": ');
  const result = await repo.run([], { show: ['package.json'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_SELECT');
});

scenario('§8.7 a selected path with glob characters is written escaped', options, async (repo) => {
  repo.write('data[1].json', '{"name":"a"}\n');
  repo.write(
    'docstamp.yaml',
    'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n' +
      "      - path: 'data\\[1\\].json'\n        select: name\n",
  );
  const first = await repo.run([], { show: ['docstamp.yaml'] });
  expect(first.exit).toBe(1);
  expect(first.stdout).toContain('depends   "data[1].json#\\"name\\""');
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  expect((await repo.run([])).exit).toBe(0);
  repo.write('data[1].json', '{"name":"b"}\n');
  expect((await repo.run([])).exit).toBe(1);
});

scenario('§8.7 a selected path that is a glob is E_CONFIG', options, async (repo) => {
  repo.write(
    'docstamp.yaml',
    'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - path: "*.json"\n        select: name\n',
  );
  const result = await repo.run([], { show: ['docstamp.yaml'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_CONFIG');
});
