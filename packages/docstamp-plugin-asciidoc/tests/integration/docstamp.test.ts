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
  '= Guide',
  '',
  '[#install]',
  '== Install',
  'Run the installer.',
  '',
  '== Usage',
  'Run the tool.',
  '',
].join('\n');

const dirs: string[] = [];

// A repository whose CLAUDE.md depends on one section of guide.adoc, through the built plugin.
function repository(entry: string, guide = GUIDE) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'docstamp-asciidoc-')));
  dirs.push(root);
  const write = (path: string, text: string) => {
    writeFileSync(join(root, path), text);
  };
  writeFileSync(join(root, 'CLAUDE.md'), '# Agent notes\n');
  write('docstamp.config.mjs', config(entry));
  writeFileSync(join(root, 'guide.adoc'), guide);
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
    if (!existsSync(path)) throw new Error(`${path} is not built: run pnpm nadle testAsciidoc`);
  }
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('§6 the plugin through the docstamp CLI', () => {
  const INSTALL = "{ path: 'guide.adoc', select: 'Install' }";

  it('is stale until reviewed, then ok', () => {
    const { run } = repository(INSTALL);
    expect(run().exit).toBe(1);
    expect(run('update', 'CLAUDE.md').exit).toBe(0);
    expect(run().exit).toBe(0);
  });

  it('stays ok when another section changes and goes stale when the selected one does', () => {
    const { run, write } = repository(INSTALL);
    run('update', 'CLAUDE.md');
    write('guide.adoc', GUIDE.replace('Run the tool.', 'Run the tool twice.'));
    expect(run().exit).toBe(0);
    write('guide.adoc', GUIDE.replace('Run the installer.', 'Run the new installer.'));
    const stale = run();
    expect(stale.exit).toBe(1);
    expect(stale.stdout).toContain('STALE    CLAUDE.md');
  });

  it('does not follow an include: the included file is no part of the section', () => {
    const text = `${GUIDE}\n== Other\ninclude::part.adoc[]\n`;
    const { run, write } = repository(INSTALL, text);
    run('update', 'CLAUDE.md');
    write('part.adoc', 'changed\n');
    expect(run().exit).toBe(0);
  });

  it('reports a section that is not there as E_SELECT_NOT_FOUND', () => {
    const { run } = repository("{ path: 'guide.adoc', select: 'Missing' }");
    const result = run();
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_SELECT_NOT_FOUND');
    expect(result.stderr).toContain('No section "Missing"');
  });

  it('reports a title that appears twice as E_SELECT naming its lines', () => {
    const refused = repository(INSTALL, `${GUIDE}\n== Install\nAgain.\n`).run();
    expect(refused.exit).toBe(2);
    expect(refused.stderr).toContain('E_SELECT');
    expect(refused.stderr).toContain('selects sections at lines');
  });

  it('prints nothing of the parser when an id is given twice', () => {
    const text = '[#same]\n== One\n\n[#same]\n== Two\n';
    const { run } = repository("{ path: 'guide.adoc', select: 'One' }", text);
    const result = run();
    expect(result.exit).toBe(1);
    expect(result.stderr).toBe('');
  });

  it('selects by anchor when the object form is used', () => {
    const { run, write } = repository("{ path: 'guide.adoc', select: { anchor: 'install' } }");
    run('update', 'CLAUDE.md');
    write('guide.adoc', GUIDE.replace('Run the tool.', 'Run the tool twice.'));
    expect(run().exit).toBe(0);
    write('guide.adoc', GUIDE.replace('[#install]', '[#setup]'));
    expect(run().exit).toBe(2);
  });

  it('reports an invalid selector as E_SELECT', () => {
    const { run } = repository("{ path: 'guide.adoc', select: { title: 'Install', level: 9 } }");
    const result = run();
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_SELECT');
  });

  it('§4.1 reads the one-string shorthand with the hash of the written form', () => {
    const written = repository(INSTALL);
    written.run('update', 'CLAUDE.md');
    const bare = repository("'guide.adoc:Install'");
    expect(bare.run().exit).toBe(1);
    bare.run('update', 'CLAUDE.md');
    expect(bare.lock()).toBe(written.lock());
    expect(bare.run().exit).toBe(0);
  });

  it('§4.1 reads a level marker and an anchor as the object forms, with their hash', () => {
    const marked = repository("'guide.adoc:== Install'");
    marked.run('update', 'CLAUDE.md');
    const titled = repository("{ path: 'guide.adoc', select: { title: 'Install', level: 2 } }");
    titled.run('update', 'CLAUDE.md');
    expect(marked.lock()).toBe(titled.lock());
    const anchored = repository("'guide.adoc:#install'");
    anchored.run('update', 'CLAUDE.md');
    const written = repository("{ path: 'guide.adoc', select: { anchor: 'install' } }");
    written.run('update', 'CLAUDE.md');
    expect(anchored.lock()).toBe(written.lock());
  });

  it('§4.1 reports a marker without a title as E_SELECT', () => {
    const result = repository("'guide.adoc:== '").run();
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_SELECT');
    expect(result.stderr).toContain('invalid-selector');
  });

  it('§3 meta.schema reports an unknown key as E_SELECT', () => {
    const result = repository(
      "{ path: 'guide.adoc', select: { title: 'Install', heading: 'x' } }",
    ).run();
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_SELECT');
    expect(result.stderr).toContain('/heading');
  });
});
