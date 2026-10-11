import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
    const result = spawnSync(process.execPath, [CLI, '--cwd', root, ...args], {
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
  const lock = () => readFileSync(join(root, 'docstamp-lock.yaml'), 'utf8');
  return { write, run, lock };
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

  it('reports a heading that appears twice as E_SELECT naming its lines', () => {
    const twice = `${GUIDE}\n## Install\nAgain.\n`;
    const refused = repository(INSTALL, twice).run();
    expect(refused.exit).toBe(2);
    expect(refused.stderr).toContain('E_SELECT');
    expect(refused.stderr).toContain('appears at lines');
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

  it('§4.1 reads the one-string shorthand with the hash of the written form', () => {
    const written = repository(INSTALL);
    written.run('update', 'CLAUDE.md');
    const bare = repository("'guide.md:Install'");
    expect(bare.run().exit).toBe(1);
    bare.run('update', 'CLAUDE.md');
    expect(bare.lock()).toBe(written.lock());
    expect(bare.run().exit).toBe(0);
  });

  it('§4.1 reads a level marker as the object form, with its hash', () => {
    const text = '# Install\none\n\n## Install\ntwo\n';
    const marked = repository("'guide.md:## Install'", text);
    marked.run('update', 'CLAUDE.md');
    const written = repository(
      "{ path: 'guide.md', select: { heading: 'Install', level: 2 } }",
      text,
    );
    written.run('update', 'CLAUDE.md');
    expect(marked.lock()).toBe(written.lock());
    marked.write('guide.md', text.replace('one', 'uno'));
    expect(marked.run().exit).toBe(0);
    marked.write('guide.md', text.replace('two', 'dos'));
    expect(marked.run().exit).toBe(1);
  });

  it('§4.1 takes a comma and an equals sign of a heading as they are', () => {
    const { run } = repository("'guide.md:Q&A, part 2 = 3'", '# Q&A, part 2 = 3\ntext\n');
    expect(run().exit).toBe(1);
    expect(run('update', 'CLAUDE.md').exit).toBe(0);
  });

  it('§4.1 reports a marker without a heading as E_SELECT', () => {
    const result = repository("'guide.md:## '").run();
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_SELECT');
    expect(result.stderr).toContain('invalid-selector');
  });

  it('§3 meta.schema reports an unknown key as E_SELECT', () => {
    const result = repository(
      "{ path: 'guide.md', select: { heading: 'Install', title: 'x' } }",
    ).run();
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_SELECT');
    expect(result.stderr).toContain('/title');
  });
});
