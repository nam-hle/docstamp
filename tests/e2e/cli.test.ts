import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';

afterEach(cleanupTrees);

const BIN = resolve('dist/index.js');
const docstamp = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const CONFIG = 'version: 1\ndependents:\n  CLAUDE.md:\n    covers: [src/**]\n';
const repo = () => makeTree({ 'docstamp.yaml': CONFIG, 'CLAUDE.md': '# doc\n', 'src/a.ts': 'a\n' });

describe('§13 workflow', () => {
  it('unrecorded -> write -> ok -> edit -> stale -> write -> ok', () => {
    const root = repo();
    expect(docstamp(root).code).toBe(1);
    expect(docstamp(root, 'update', 'CLAUDE.md')).toMatchObject({
      code: 0,
      out: 'written  CLAUDE.md\n',
    });
    expect(docstamp(root)).toMatchObject({ code: 0, out: '1 ok, 0 stale, 0 invalid\n' });
    appendFileSync(join(root, 'src/a.ts'), 'b\n');
    const stale = docstamp(root);
    expect(stale.code).toBe(1);
    expect(stale.out).toContain('STALE    CLAUDE.md  (content-changed)');
    expect(docstamp(root, 'update', 'CLAUDE.md').code).toBe(0);
    expect(docstamp(root).code).toBe(0);
  });

  it('rename of a covered file is stale', () => {
    const root = repo();
    docstamp(root, 'update', '--all');
    renameSync(join(root, 'src/a.ts'), join(root, 'src/b.ts'));
    expect(docstamp(root).code).toBe(1);
  });

  it('editing the dependent itself does not make it stale', () => {
    const root = repo();
    docstamp(root, 'update', '--all');
    appendFileSync(join(root, 'CLAUDE.md'), 'more\n');
    expect(docstamp(root).code).toBe(0);
  });

  it('runs from a subdirectory and resolves file args against cwd', () => {
    const root = repo();
    expect(docstamp(join(root, 'src'), 'update', '../CLAUDE.md').code).toBe(0);
  });

  it('missing dependent is exit 2, others still evaluated', () => {
    const root = makeTree({
      'docstamp.yaml': `${CONFIG}  GONE.md:\n    covers: [src/**]\n`,
      'CLAUDE.md': '',
      'src/a.ts': '',
    });
    const r = docstamp(root, '--json');
    expect(r.code).toBe(2);
    const doc = JSON.parse(r.out);
    expect(doc.dependents.map((d: { state: string }) => d.state)).toEqual(['stale', 'invalid']);
  });

  it('write refuses on lock conflict markers and writes nothing', () => {
    const root = repo();
    writeFileSync(join(root, 'docstamp-lock.yaml'), '<<<<<<< HEAD\n');
    const r = docstamp(root, 'update', 'CLAUDE.md');
    expect(r.code).toBe(2);
    expect(r.err).toContain('E_LOCK');
    expect(readFileSync(join(root, 'docstamp-lock.yaml'), 'utf8')).toBe('<<<<<<< HEAD\n');
  });

  it('update --all recovers from a corrupt lock', () => {
    const root = repo();
    writeFileSync(join(root, 'docstamp-lock.yaml'), 'garbage: [');
    expect(docstamp(root, 'update', '--all').code).toBe(0);
    expect(docstamp(root).code).toBe(0);
  });

  it('§11.1 a legacy docsync.lock is E_LOCK_VERSION until deleted', () => {
    const root = repo();
    writeFileSync(join(root, 'docsync.lock'), 'version: 1\ndependents: {}\n');
    const check = docstamp(root);
    expect(check.code).toBe(2);
    expect(check.err).toContain('E_LOCK_VERSION: docsync.lock');
    expect(check.err).toContain('delete docsync.lock');
    expect(docstamp(root, 'update', 'CLAUDE.md').code).toBe(2);
  });

  it('§13.6 update --all writes the new lock but leaves docsync.lock in place', () => {
    const root = repo();
    writeFileSync(join(root, 'docsync.lock'), 'version: 1\ndependents: {}\n');
    expect(docstamp(root, 'update', '--all').code).toBe(0);
    expect(readFileSync(join(root, 'docstamp-lock.yaml'), 'utf8')).toMatch(/^version: 2\n/u);
    expect(existsSync(join(root, 'docsync.lock'))).toBe(true);
    expect(docstamp(root).code).toBe(2);
    rmSync(join(root, 'docsync.lock'));
    expect(docstamp(root).code).toBe(0);
  });

  it('§13.7 list-dependents works while a legacy docsync.lock is present', () => {
    const root = repo();
    writeFileSync(join(root, 'docsync.lock'), 'version: 1\ndependents: {}\n');
    expect(docstamp(root).code).toBe(2);
    expect(docstamp(root, 'list-dependents')).toEqual({
      code: 0,
      out: 'CLAUDE.md\n  covers  src/**\n  file    src/a.ts\n',
      err: '',
    });
    const json = JSON.parse(docstamp(root, 'list-dependents', '--json').out);
    expect(json.dependents[0].files).toEqual(['src/a.ts']);
  });

  it('§13.7 list-dependents exits 2 for an invalid Dependent', () => {
    const root = makeTree({ 'docstamp.yaml': CONFIG, 'src/a.ts': 'a\n' });
    const r = docstamp(root, 'list-dependents');
    expect(r.code).toBe(2);
    expect(r.out).toBe('CLAUDE.md\n');
    expect(r.err).toContain('E_DEPENDENT_MISSING');
  });

  it('§13.2 explicit check equals bare check; a file named check is reachable', () => {
    const root = repo();
    expect(docstamp(root, 'check')).toEqual(docstamp(root));
    expect(docstamp(root, 'check', '--', 'check').err).toContain('E_UNKNOWN_DEPENDENT: check');
  });

  it('§13.2 removed options exit 2 naming the replacement', () => {
    const root = repo();
    expect(docstamp(root, '--write', 'CLAUDE.md').err).toContain('docstamp update');
    expect(docstamp(root, '--files').err).toContain('docstamp list-dependents');
    expect(docstamp(root, 'update').code).toBe(2);
  });

  it('usage error exits 2 before root discovery', () => {
    expect(docstamp('/', '--bogus')).toMatchObject({ code: 2 });
  });

  it('no config is E_CONFIG_MISSING', () => {
    const r = docstamp(makeTree({ x: '' }), '--json');
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out).diagnostics[0].code).toBe('E_CONFIG_MISSING');
  });

  it('§9.5 a docstamp.config.ts carrier drives the whole workflow', () => {
    const root = makeTree({
      'docstamp.config.ts': `interface C { version: 1 }
const config: C & object = {
  version: 1,
  dependents: { 'CLAUDE.md': { covers: ['src/**'] } },
};
export default config;
`,
      'CLAUDE.md': '# doc\n',
      'src/a.ts': 'a\n',
    });
    expect(docstamp(root).code).toBe(1);
    expect(docstamp(root, 'update', 'CLAUDE.md')).toMatchObject({ code: 0 });
    expect(docstamp(root)).toMatchObject({ code: 0, out: '1 ok, 0 stale, 0 invalid\n' });
    appendFileSync(join(root, 'src/a.ts'), 'b\n');
    expect(docstamp(join(root, 'src')).code).toBe(1);
  });

  it('§9.3 two configuration files are E_CONFIG_AMBIGUOUS', () => {
    const root = makeTree({ 'docstamp.yaml': CONFIG, 'docstamp.config.mjs': 'export default {}' });
    const r = docstamp(root, '--json');
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out).diagnostics[0]).toMatchObject({
      code: 'E_CONFIG_AMBIGUOUS',
      subject: 'docstamp.yaml, docstamp.config.mjs',
    });
  });

  it('output is deterministic across runs', () => {
    const root = repo();
    expect(docstamp(root, '--json').out).toBe(docstamp(root, '--json').out);
  });
});
