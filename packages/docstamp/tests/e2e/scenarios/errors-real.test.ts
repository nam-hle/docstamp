import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { config, scenario, type Repo, type RunResult } from '../harness/index.ts';

const seen = new Set<string>();
const unreachable = new Set<string>();
const cannotChmod = process.platform === 'win32' || process.getuid?.() === 0;
if (cannotChmod) unreachable.add('E_UNREADABLE');

async function run(
  repo: Repo,
  label: string,
  args: string[],
  exit: number,
  codes: string[],
  show: string[] = ['docstamp.yaml'],
): Promise<RunResult> {
  const result = await repo.run(args, { label, show });
  for (const match of result.stderr.matchAll(/^(?:error|warning): ([EW]_[A-Z_]+)/gmu)) {
    seen.add(match[1]!);
  }
  expect(result.exit, label).toBe(exit);
  for (const code of codes) expect(result.stderr, label).toContain(`: ${code}`);
  expect(result.stderr, label).not.toContain(repo.root);
  return result;
}

const base = (repo: Repo) => {
  repo.write('DOC.md', '# doc\n');
  repo.write('src/a.ts', 'a\n');
};

scenario('§7.2 E_PATH_ENCODING for a name that is not valid UTF-8', async (repo) => {
  base(repo);
  repo.write('docstamp.yaml', config({ 'DOC.md': ['src/**'] }));
  try {
    writeFileSync(
      Buffer.concat([Buffer.from(repo.path('src/')), Buffer.from([0xff, 0x2e, 0x74])]),
      'x',
    );
  } catch {
    unreachable.add('E_PATH_ENCODING');
    repo.skip('this file system rejects names that are not valid UTF-8');
  }
  const result = await run(repo, 'invalid UTF-8 file name', [], 2, ['E_PATH_ENCODING']);
  expect(result.stderr).toContain('E_PATH_ENCODING: src');
});

scenario(
  '§16 exit 70 for an unexpected internal failure (injected)',
  { fixture: 'docs-site' },
  async (repo) => {
    const injected = repo.at('.');
    injected.write(
      'inject.mjs',
      "process.stdout.write = () => {\n  throw new Error('injected');\n};\n",
    );
    const env = { NODE_OPTIONS: `--import=${pathToFileURL(injected.path('inject.mjs')).href}` };
    const result = await repo.run([], { env, snapshot: false });
    expect(result.exit).toBe(70);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^internal error: Error: injected/u);
    const healthy = await repo.run([], { snapshot: false });
    expect(healthy.exit).toBe(1);
  },
);

scenario(
  '§12.4 E_HISTORY: no work tree, and a --from of no commit',
  { git: false },
  async (repo) => {
    base(repo);
    repo.write('docstamp.yaml', config({ 'DOC.md': ['src'] }));
    await run(repo, 'stats outside a git work tree', ['stats'], 2, ['E_HISTORY']);
    repo.git('init', '-q');
    repo.commit('base', '2026-01-01T09:00:00Z');
    await run(repo, 'stats with a --from of no commit', ['stats', '--from', 'soon'], 2, [
      'E_HISTORY',
    ]);
  },
);

scenario(
  '§8.7 and §9.5 plugin and selection errors',
  { fixture: 'plugins', linkLib: true },
  async (repo) => {
    const show = ['docstamp.config.ts'];
    const withDeps = (deps: string, plugins = '[headings]') =>
      "import { defineConfig } from 'docstamp';\nimport headings from './tools/headings.ts';\n" +
      "const other = { ...headings, name: 'other' };\n" +
      `export default defineConfig({ version: 2, plugins: ${plugins}, files: ` +
      `{ 'CLAUDE.md': { dependencies: [${deps}] } } });\n`;
    const missing = "{ path: 'docs/guide.md', select: 'Missing' }";
    repo.write('docstamp.config.ts', withDeps(missing));
    await run(repo, 'a selector that matches nothing', [], 2, ['E_SELECT_NOT_FOUND'], show);
    repo.append('docs/guide.md', '\n## Install\n\nAgain.\n');
    repo.write('docstamp.config.ts', withDeps("{ path: 'docs/guide.md', select: 'Install' }"));
    await run(repo, 'a selector that matches twice', [], 2, ['E_SELECT_AMBIGUOUS'], show);
    repo.write('docstamp.config.ts', withDeps(missing, '[headings, other]'));
    await run(repo, 'two plugins claim one path', [], 2, ['E_PLUGIN'], show);
    repo.remove('docstamp.config.ts');
    repo.write(
      'docstamp.yaml',
      'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - path: docs/guide.md\n' +
        '        select: Install\n',
    );
    await run(repo, 'no plugin claims the path', [], 2, ['E_SELECT'], ['docstamp.yaml']);
  },
);

// tests/scenarios/errors.test.ts counts these as reached here
it('reaches the diagnostics that need a real machine', () => {
  for (const code of [
    'E_PATH_ENCODING',
    'E_PLUGIN',
    'E_SELECT',
    'E_SELECT_NOT_FOUND',
    'E_SELECT_AMBIGUOUS',
    'E_HISTORY',
  ]) {
    expect(seen.has(code) || unreachable.has(code), code).toBe(true);
  }
});
