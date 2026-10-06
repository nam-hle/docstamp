import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoizeHash, run, type Io } from '../../src/cli/run.ts';
import { Raised, diag } from '../../src/core/diagnostics.ts';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';

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

const CONFIG = 'version: 1\ndependents:\n  doc.md:\n    covers:\n      - src/**\n';

function exec(cwd: string, ...argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const io: Io = {
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
    isTty: false,
    env: {},
  };
  return { code: run(argv, cwd, io), out, err };
}

const tree = () => makeTree({ 'docsync.yaml': CONFIG, 'doc.md': 'x', 'src/a.ts': 'a' });

describe('§13.5 check', () => {
  it('unrecorded is stale, exit 1, next line on stdout', () => {
    const r = exec(tree(), '--root', '.');
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE    doc.md  (unrecorded)\n  covers  src/**\n');
    expect(r.out).toContain('docsync update doc.md --root .\n');
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
    expect(r.out).not.toContain('  file ');
  });
  it('removed --write and --files exit 2 naming the replacement', () => {
    const write = exec(tree(), '--write', 'doc.md');
    expect(write.code).toBe(2);
    expect(write.err).toContain('E_USAGE: --write: ');
    expect(write.err).toContain('docsync update');
    const files = exec(tree(), '--files');
    expect(files.code).toBe(2);
    expect(files.err).toContain('docsync list-dependents');
    expect(files.out).toBe('');
  });
  it('unknown dependent is exit 2 on stderr', () => {
    const r = exec(tree(), 'nope.md');
    expect(r.code).toBe(2);
    expect(r.err).toContain('error: E_UNKNOWN_DEPENDENT: nope.md: ');
    expect(r.out).toBe('0 ok, 0 stale, 0 invalid\n');
  });
  it('missing config raises: text summary still printed', () => {
    const r = exec(makeTree({}), '--root', '.');
    expect(r.code).toBe(2);
    expect(r.out).toBe('0 ok, 0 stale, 0 invalid\n');
    expect(r.err).toContain('E_CONFIG_MISSING');
  });
  it('--json puts one document on stdout and nothing on stderr', () => {
    const r = exec(tree(), '--json', 'nope.md');
    expect(r.code).toBe(2);
    expect(r.err).toBe('');
    expect(JSON.parse(r.out).diagnostics[0].code).toBe('E_UNKNOWN_DEPENDENT');
  });
  it('a symlinked Dependent is invalid', () => {
    const root = makeTree({
      'docsync.yaml': CONFIG,
      'real.md': 'x',
      'doc.md': { link: 'real.md' },
      'src/a.ts': 'a',
    });
    const r = exec(root);
    expect(r.code).toBe(2);
    expect(r.out).toContain('INVALID  doc.md\n');
    expect(r.err).toContain('E_DEPENDENT_MISSING');
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
    expect(doc.dependents[0].written).toBe(true);
    expect(doc.removed).toEqual([]);
  });
  it('strict write fails on a broken lock; --all recovers', () => {
    const root = tree();
    writeFileSync(join(root, 'docsync-lock.yaml'), '<<<<<<< garbage\n');
    const strict = exec(root, 'update', 'doc.md');
    expect(strict.code).toBe(2);
    expect(strict.err).toContain('E_LOCK');
    expect(exec(root, 'update', '--all').out).toBe('written  doc.md\n');
    expect(exec(root).code).toBe(0);
  });
  it('a lock that is a directory is E_LOCK on check', () => {
    const root = tree();
    mkdirSync(join(root, 'docsync-lock.yaml'));
    const r = exec(root);
    expect(r.code).toBe(2);
    expect(r.err).toContain('E_LOCK');
  });
  it('update --all with a directory lock reports E_UNREADABLE, not a crash', () => {
    const root = tree();
    mkdirSync(join(root, 'docsync-lock.yaml'));
    const r = exec(root, 'update', '--all');
    expect(r.code).toBe(2);
    expect(r.err).toContain('E_UNREADABLE: docsync-lock.yaml');
    expect(readdirSync(root).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });
  it('removes orphans', () => {
    const root = tree();
    exec(root, 'update', 'doc.md');
    writeFileSync(
      join(root, 'docsync.yaml'),
      'version: 1\ndependents:\n  other.md:\n    covers: [src/**]\n',
    );
    writeFileSync(join(root, 'other.md'), 'o');
    const check = exec(root);
    expect(check.err).toContain('warning: W_ORPHAN');
    const r = exec(root, 'update', '--all');
    expect(r.out).toBe('written  other.md\nremoved  doc.md\n');
  });
});

describe('§13.7 list-dependents', () => {
  const list = 'list-dependents';
  it('lists patterns and covered files per Dependent, exit 0, without a lock', () => {
    const r = exec(tree(), list);
    expect(r).toEqual({ code: 0, out: 'doc.md\n  covers  src/**\n  file    src/a.ts\n', err: '' });
  });
  it('lists only the named Dependents', () => {
    const root = makeTree({
      'docsync.yaml': `${CONFIG}  b.md:\n    covers: [src/**]\n`,
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
    writeFileSync(join(root, 'docsync-lock.yaml'), '<<<<<<< garbage\n');
    const r = exec(root, list);
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
  });
  it('an invalid Dependent prints its header and diagnostics, exit 2', () => {
    const root = makeTree({ 'docsync.yaml': CONFIG, 'src/a.ts': 'a' });
    const r = exec(root, list);
    expect(r.code).toBe(2);
    expect(r.out).toBe('doc.md\n');
    expect(r.err).toContain('E_DEPENDENT_MISSING: doc.md');
  });
  it('an unknown Dependent is exit 2', () => {
    const r = exec(tree(), list, 'nope.md');
    expect(r.code).toBe(2);
    expect(r.err).toContain('E_UNKNOWN_DEPENDENT: nope.md');
  });
  it('--json has the list-dependents shape and nothing on stderr', () => {
    const r = exec(tree(), list, '--json');
    expect(r.err).toBe('');
    expect(JSON.parse(r.out)).toEqual({
      version: 1,
      mode: 'list-dependents',
      exitCode: 0,
      dependents: [
        { dependent: 'doc.md', covers: ['src/**'], files: ['src/a.ts'], diagnostics: [] },
      ],
      diagnostics: [],
    });
  });
  it('--json on a raised error has empty dependents', () => {
    const r = exec(makeTree({}), list, '--json', '--root', '.');
    const doc = JSON.parse(r.out);
    expect(r.code).toBe(2);
    expect(doc.dependents).toEqual([]);
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
    expect(exec(tree(), '--help').out).toContain('Usage:');
    const v = exec(tree(), '--version');
    expect(v.code).toBe(0);
    expect(v.out).toMatch(/^\S+\n$/u);
    expect(exec(tree(), 'help').out).toBe(exec(tree(), '--help').out);
    expect(exec(tree(), 'version').out).toBe(v.out);
  });
});
