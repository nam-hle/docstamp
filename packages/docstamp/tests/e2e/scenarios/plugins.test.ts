import { expect } from 'vitest';
import { scenario } from '../harness/index.ts';

const options = { fixture: 'plugins', linkLib: true };

scenario(
  '§8.7 a plugin loaded by a script Carrier selects part of a file',
  options,
  async (repo) => {
    repo.commit('initial');
    const first = await repo.run([], { show: ['docstamp.config.ts'] });
    expect(first.exit).toBe(1);
    expect(first.stdout).toContain('STALE    CLAUDE.md  (unrecorded)');
    expect(first.stdout).toContain('depends   "docs/guide.md#\\"Install\\""');
    expect(await repo.run(['update', 'CLAUDE.md'])).toMatchObject({
      exit: 0,
      stdout: 'written  CLAUDE.md\n',
    });
    repo.commit('review');

    repo.write(
      'docs/guide.md',
      '# Guide\n\n## Install\n\nRun the installer.\n\n## Usage\n\nNew.\n',
    );
    expect((await repo.run([])).exit).toBe(0);

    repo.write(
      'docs/guide.md',
      '# Guide\n\n## Install\n\nRun it twice.\n\n## Usage\n\nRun the tool.\n',
    );
    const stale = await repo.run([]);
    expect(stale.exit).toBe(1);
    expect(stale.stdout).toContain(
      '  fragment  "docs/guide.md#\\"Install\\""  (changed)  section "Install" (level 2) (lines 3-6)\n',
    );
    const json = (await repo.run(['--json'])).json();
    expect(json.files[0].fragments).toEqual([
      {
        path: 'docs/guide.md',
        select: 'Install',
        status: 'changed',
        parts: [{ focus: 'section "Install" (level 2)', lines: { start: 3, end: 6 } }],
      },
    ]);
  },
);

const badPluginConfig =
  "import { defineConfig } from 'docstamp';\n" +
  "import headings from './tools/headings.ts';\n\n" +
  'export default defineConfig({ version: 2, bogus: 1, plugins: [{ ...headings, apiVersion: 2 }], ' +
  "files: { 'CLAUDE.md': { dependencies: ['src/**'] } } } as never);\n";

scenario('§9.3 step 5 a bad plugin of a script Carrier is reported', options, async (repo) => {
  repo.write('docstamp.config.ts', badPluginConfig);
  const result = await repo.run([], { show: ['docstamp.config.ts'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_PLUGIN');
  expect(result.stderr).toContain('apiVersion');
  expect(result.stderr).toContain('E_UNKNOWN_KEY');
});

scenario(
  '§8.7 a script plugin reports a warning and an error of its own',
  options,
  async (repo) => {
    repo.write('docs/guide.md', '# Guide\n\n## Install\n\n## Usage\n\nRun the tool.\n');
    const warned = await repo.run([]);
    expect(warned.exit).toBe(1);
    expect(warned.stderr).toContain(
      'warning: W_SELECT: CLAUDE.md: "docs/guide.md#\\"Install\\"": The section "Install" is empty; write it.',
    );
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    const recorded = await repo.run([]);
    expect(recorded.exit).toBe(0);
    expect(recorded.stderr).toContain('W_SELECT');

    repo.write(
      'docs/guide.md',
      '# Guide\n\n## Install\n\nOne.\n\n## Usage\n\n### Install\n\nTwo.\n',
    );
    const refused = await repo.run([]);
    expect(refused.exit).toBe(2);
    expect(refused.stderr).toContain(
      'error: E_SELECT: CLAUDE.md: "docs/guide.md#\\"Install\\"": "Install" is a heading at lines 3, 9; rename one.',
    );
  },
);
