import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';

afterEach(cleanupTrees);

process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
process.env['GIT_CONFIG_NOSYSTEM'] = '1';

const BIN = resolve('dist/index.js');
const docsync = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
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
  expect(docsync(root, '--write', 'CLAUDE.md').code).toBe(0);
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

  it('reports changes in JSON, with files unaffected', () => {
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
    expect(doc.dependents[0].files).toBeNull();
  });

  it('survives a rewrite of the review commit', () => {
    const root = makeTree(FILES);
    git(root, 'init', '-q');
    commit(root, 'initial');
    docsync(root, '--write', 'CLAUDE.md');
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
    docsync(root, '--write', 'CLAUDE.md');
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
    docsync(plain, '--write', 'CLAUDE.md');
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    appendFileSync(join(plain, 'src/a.ts'), 'more\n');
    expect(docsync(root).code).toBe(docsync(plain).code);
  });

  it('falls back to covers lines outside a git work tree', () => {
    const root = makeTree(FILES);
    docsync(root, '--write', 'CLAUDE.md');
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
    docsync(root, '--write', 'CLAUDE.md');
    appendFileSync(join(root, 'src/a.ts'), 'more\n');
    const r = docsync(root);
    expect(r.out).toContain('  covers  src/**\n');
    expect(JSON.parse(docsync(root, '--json').out).dependents[0].changes).toBeNull();
  });

  it('is null for ok dependents', () => {
    const root = reviewedRepo();
    expect(JSON.parse(docsync(root, '--json').out).dependents[0].changes).toBeNull();
  });
});
