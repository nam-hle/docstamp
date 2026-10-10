import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const PLUGIN = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const CLI = fileURLToPath(new URL('../../../docstamp/dist/index.js', import.meta.url));

const API = [
  'export function createUser(name: string): User {',
  '  return { name };',
  '}',
  '',
  'export function removeUser(id: number): void {',
  '  store.delete(id);',
  '}',
  '',
].join('\n');

const dirs: string[] = [];

// A repository whose CLAUDE.md depends on one declaration of api.ts, through the built plugin.
function repository(entry: string, api = API) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'docstamp-js-')));
  dirs.push(root);
  const write = (path: string, text: string) => {
    writeFileSync(join(root, path), text);
  };
  write('CLAUDE.md', '# Agent notes\n');
  write('docstamp.config.mjs', config(entry));
  write('api.ts', api);
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
    if (!existsSync(path)) throw new Error(`${path} is not built: run pnpm nadle testJs`);
  }
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('§8 the plugin through the docstamp CLI', () => {
  const CREATE = "{ path: 'api.ts', select: 'createUser' }";

  it('is stale until reviewed, then ok', () => {
    const { run } = repository(CREATE);
    expect(run().exit).toBe(1);
    expect(run('update', 'CLAUDE.md').exit).toBe(0);
    expect(run().exit).toBe(0);
  });

  it('stays ok for a changed body or another declaration, and goes stale for a changed signature', () => {
    const { run, write } = repository(CREATE);
    run('update', 'CLAUDE.md');
    write('api.ts', API.replace('return { name };', 'return { name, id: 1 };'));
    expect(run().exit).toBe(0);
    write('api.ts', API.replace('store.delete(id);', 'store.remove(id);'));
    expect(run().exit).toBe(0);
    const stale = repository(CREATE);
    stale.run('update', 'CLAUDE.md');
    stale.write('api.ts', API.replace('name: string', 'name: string, age: number'));
    expect(stale.run().exit).toBe(1);
  });

  it('goes stale for a changed body when the part is source', () => {
    const { run, write } = repository(
      "{ path: 'api.ts', select: { name: 'createUser', part: 'source' } }",
    );
    run('update', 'CLAUDE.md');
    write('api.ts', API.replace('return { name };', 'return { name, id: 1 };'));
    expect(run().exit).toBe(1);
  });

  it('reports a declaration that is not there as E_SELECT_NOT_FOUND', () => {
    const { run } = repository("{ path: 'api.ts', select: 'missing' }");
    const result = run();
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_SELECT_NOT_FOUND');
  });

  it('is ambiguous for a function and an interface of one name, until a kind picks one', () => {
    const both = `${API}\ninterface createUser { x: number }\n`;
    const ambiguous = repository(CREATE, both).run();
    expect(ambiguous.exit).toBe(2);
    expect(ambiguous.stderr).toContain('E_SELECT');
    expect(ambiguous.stderr).toContain('add a kind');

    const picked = repository(
      "{ path: 'api.ts', select: { name: 'createUser', kind: 'function' } }",
      both,
    );
    expect(picked.run('update', 'CLAUDE.md').exit).toBe(0);
    picked.write('api.ts', both.replace('x: number', 'x: string'));
    expect(picked.run().exit).toBe(0);
  });

  it('takes the overloads and the implementation of a function for one dependency', () => {
    const overloaded = [
      'export function pick(a: string): string;',
      'export function pick(a: number): number;',
      'export function pick(a: unknown) {',
      '  return a;',
      '}',
      '',
    ].join('\n');
    const { run, write } = repository("{ path: 'api.ts', select: 'pick' }", overloaded);
    expect(run('update', 'CLAUDE.md').exit).toBe(0);
    write('api.ts', overloaded.replace('a: number): number', 'a: boolean): boolean'));
    expect(run().exit).toBe(1);
  });

  it('reports an invalid selector and a file that does not parse as E_SELECT', () => {
    const invalid = repository(
      "{ path: 'api.ts', select: { name: 'createUser', kind: 'method' } }",
    ).run();
    expect(invalid.exit).toBe(2);
    expect(invalid.stderr).toContain('E_SELECT');

    const broken = repository(CREATE, 'export function (').run();
    expect(broken.exit).toBe(2);
    expect(broken.stderr).toContain('E_SELECT');
  });
});
