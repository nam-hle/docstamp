import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';

afterEach(cleanupTrees);

process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
process.env['GIT_CONFIG_NOSYSTEM'] = '1';

const BIN = resolve('dist/index.js');
const docsync = (cwd: string, ...args: string[]) => docsyncEnv(cwd, {}, ...args);
const docsyncEnv = (cwd: string, env: Record<string, string>, ...args: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
const put = (root: string, rel: string, content: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
};
const commit = (cwd: string, message: string) => {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-m', message);
};

const CONFIG = 'version: 1\ndependents:\n  CLAUDE.md:\n    covers: [src/**]\n';
const FILES = {
  'docsync.yaml': CONFIG,
  'CLAUDE.md': '# doc\n',
  'src/a.ts': 'a\n',
  'src/c.ts': 'c\n',
  'src/d.ts': 'd\n',
};

function reviewedRepo(): string {
  const root = makeTree(FILES);
  git(root, 'init', '-q');
  commit(root, 'initial');
  expect(docsync(root, 'update', 'CLAUDE.md').code).toBe(0);
  commit(root, 'review');
  return root;
}

function changeEverything(root: string): void {
  appendFileSync(join(root, 'src/a.ts'), 'more\n');
  put(root, 'src/new.ts', 'n\n');
  rmSync(join(root, 'src/c.ts'));
  commit(root, 'edits');
  appendFileSync(join(root, 'src/d.ts'), 'more\n');
  put(root, 'src/untracked.ts', 'u\n');
}

const EXPECTED_TEXT =
  'STALE    CLAUDE.md  (content-changed)\n' +
  '  modified  src/a.ts\n' +
  '  deleted   src/c.ts\n' +
  '  modified  src/d.ts\n' +
  '  added     src/new.ts\n' +
  '  added     src/untracked.ts\n' +
  '0 ok, 1 stale, 0 invalid\n';

describe('§12.3 ChangedSince', () => {
  it('lists modified, added and deleted files, committed and not', () => {
    const root = reviewedRepo();
    changeEverything(root);
    const r = docsync(root);
    expect(r.code).toBe(1);
    expect(r.out.startsWith(EXPECTED_TEXT)).toBe(true);
    expect(r.out).not.toContain('covers');
  });

  it('reports changes in JSON, without a files member', () => {
    const root = reviewedRepo();
    changeEverything(root);
    const doc = JSON.parse(docsync(root, '--json').out);
    expect(doc.dependents[0].changes).toEqual([
      { status: 'modified', path: 'src/a.ts' },
      { status: 'deleted', path: 'src/c.ts' },
      { status: 'modified', path: 'src/d.ts' },
      { status: 'added', path: 'src/new.ts' },
      { status: 'added', path: 'src/untracked.ts' },
    ]);
    expect('files' in doc.dependents[0]).toBe(false);
  });

  it('survives a rewrite of the review commit', () => {
    const root = makeTree(FILES);
    git(root, 'init', '-q');
    commit(root, 'initial');
    docsync(root, 'update', 'CLAUDE.md');
    commit(root, 'review');
    const before = git(root, 'rev-parse', 'HEAD');
    git(root, 'commit', '--amend', '-q', '-m', 'x');
    expect(git(root, 'rev-parse', 'HEAD')).not.toBe(before);
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    expect(docsync(root).out).toContain('  modified  src/a.ts\n');
  });

  it('works when Root is below the top level of the work tree', () => {
    const top = makeTree({ 'outside.txt': 'o\n' });
    const root = join(top, 'pkg');
    for (const [rel, content] of Object.entries(FILES)) put(root, rel, content);
    git(top, 'init', '-q');
    commit(top, 'initial');
    docsync(root, 'update', 'CLAUDE.md');
    commit(top, 'review');
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    appendFileSync(join(top, 'outside.txt'), 'more\n');
    expect(docsync(root).out).toContain(
      'STALE    CLAUDE.md  (content-changed)\n  modified  src/a.ts\n0 ok',
    );
  });

  it('does not change the exit code', () => {
    const root = reviewedRepo();
    const plain = makeTree(FILES);
    docsync(plain, 'update', 'CLAUDE.md');
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    appendFileSync(join(plain, 'src/a.ts'), 'more\n');
    expect(docsync(root).code).toBe(docsync(plain).code);
  });

  it('falls back to covers lines outside a git work tree', () => {
    const root = makeTree(FILES);
    docsync(root, 'update', 'CLAUDE.md');
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    const r = docsync(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain('  covers  src/**\n');
    expect(JSON.parse(docsync(root, '--json').out).dependents[0].changes).toBeNull();
  });

  it('is unknown when the written lock was never committed', () => {
    const root = makeTree(FILES);
    git(root, 'init', '-q');
    commit(root, 'initial');
    docsync(root, 'update', 'CLAUDE.md');
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    const r = docsync(root);
    expect(r.out).toContain('  covers  src/**\n');
    expect(JSON.parse(docsync(root, '--json').out).dependents[0].changes).toBeNull();
  });

  it('is null for ok dependents', () => {
    const root = reviewedRepo();
    expect(JSON.parse(docsync(root, '--json').out).dependents[0].changes).toBeNull();
  });

  it('ignores a sibling Dependent that removed the same Hash later', () => {
    const root = makeTree({
      ...FILES,
      'docsync.yaml': `${CONFIG}  B.md:\n    covers: [src/**]\n`,
      'B.md': '# b\n',
      'src/x.ts': 'x\n',
      'src/y.ts': 'y\n',
    });
    git(root, 'init', '-q');
    commit(root, 'initial');
    docsync(root, 'update', '--all');
    commit(root, 'review');
    appendFileSync(join(root, 'src/x.ts'), 'more\n');
    commit(root, 'x');
    appendFileSync(join(root, 'src/y.ts'), 'more\n');
    docsync(root, 'update', 'B.md');
    commit(root, 'review b');
    put(root, 'src/z.ts', 'z\n');
    const doc = JSON.parse(docsync(root, '--json').out);
    const a = doc.dependents.find((d: { dependent: string }) => d.dependent === 'CLAUDE.md');
    expect(a.changes.map((c: { path: string }) => c.path)).toEqual([
      'src/x.ts',
      'src/y.ts',
      'src/z.ts',
    ]);
  });

  it('is unknown in a shallow clone', () => {
    const source = reviewedRepo();
    const clone = join(makeTree({}), 'clone');
    git(source, 'clone', '-q', '--depth', '1', `file://${source}`, clone);
    appendFileSync(join(clone, 'src/a.ts'), 'more\n');
    const r = docsync(clone, '--json');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).dependents[0].changes).toBeNull();
  });

  it('ignores an inherited GIT_DIR', () => {
    const root = reviewedRepo();
    const foreign = reviewedRepo();
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    const r = docsyncEnv(root, { GIT_DIR: join(foreign, '.git') }, '--json');
    expect(JSON.parse(r.out).dependents[0].changes).toEqual([
      { status: 'modified', path: 'src/a.ts' },
    ]);
  });

  it('survives a real rebase of the review commit', () => {
    const root = makeTree(FILES);
    git(root, 'init', '-q', '-b', 'main');
    commit(root, 'initial');
    git(root, 'checkout', '-q', '-b', 'feat');
    docsync(root, 'update', 'CLAUDE.md');
    commit(root, 'review');
    const before = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-q', 'main');
    put(root, 'other.txt', 'o\n');
    commit(root, 'other');
    git(root, 'checkout', '-q', 'feat');
    git(root, 'rebase', '-q', 'main');
    expect(git(root, 'rev-parse', 'HEAD')).not.toBe(before);
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    expect(docsync(root).out).toContain('  modified  src/a.ts\n');
  });

  it('treats a version 1 lock in history as absent, never an error', () => {
    const root = makeTree(FILES);
    git(root, 'init', '-q');
    commit(root, 'initial');
    docsync(root, 'update', 'CLAUDE.md');
    const v2 = readFileSync(join(root, 'docsync-lock.yaml'), 'utf8');
    const v1 = `version: 1\ndependents:\n  CLAUDE.md:\n    covers: [src/**]\n    hash: ${'b'.repeat(64)}\n`;
    put(root, 'docsync-lock.yaml', v1);
    put(root, 'docsync.lock', v1);
    commit(root, 'v1');
    rmSync(join(root, 'docsync.lock'));
    put(root, 'docsync-lock.yaml', v2);
    commit(root, 'v2');
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    const r = docsync(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain('  modified  src/a.ts\n');
    expect(r.err).toBe('');
  });

  it('is unknown, not an error, when only a legacy docsync.lock holds the Hash', () => {
    const root = makeTree(FILES);
    git(root, 'init', '-q');
    commit(root, 'initial');
    docsync(root, 'update', 'CLAUDE.md');
    const hash = /[0-9a-f]{64}/u.exec(readFileSync(join(root, 'docsync-lock.yaml'), 'utf8'))![0];
    rmSync(join(root, 'docsync-lock.yaml'));
    put(root, 'docsync.lock', `version: 1\ndependents:\n  CLAUDE.md:\n    hash: ${hash}\n`);
    commit(root, 'legacy');
    rmSync(join(root, 'docsync.lock'));
    docsync(root, 'update', 'CLAUDE.md');
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    const r = docsync(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain('  covers  src/**\n');
    expect(r.err).toBe('');
  });

  it('quotes a changed path with a space', () => {
    const root = makeTree({ ...FILES, 'src/my file.ts': 'm\n' });
    git(root, 'init', '-q');
    commit(root, 'initial');
    docsync(root, 'update', 'CLAUDE.md');
    commit(root, 'review');
    appendFileSync(join(root, 'src/my file.ts'), 'more\n');
    expect(docsync(root).out).toContain('  modified  "src/my file.ts"\n');
  });
});
