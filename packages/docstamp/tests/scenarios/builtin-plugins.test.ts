import { expect } from 'vitest';
import { scenario, type Repo } from './harness/index.ts';

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
  expect(test.stdout).toContain('fragment  "package.json#\\"scripts.test\\""  (changed)');
  expect(test.stdout).not.toContain('scripts.build');
  repo.write('package.json', repo.read('package.json').replace('"jest"', '"vitest"'));
  expect(await repo.run([])).toMatchObject({ exit: 0 });
  repo.write('ci.yml', repo.read('ci.yml').replace('pnpm test', 'pnpm run test'));
  const ci = await repo.run([]);
  expect(ci.exit).toBe(1);
  expect(ci.stdout).toContain('(changed)');
  expect(ci.stdout).toContain('jobs.test.steps.1.run');
});

scenario(
  '§12.3 step 11 a pattern change and a fragment change are both listed, an unchanged fragment is not',
  options,
  async (repo) => {
    repo.write('src/a.ts', 'a\n');
    repo.write('docstamp.yaml', repo.read('docstamp.yaml') + '      - src/**\n');
    await reviewed(repo);
    repo.append('src/a.ts', '// edit\n');
    repo.write('package.json', repo.read('package.json').replace('"vitest"', '"jest"'));
    const stale = await repo.run([]);
    expect(stale.exit).toBe(1);
    expect(stale.stdout).toContain('  modified  src/a.ts\n');
    expect(stale.stdout).toContain('fragment  "package.json#\\"scripts.test\\""  (changed)');
    expect(stale.stdout).not.toContain('scripts.build');
    const json = (await repo.run(['--json'])).json();
    expect(json.files[0].changes).toEqual([
      { status: 'modified', path: 'src/a.ts', via: ['src/**'] },
    ]);
    expect(json.files[0].fragments.map((f: { select: string }) => f.select)).toEqual([
      'scripts.test',
    ]);
  },
);

scenario('§12.3 step 11 a value that did not exist at the review is new', options, async (repo) => {
  repo.write('package.json', '{"scripts":{"lint":"oxlint"}}\n');
  repo.write(
    'docstamp.yaml',
    'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - src/**\n',
  );
  repo.write('src/a.ts', 'a\n');
  await reviewed(repo);
  repo.write(
    'docstamp.yaml',
    'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - src/**\n' +
      '      - path: package.json\n        select: scripts.build\n',
  );
  repo.write('package.json', '{"scripts":{"build":"tsc","lint":"oxlint"}}\n');
  repo.append('src/a.ts', '// edit\n');
  const stale = await repo.run([]);
  expect(stale.exit).toBe(1);
  expect(stale.stdout).toContain('fragment  "package.json#\\"scripts.build\\""  (new)');
});

scenario('§10.4 a whole file and a value of it on one path', options, async (repo) => {
  repo.write(
    'docstamp.yaml',
    'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - package.json\n' +
      '      - path: package.json\n        select: scripts.build\n',
  );
  await reviewed(repo);
  repo.write('package.json', repo.read('package.json').replace('"1.0.0"', '"2.0.0"'));
  const stale = await repo.run([]);
  expect(stale.exit).toBe(1);
  expect(stale.stdout).toContain('  modified  package.json\n');
  expect(stale.stdout).not.toContain('fragment');
});

scenario('§9.6.2 an inline block with a selected dependency', options, async (repo) => {
  repo.write(
    'GUIDE.md',
    '---\ndocstamp:\n  dependencies:\n    - path: package.json\n      select: scripts.build\n---\n\n# G\n',
  );
  repo.commit('initial');
  const check = await repo.run(['GUIDE.md'], { show: ['GUIDE.md'] });
  expect(check.exit).toBe(1);
  expect(check.stdout).toContain('depends   "package.json#\\"scripts.build\\""');
  expect((await repo.run(['update', 'GUIDE.md'], { show: ['GUIDE.md'] })).exit).toBe(0);
  expect(repo.read('GUIDE.md')).toMatch(/^ {2}hash: [0-9a-f]{64}$/mu);
  repo.commit('review');
  expect((await repo.run(['GUIDE.md'])).exit).toBe(0);
});

scenario('§13.8 list-dependents for a selected path', options, async (repo) => {
  const text = await repo.run(['list-dependents', 'package.json']);
  expect(text.exit).toBe(0);
  expect(text.stdout).toContain('CLAUDE.md');
  expect(text.stdout).toContain('via "package.json#\\"scripts.build\\""');
  const json = (await repo.run(['list-dependents', 'package.json', '--json'])).json();
  expect(JSON.stringify(json)).toContain('package.json#\\"scripts.build\\"');
});

scenario('§8.7 E_SELECT without a plugin that claims the file', options, async (repo) => {
  repo.write('docs/guide.md', '# Guide\n\n## Install\n');
  repo.write(
    'docstamp.yaml',
    'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - path: docs/guide.md\n' +
      '        select: Install\n',
  );
  const result = await repo.run([], { show: ['docstamp.yaml'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_SELECT');
  expect(result.stderr).not.toContain('E_SELECT_');
});

scenario('§9.5 E_UNKNOWN_KEY for plugins in YAML', options, async (repo) => {
  repo.write(
    'docstamp.yaml',
    'version: 2\nplugins: [headings]\nfiles:\n  CLAUDE.md:\n    dependencies: [package.json]\n',
  );
  const result = await repo.run([], { show: ['docstamp.yaml'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_UNKNOWN_KEY');
  expect(result.stderr).toContain('docstamp.config');
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
