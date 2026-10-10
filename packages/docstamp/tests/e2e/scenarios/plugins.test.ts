import { expect } from 'vitest';
import { scenario, type Repo } from '../harness/index.ts';

const options = { fixture: 'plugins', linkLib: true };

const configWith = (dependencies: string, plugins = '[headings]') =>
  "import { defineConfig } from 'docstamp';\n" +
  "import headings from './tools/headings.ts';\n\n" +
  `export default defineConfig({ version: 2, plugins: ${plugins}, files: { 'CLAUDE.md': ` +
  `{ dependencies: ${dependencies} } } });\n`;

const selectInstall = "{ path: 'docs/guide.md', select: 'Install' }";

async function reviewed(repo: Repo): Promise<void> {
  repo.commit('initial');
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  repo.commit('review');
}

scenario('§8.7 selected dependency: unrecorded, update, ok', options, async (repo) => {
  repo.commit('initial');
  const first = await repo.run([], { show: ['docstamp.config.ts'] });
  expect(first.exit).toBe(1);
  expect(first.stdout).toContain('STALE    CLAUDE.md  (unrecorded)');
  expect(first.stdout).toContain('depends   "docs/guide.md#\\"Install\\""');
  const update = await repo.run(['update', 'CLAUDE.md']);
  expect(update).toMatchObject({ exit: 0, stdout: 'written  CLAUDE.md\n' });
  repo.commit('review');
  expect(await repo.run([])).toMatchObject({
    exit: 0,
    stdout: '1 ok, 0 stale, 0 invalid\n',
  });
});

scenario('§8.7 a change outside the fragment keeps the file ok', options, async (repo) => {
  await reviewed(repo);
  repo.write('docs/guide.md', '# Guide\n\n## Install\n\nRun the installer.\n\n## Usage\n\nNew.\n');
  expect(await repo.run([])).toMatchObject({
    exit: 0,
    stdout: '1 ok, 0 stale, 0 invalid\n',
  });
});

scenario('§8.7 a change inside the fragment makes the file stale', options, async (repo) => {
  await reviewed(repo);
  repo.write(
    'docs/guide.md',
    '# Guide\n\n## Install\n\nRun it twice.\n\n## Usage\n\nRun the tool.\n',
  );
  const stale = await repo.run([]);
  expect(stale.exit).toBe(1);
  expect(stale.stdout).toContain('STALE    CLAUDE.md  (content-changed)');
  expect(stale.stdout).toContain(
    '  fragment  "docs/guide.md#\\"Install\\""  (changed)  section "Install" (level 2) (lines 3-6)\n',
  );
  expect(stale.stdout).toContain('  review: git diff -M ');
  expect(stale.stdout).not.toContain('depends');
  expect(stale.stdout).not.toMatch(/^ {2}(modified|added|removed)/mu);
  const json = (await repo.run(['--json'])).json();
  expect(json.files[0].changes).toEqual([]);
  expect(json.files[0].fragments).toEqual([
    {
      path: 'docs/guide.md',
      select: 'Install',
      status: 'changed',
      focus: ['section "Install" (level 2)'],
      lines: [{ start: 3, end: 6 }],
    },
  ]);
  expect(json.files[0].selected[0].select).toBe('Install');
});

scenario(
  '§12.3 step 11 a patterns change and a fragment change are both listed',
  options,
  async (repo) => {
    await reviewed(repo);
    repo.append('src/a.ts', '// edit\n');
    repo.write(
      'docs/guide.md',
      '# Guide\n\n## Install\n\nRun it twice.\n\n## Usage\n\nRun the tool.\n',
    );
    const stale = await repo.run([]);
    expect(stale.exit).toBe(1);
    expect(stale.stdout).toContain('  modified  src/a.ts\n');
    expect(stale.stdout).toContain(
      '  fragment  "docs/guide.md#\\"Install\\""  (changed)  section "Install" (level 2) (lines 3-6)\n',
    );
    expect(stale.stdout).toContain('review: git diff -M ');
    expect(stale.stdout).toContain('src/a.ts');
    expect(stale.stdout).toContain('docs/guide.md');
  },
);

scenario('§12.3 step 11 an unchanged fragment is not listed', options, async (repo) => {
  await reviewed(repo);
  repo.append('src/a.ts', '// edit\n');
  repo.write('docs/guide.md', '# Guide\n\n## Install\n\nRun the installer.\n\n## Usage\n\nNew.\n');
  const stale = await repo.run([]);
  expect(stale.exit).toBe(1);
  expect(stale.stdout).toContain('  modified  src/a.ts\n');
  expect(stale.stdout).not.toContain('fragment');
  const json = (await repo.run(['--json'])).json();
  expect(json.files[0].fragments).toEqual([]);
});

scenario('§12.3 step 11 a part that did not exist at the review is new', options, async (repo) => {
  repo.write('docs/guide.md', '# Guide\n\n## Usage\n\nRun the tool.\n');
  repo.write('docstamp.config.ts', configWith(`['src/**']`));
  await reviewed(repo);
  repo.write('docstamp.config.ts', configWith(`['src/**', ${selectInstall}]`));
  repo.write('docs/guide.md', '# Guide\n\n## Install\n\nRun it.\n\n## Usage\n\nRun the tool.\n');
  repo.append('src/a.ts', '// edit\n');
  const stale = await repo.run([]);
  expect(stale.exit).toBe(1);
  expect(stale.stdout).toContain(
    '  fragment  "docs/guide.md#\\"Install\\""  (new)  section "Install" (level 2) (lines 3-6)\n',
  );
});

scenario('§8.7 E_SELECT_NOT_FOUND', options, async (repo) => {
  repo.write(
    'docstamp.config.ts',
    configWith("['src/**', { path: 'docs/guide.md', select: 'Missing' }]"),
  );
  const result = await repo.run([], { show: ['docstamp.config.ts'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_SELECT_NOT_FOUND');
  expect(result.stderr).toContain('"docs/guide.md#\\"Missing\\""');
});

scenario('§8.7 E_SELECT_AMBIGUOUS and match all', options, async (repo) => {
  repo.append('docs/guide.md', '\n## Install\n\nAgain.\n');
  const ambiguous = await repo.run([]);
  expect(ambiguous.exit).toBe(2);
  expect(ambiguous.stderr).toContain('E_SELECT_AMBIGUOUS');
  repo.write(
    'docstamp.config.ts',
    configWith("['src/**', { path: 'docs/guide.md', select: 'Install', match: 'all' }]"),
  );
  repo.commit('initial');
  const stale = await repo.run([], { show: ['docstamp.config.ts'] });
  expect(stale.exit).toBe(1);
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  expect((await repo.run([])).exit).toBe(0);
});

scenario('§8.7 E_SELECT without a plugin', { fixture: 'plugins' }, async (repo) => {
  repo.remove('docstamp.config.ts');
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

scenario('§9.5 E_UNKNOWN_KEY for plugins in YAML', { fixture: 'plugins' }, async (repo) => {
  repo.remove('docstamp.config.ts');
  repo.write(
    'docstamp.yaml',
    'version: 2\nplugins: [headings]\nfiles:\n  CLAUDE.md:\n    dependencies: [src/**]\n',
  );
  const result = await repo.run([], { show: ['docstamp.yaml'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_UNKNOWN_KEY');
  expect(result.stderr).toContain('docstamp.config');
});

scenario('§8.7 E_PLUGIN for two claiming plugins', options, async (repo) => {
  repo.write(
    'docstamp.config.ts',
    "import { defineConfig } from 'docstamp';\nimport headings from './tools/headings.ts';\n\n" +
      "const other = { ...headings, name: 'other' };\n\n" +
      'export default defineConfig({ version: 2, plugins: [headings, other], files: ' +
      `{ 'CLAUDE.md': { dependencies: ['src/**', ${selectInstall}] } } });\n`,
  );
  const result = await repo.run([], { show: ['docstamp.config.ts'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_PLUGIN');
  expect(result.stderr).toContain('headings');
  expect(result.stderr).toContain('other');
});

scenario('§9.6.2 inline block with a selected dependency', options, async (repo) => {
  repo.write(
    'GUIDE.md',
    '---\ndocstamp:\n  dependencies:\n    - path: docs/guide.md\n      select: Install\n---\n\n# G\n',
  );
  repo.commit('initial');
  const check = await repo.run(['GUIDE.md'], { show: ['GUIDE.md'] });
  expect(check.exit).toBe(1);
  expect(check.stdout).toContain('depends   "docs/guide.md#\\"Install\\""');
  expect((await repo.run(['update', 'GUIDE.md'], { show: ['GUIDE.md'] })).exit).toBe(0);
  expect(repo.read('GUIDE.md')).toMatch(/^ {2}hash: [0-9a-f]{64}$/mu);
  repo.commit('review');
  expect((await repo.run(['GUIDE.md'])).exit).toBe(0);
  const list = (await repo.run(['list-dependencies', 'GUIDE.md', '--json'])).json();
  expect(JSON.stringify(list)).toContain('docs/guide.md');
  expect(JSON.stringify(list)).toContain('resolved');
});

scenario('§13.8 list-dependents for a selected path', options, async (repo) => {
  const text = await repo.run(['list-dependents', 'docs/guide.md']);
  expect(text.exit).toBe(0);
  expect(text.stdout).toContain('CLAUDE.md');
  expect(text.stdout).toContain('via "docs/guide.md#\\"Install\\""');
  const json = (await repo.run(['list-dependents', 'docs/guide.md', '--json'])).json();
  expect(JSON.stringify(json)).toContain('docs/guide.md#\\"Install\\"');
});

scenario('§10.4 whole and fragment on one path', options, async (repo) => {
  repo.write('docstamp.config.ts', configWith(`['docs/**', ${selectInstall}]`));
  await reviewed(repo);
  repo.write('docs/guide.md', '# Guide\n\n## Install\n\nRun the installer.\n\n## Usage\n\nNew.\n');
  const stale = await repo.run([]);
  expect(stale.exit).toBe(1);
  expect(stale.stdout).toContain('  modified  docs/guide.md\n');
  expect(stale.stdout).not.toContain('fragment');
});

const badPluginConfig = (members: string) =>
  "import { defineConfig } from 'docstamp';\n" +
  "import headings from './tools/headings.ts';\n\n" +
  `export default defineConfig({ ${members}, plugins: [{ ...headings, apiVersion: 2 }], ` +
  "files: { 'CLAUDE.md': { dependencies: ['src/**'] } } } as never);\n";

scenario('§9.3 step 5 a bad plugin is reported with the other errors', options, async (repo) => {
  repo.write('docstamp.config.ts', badPluginConfig('version: 2, bogus: 1'));
  const result = await repo.run([], { show: ['docstamp.config.ts'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_PLUGIN');
  expect(result.stderr).toContain('apiVersion');
  expect(result.stderr).toContain('E_UNKNOWN_KEY');
});

scenario('§9.3 step 4 a wrong version is reported before a bad plugin', options, async (repo) => {
  repo.write('docstamp.config.ts', badPluginConfig('version: 1'));
  const result = await repo.run([], { show: ['docstamp.config.ts'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_CONFIG_VERSION');
  expect(result.stderr).not.toContain('E_PLUGIN');
});
