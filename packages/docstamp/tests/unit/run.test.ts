import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoizeHash, run, type Io } from '../../src/cli/run.ts';
import { Raised, diag } from '../../src/core/diagnostics.ts';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';
import { nodeHost } from '../../src/host/node-fs.ts';

afterEach(cleanupTrees);

describe('per-run hash cache', () => {
  it('hashes a shared file once across callers', () => {
    const calls: string[] = [];
    const hash = memoizeHash((p) => (calls.push(p), `h-${p}`));
    expect(hash('a')).toBe('h-a');
    expect(hash('a')).toBe('h-a');
    expect(calls).toEqual(['a']);
  });
  it('re-raises a cached failure on every call', () => {
    let calls = 0;
    const hash = memoizeHash((p) => {
      calls++;
      throw new Raised([diag('E_UNREADABLE', { subject: p })]);
    });
    expect(() => hash('a')).toThrow(Raised);
    expect(() => hash('a')).toThrow(Raised);
    expect(calls).toBe(1);
  });
});

const CONFIG = 'version: 2\nfiles:\n  doc.md:\n    dependencies:\n      - src/**\n';

function exec(cwd: string, ...argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = {
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
    isTty: false,
    env: {},
  };
  return { code: run(nodeHost, argv, cwd, io), out, err };
}

const tree = () => makeTree({ 'docstamp.yaml': CONFIG, 'doc.md': 'x', 'src/a.ts': 'a' });

describe('§13.5 check', () => {
  it('unrecorded is stale, exit 1, next line on stdout', () => {
    const r = exec(tree(), '--root', '.');
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE    doc.md  (unrecorded)\n  depends   src/**\n');
    expect(r.out).toContain('docstamp update doc.md --root .\n');
    expect(r.err).toBe('');
  });
  it('write then check is ok, change makes it stale', () => {
    const root = tree();
    expect(exec(root, 'update', 'doc.md').out).toBe('written  doc.md\n');
    expect(exec(root).code).toBe(0);
    writeFileSync(join(root, 'src/a.ts'), 'b');
    const r = exec(root, 'check');
    expect(r.code).toBe(1);
    expect(r.out).toContain('(content-changed)');
    expect(r.out).not.toContain('  resolved ');
  });
  it('removed --write and --files exit 2 naming the replacement', () => {
    const write = exec(tree(), '--write', 'doc.md');
    expect(write.code).toBe(2);
    expect(write.err).toContain('E_USAGE: --write: ');
    expect(write.err).toContain('docstamp update');
    const files = exec(tree(), '--files');
    expect(files.code).toBe(2);
    expect(files.err).toContain('docstamp list-dependencies');
    expect(files.out).toBe('');
  });
  it('unknown file is exit 2 on stderr', () => {
    const r = exec(tree(), 'nope.md');
    expect(r.code).toBe(2);
    expect(r.err).toContain('error: E_UNKNOWN_FILE: nope.md: ');
    expect(r.out).toBe('');
  });
  it('missing config raises: no summary line', () => {
    const r = exec(makeTree({}), '--root', '.');
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toContain('E_CONFIG_MISSING');
  });
  it('--json puts one document on stdout and nothing on stderr', () => {
    const r = exec(tree(), '--json', 'nope.md');
    expect(r.code).toBe(2);
    expect(r.err).toBe('');
    expect(JSON.parse(r.out).diagnostics[0].code).toBe('E_UNKNOWN_FILE');
  });
  it('§14.3.2 writes the Diagnostics of an invalid file right after its line', () => {
    const root = makeTree({
      'docstamp.yaml': `${CONFIG}  gone.md:\n    dependencies: [src/**]\n`,
      'doc.md': 'x',
      'src/a.ts': 'a',
    });
    const calls: string[] = [];
    const io: Io = {
      stdout: (s) => calls.push(`out: ${s.split('\n')[0]}`),
      stderr: (s) => calls.push(`err: ${s.split(':').slice(0, 3).join(':')}`),
      isTty: false,
      env: {},
    };
    expect(run(nodeHost, [], root, io)).toBe(2);
    expect(calls).toEqual([
      'out: STALE    doc.md  (unrecorded)',
      'out: INVALID  gone.md',
      'err: error: E_FILE_MISSING: gone.md',
      'out: 0 ok, 1 stale, 1 invalid',
      'out: next: review each stale file against its dependencies, then run: docstamp update doc.md',
      'out: next: fix the configuration of each invalid file, then run: docstamp check gone.md',
    ]);
  });
  it('a symlinked file is invalid', () => {
    const root = makeTree({
      'docstamp.yaml': CONFIG,
      'real.md': 'x',
      'doc.md': { link: 'real.md' },
      'src/a.ts': 'a',
    });
    const r = exec(root);
    expect(r.code).toBe(2);
    expect(r.out).toContain('INVALID  doc.md\n');
    expect(r.err).toContain('E_FILE_MISSING');
  });
});

describe('§13.6 update', () => {
  it('refused write outputs targets, exit 2, writes nothing', () => {
    const root = tree();
    const r = exec(root, 'update', 'nope.md');
    expect(r.code).toBe(2);
    expect(exec(root).code).toBe(1);
  });
  it('json write has written and removed', () => {
    const doc = JSON.parse(exec(tree(), 'update', '--json', 'doc.md').out);
    expect(doc.mode).toBe('update');
    expect(doc.files[0].written).toBe(true);
    expect(doc.removed).toEqual([]);
  });
  it('strict write fails on a broken lock; --all recovers', () => {
    const root = tree();
    writeFileSync(join(root, 'docstamp-lock.yaml'), '<<<<<<< garbage\n');
    const strict = exec(root, 'update', 'doc.md');
    expect(strict.code).toBe(2);
    expect(strict.err).toContain('E_LOCK');
    expect(exec(root, 'update', '--all').out).toBe('written  doc.md\n');
    expect(exec(root).code).toBe(0);
  });
  it('a version 2 lock names the migration; --all rewrites it as version 3', () => {
    const root = tree();
    exec(root, 'update', 'doc.md');
    const v3 = readFileSync(join(root, 'docstamp-lock.yaml'), 'utf8');
    writeFileSync(
      join(root, 'docstamp-lock.yaml'),
      v3.replace('version: 3\nfiles:', 'version: 2\ndependents:'),
    );
    const check = exec(root);
    expect(check.code).toBe(2);
    expect(check.err).toContain('E_LOCK_VERSION');
    expect(check.err).toContain('to rewrite it as version 3 (hashes are unchanged)');
    expect(exec(root, 'update', '--all').out).toBe('written  doc.md\n');
    expect(readFileSync(join(root, 'docstamp-lock.yaml'), 'utf8')).toBe(v3);
    expect(exec(root).code).toBe(0);
  });
  it('a lock that is a directory is E_LOCK on check', () => {
    const root = tree();
    mkdirSync(join(root, 'docstamp-lock.yaml'));
    const r = exec(root);
    expect(r.code).toBe(2);
    expect(r.err).toContain('E_LOCK');
  });
  it('update --all with a directory lock reports E_UNREADABLE, not a crash', () => {
    const root = tree();
    mkdirSync(join(root, 'docstamp-lock.yaml'));
    const r = exec(root, 'update', '--all');
    expect(r.code).toBe(2);
    expect(r.err).toContain('E_UNREADABLE: docstamp-lock.yaml');
    expect(readdirSync(root).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });
  it('removes orphans', () => {
    const root = tree();
    exec(root, 'update', 'doc.md');
    writeFileSync(
      join(root, 'docstamp.yaml'),
      'version: 2\nfiles:\n  other.md:\n    dependencies: [src/**]\n',
    );
    writeFileSync(join(root, 'other.md'), 'o');
    const check = exec(root);
    expect(check.err).toContain('warning: W_ORPHAN');
    const r = exec(root, 'update', '--all');
    expect(r.out).toBe('written  other.md\nremoved  doc.md\n');
  });
});

describe('§13.7 list-dependencies', () => {
  const list = 'list-dependencies';
  it('lists patterns and dependencies per file, exit 0, without a lock', () => {
    const r = exec(tree(), list);
    expect(r).toEqual({
      code: 0,
      out: 'doc.md\n  depends   src/**\n  resolved  src/a.ts\n',
      err: '',
    });
  });
  it('lists only the named files', () => {
    const root = makeTree({
      'docstamp.yaml': `${CONFIG}  b.md:\n    dependencies: [src/**]\n`,
      'doc.md': 'x',
      'b.md': 'y',
      'src/a.ts': 'a',
    });
    const named = exec(root, list, 'b.md').out;
    expect(named.startsWith('b.md\n')).toBe(true);
    expect(named).not.toContain('doc.md');
    expect(exec(root, list).out.startsWith('b.md\n')).toBe(true);
  });
  it('is not blocked by a legacy docsync.lock, a broken lock or an unrecorded tree', () => {
    const root = tree();
    writeFileSync(join(root, 'docsync.lock'), 'version: 1\ndependents: {}\n');
    writeFileSync(join(root, 'docstamp-lock.yaml'), '<<<<<<< garbage\n');
    const r = exec(root, list);
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
  });
  it('an invalid file prints its header and diagnostics, exit 2', () => {
    const root = makeTree({ 'docstamp.yaml': CONFIG, 'src/a.ts': 'a' });
    const r = exec(root, list);
    expect(r.code).toBe(2);
    expect(r.out).toBe('doc.md\n');
    expect(r.err).toContain('E_FILE_MISSING: doc.md');
  });
  it('an unknown file is exit 2', () => {
    const r = exec(tree(), list, 'nope.md');
    expect(r.code).toBe(2);
    expect(r.err).toContain('E_UNKNOWN_FILE: nope.md');
  });
  it('--json has the list-dependencies shape and nothing on stderr', () => {
    const r = exec(tree(), list, '--json');
    expect(r.err).toBe('');
    expect(JSON.parse(r.out)).toEqual({
      version: 2,
      mode: 'list-dependencies',
      exitCode: 0,
      files: [
        { file: 'doc.md', dependencies: ['src/**'], resolvedFiles: ['src/a.ts'], diagnostics: [] },
      ],
      diagnostics: [],
    });
  });
  it('--json on a raised error has empty files', () => {
    const r = exec(makeTree({}), list, '--json', '--root', '.');
    const doc = JSON.parse(r.out);
    expect(r.code).toBe(2);
    expect(doc.files).toEqual([]);
    expect(doc.diagnostics[0].code).toBe('E_CONFIG_MISSING');
  });
  it('--all is a usage error', () => {
    expect(exec(tree(), list, '--all').code).toBe(2);
  });
});

describe('§13.2 / §16 misc', () => {
  it('usage error exits 2', () => {
    const r = exec(tree(), '--bogus');
    expect(r.code).toBe(2);
    expect(r.err).toContain('E_USAGE');
  });
  it('help and version exit 0', () => {
    expect(exec(tree(), '--help').out).toContain('Commands:');
    expect(exec(tree(), 'help', 'bogus')).toMatchObject({ code: 2, out: '' });
    const v = exec(tree(), '--version');
    expect(v.code).toBe(0);
    expect(v.out).toMatch(/^\S+\n$/u);
    expect(exec(tree(), 'help').out).toBe(exec(tree(), '--help').out);
    expect(exec(tree(), 'version').out).toBe(v.out);
  });
});
