import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const PLUGIN = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const CLI = fileURLToPath(new URL('../../../docstamp/dist/index.js', import.meta.url));

const GUIDE = [
  '# Guide',
  '',
  '## Install',
  'Run the installer.',
  '',
  '## Usage',
  'Run the tool.',
  '',
].join('\n');

const dirs: string[] = [];

// A repository whose CLAUDE.md depends on one section of docs/guide.md, through the built plugin.
function repository(entry: string, guide = GUIDE) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'docstamp-markdown-')));
  dirs.push(root);
  const write = (path: string, text: string) => {
    writeFileSync(join(root, path), text);
  };
  writeFileSync(join(root, 'CLAUDE.md'), '# Agent notes\n');
  write('docstamp.config.mjs', config(entry));
  writeFileSync(join(root, 'guide.md'), guide);
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [CLI, '--root', root, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', HOME: root, LC_ALL: 'C' },
    });
    return {
      exit: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
  return { write, run };
}

const config = (entry: string) =>
  [
    `import plugin from ${JSON.stringify(pathToFileURL(PLUGIN).href)};`,
    'export default {',
    '  version: 2,',
    '  plugins: [plugin],',
    `  files: { 'CLAUDE.md': { dependencies: [${entry}] } },`,
    '};',
    '',
  ].join('\n');

beforeAll(() => {
  for (const path of [PLUGIN, CLI]) {
    if (!existsSync(path)) throw new Error(`${path} is not built: run pnpm nadle testMarkdown`);
  }
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('§6 the plugin through the docstamp CLI', () => {
  const INSTALL = "{ path: 'guide.md', select: 'Install' }";

  it('is stale until reviewed, then ok', () => {
    const { run } = repository(INSTALL);
    expect(run().exit).toBe(1);
    expect(run('update', 'CLAUDE.md').exit).toBe(0);
    expect(run().exit).toBe(0);
  });

  it('stays ok when another section changes and goes stale when the selected one does', () => {
    const { run, write } = repository(INSTALL);
    run('update', 'CLAUDE.md');
    write('guide.md', GUIDE.replace('Run the tool.', 'Run the tool twice.'));
    expect(run().exit).toBe(0);
    write('guide.md', GUIDE.replace('Run the installer.', 'Run the new installer.'));
    const stale = run();
    expect(stale.exit).toBe(1);
    expect(stale.stdout).toContain('STALE    CLAUDE.md');
  });

  it('reports a heading that is not there as E_SELECT_NOT_FOUND', () => {
    const { run } = repository("{ path: 'guide.md', select: 'Missing' }");
    const result = run();
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_SELECT_NOT_FOUND');
  });

  it('reports a heading that appears twice as E_SELECT_AMBIGUOUS, unless match is all', () => {
    const twice = `${GUIDE}\n## Install\nAgain.\n`;
    const one = repository(INSTALL, twice);
    const refused = one.run();
    expect(refused.exit).toBe(2);
    expect(refused.stderr).toContain('E_SELECT_AMBIGUOUS');

    const all = repository("{ path: 'guide.md', select: 'Install', match: 'all' }", twice);
    expect(all.run('update', 'CLAUDE.md').exit).toBe(0);
    all.write('guide.md', twice.replace('Again.', 'Changed.'));
    expect(all.run().exit).toBe(1);
  });

  it('selects by level when the object form is used', () => {
    const text = '# Install\none\n\n## Install\ntwo\n';
    const { run, write } = repository(
      "{ path: 'guide.md', select: { heading: 'Install', level: 2 } }",
      text,
    );
    run('update', 'CLAUDE.md');
    write('guide.md', text.replace('one', 'uno'));
    expect(run().exit).toBe(0);
    write('guide.md', text.replace('two', 'dos'));
    expect(run().exit).toBe(1);
  });

  it('reports an invalid selector as E_SELECT', () => {
    const { run } = repository("{ path: 'guide.md', select: { heading: 'Install', level: 9 } }");
    const result = run();
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_SELECT');
  });
});
