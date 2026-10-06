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
const docsync = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const CONFIG = 'version: 1\ndependents:\n  CLAUDE.md:\n    covers: [src/**]\n';
const repo = () => makeTree({ 'docsync.yaml': CONFIG, 'CLAUDE.md': '# doc\n', 'src/a.ts': 'a\n' });

describe('§13 workflow', () => {
  it('unrecorded -> write -> ok -> edit -> stale -> write -> ok', () => {
    const root = repo();
    expect(docsync(root).code).toBe(1);
    expect(docsync(root, '--write', 'CLAUDE.md')).toMatchObject({
      code: 0,
      out: 'written  CLAUDE.md\n',
    });
    expect(docsync(root)).toMatchObject({ code: 0, out: '1 ok, 0 stale, 0 invalid\n' });
    appendFileSync(join(root, 'src/a.ts'), 'b\n');
    const stale = docsync(root);
    expect(stale.code).toBe(1);
    expect(stale.out).toContain('STALE    CLAUDE.md  (content-changed)');
    expect(docsync(root, '--write', 'CLAUDE.md').code).toBe(0);
    expect(docsync(root).code).toBe(0);
  });

  it('rename of a covered file is stale', () => {
    const root = repo();
    docsync(root, '--write', '--all');
    renameSync(join(root, 'src/a.ts'), join(root, 'src/b.ts'));
    expect(docsync(root).code).toBe(1);
  });

  it('editing the dependent itself does not make it stale', () => {
    const root = repo();
    docsync(root, '--write', '--all');
    appendFileSync(join(root, 'CLAUDE.md'), 'more\n');
    expect(docsync(root).code).toBe(0);
  });

  it('runs from a subdirectory and resolves file args against cwd', () => {
    const root = repo();
    expect(docsync(join(root, 'src'), '--write', '../CLAUDE.md').code).toBe(0);
  });

  it('missing dependent is exit 2, others still evaluated', () => {
    const root = makeTree({
      'docsync.yaml': `${CONFIG}  GONE.md:\n    covers: [src/**]\n`,
      'CLAUDE.md': '',
      'src/a.ts': '',
    });
    const r = docsync(root, '--json');
    expect(r.code).toBe(2);
    const doc = JSON.parse(r.out);
    expect(doc.dependents.map((d: { state: string }) => d.state)).toEqual(['stale', 'invalid']);
  });

  it('write refuses on lock conflict markers and writes nothing', () => {
    const root = repo();
    writeFileSync(join(root, 'docsync-lock.yaml'), '<<<<<<< HEAD\n');
    const r = docsync(root, '--write', 'CLAUDE.md');
    expect(r.code).toBe(2);
    expect(r.err).toContain('E_LOCK');
    expect(readFileSync(join(root, 'docsync-lock.yaml'), 'utf8')).toBe('<<<<<<< HEAD\n');
  });

  it('--write --all recovers from a corrupt lock', () => {
    const root = repo();
    writeFileSync(join(root, 'docsync-lock.yaml'), 'garbage: [');
    expect(docsync(root, '--write', '--all').code).toBe(0);
    expect(docsync(root).code).toBe(0);
  });

  it('§11.1 a legacy docsync.lock is E_LOCK_VERSION until deleted', () => {
    const root = repo();
    writeFileSync(join(root, 'docsync.lock'), 'version: 1\ndependents: {}\n');
    const check = docsync(root);
    expect(check.code).toBe(2);
    expect(check.err).toContain('E_LOCK_VERSION: docsync.lock');
    expect(check.err).toContain('delete docsync.lock');
    expect(docsync(root, '--write', 'CLAUDE.md').code).toBe(2);
  });

  it('§13.6 --write --all writes the new lock but leaves docsync.lock in place', () => {
    const root = repo();
    writeFileSync(join(root, 'docsync.lock'), 'version: 1\ndependents: {}\n');
    expect(docsync(root, '--write', '--all').code).toBe(0);
    expect(readFileSync(join(root, 'docsync-lock.yaml'), 'utf8')).toMatch(/^version: 2\n/u);
    expect(existsSync(join(root, 'docsync.lock'))).toBe(true);
    expect(docsync(root).code).toBe(2);
    rmSync(join(root, 'docsync.lock'));
    expect(docsync(root).code).toBe(0);
  });

  it('usage error exits 2 before root discovery', () => {
    expect(docsync('/', '--bogus')).toMatchObject({ code: 2 });
  });

  it('no config is E_CONFIG_MISSING', () => {
    const r = docsync(makeTree({ x: '' }), '--json');
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out).diagnostics[0].code).toBe('E_CONFIG_MISSING');
  });

  it('output is deterministic across runs', () => {
    const root = repo();
    expect(docsync(root, '--json').out).toBe(docsync(root, '--json').out);
  });
});
