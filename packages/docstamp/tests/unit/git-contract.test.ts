import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Git } from '../../src/host/git.ts';
import { nodeGit } from '../../src/host/node-git.ts';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';
import { memoryHost } from '../helpers/memory-fs.ts';

// The same history is made in a real repository and in the in-memory one, and every question of the
// Git port gets the same answer from both: object ids, commit ids and all. That is what lets the
// scenarios run on the fake.

type Op =
  | { write: string; content: string }
  | { remove: string }
  | { mode: string; to: number }
  | { commit: string; at: number }
  | { tag: string; rev: string };

const T0 = 1_767_225_600;
const HERMETIC = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Docstamp E2E',
  GIT_AUTHOR_EMAIL: 'e2e@example.invalid',
  GIT_COMMITTER_NAME: 'Docstamp E2E',
  GIT_COMMITTER_EMAIL: 'e2e@example.invalid',
};

interface Pair {
  real: Git;
  memory: Git;
  apply: (op: Op) => void;
}

function pair(): Pair {
  const root = makeTree({});
  const run = (args: string[], at?: number) =>
    execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...HERMETIC,
        ...(at === undefined
          ? {}
          : { GIT_AUTHOR_DATE: `${at} +0000`, GIT_COMMITTER_DATE: `${at} +0000` }),
      },
    });
  run(['init', '-q']);
  const host = memoryHost();
  return {
    real: nodeGit(root),
    memory: host.git(host.root),
    apply: (op) => {
      if ('write' in op) {
        mkdirSync(dirname(join(root, op.write)), { recursive: true });
        writeFileSync(join(root, op.write), op.content);
        host.fs.set(op.write, op.content);
      } else if ('remove' in op) {
        rmSync(join(root, op.remove), { recursive: true, force: true });
        host.fs.removeTree(op.remove);
      } else if ('mode' in op) {
        chmodSync(join(root, op.mode), op.to);
        host.fs.setMode(op.mode, op.to);
      } else if ('tag' in op) {
        run(['tag', op.tag, run(['rev-parse', op.rev]).trim()]);
        host.repo.tag(op.tag, op.rev);
      } else {
        run(['add', '-A']);
        run(['commit', '-q', '--no-verify', '--allow-empty', '-m', op.commit], op.at);
        host.repo.commit(op.commit, op.at);
      }
    },
  };
}

afterAll(cleanupTrees);

const history: Op[] = [
  { write: 'a.ts', content: 'one\ntwo\n' },
  { write: 'b.md', content: '# b\n' },
  { write: 'lib/x.ts', content: 'x\n' },
  { write: 'lib/deep/y.ts', content: 'y\n' },
  { write: '.gitignore', content: 'dist/\n*.log\n' },
  { write: 'dist/out.js', content: 'ignored\n' },
  { commit: 'base', at: T0 },
  { write: 'a.ts', content: 'one\ntwo\nthree\n' },
  { write: 'c.ts', content: 'c\n' },
  { remove: 'b.md' },
  { commit: 'second', at: T0 + 3600 },
  { write: 'docstamp-lock.yaml', content: 'version: 3\nfiles:\n  a.md: aaaa\n' },
  { commit: 'review', at: T0 + 86400 },
  { write: 'docstamp-lock.yaml', content: 'version: 3\nfiles:\n  a.md: bbbb\n' },
  { commit: 'review again', at: T0 + 172800 },
  { tag: 'v0.1', rev: 'HEAD~2' },
];

// what is left in the work tree after the history: edits, untracked and ignored files
const edits: Op[] = [
  { write: 'a.ts', content: 'one\ntwo\nthree\nfour\n' },
  { write: 'lib/x.ts', content: '  x  \n\n' },
  { remove: 'c.ts' },
  { write: 'new.ts', content: 'new\n' },
  { write: 'lib/deep/z.ts', content: 'z\n' },
  { write: 'dist/more.js', content: 'ignored\n' },
  { write: 'debug.log', content: 'ignored\n' },
  { remove: 'lib/deep/y.ts' },
];

describe('Git contract: a real repository and the in-memory one answer alike', () => {
  const built = pair();
  for (const op of [...history, ...edits]) built.apply(op);
  const { real, memory } = built;
  const both = <T>(ask: (git: Git) => T) => expect(ask(memory)).toEqual(ask(real));

  it('has a commit, is not shallow, and resolves revisions to the same ids', () => {
    both((git) => [git.hasCommit(), git.isShallow()]);
    for (const rev of [
      'HEAD',
      'HEAD^',
      'HEAD^^',
      'HEAD~2',
      'HEAD~4',
      'HEAD~5',
      'HEAD^^~2',
      'HEAD~9',
    ]) {
      both((git) => git.resolve(rev));
    }
    both((git) => git.resolve('not-a-revision'));
    both((git) => git.resolve('v0.1'));
    both((git) => git.resolve('v0.1^'));
    both((git) => git.resolve('v9'));
    both((git) => git.resolve('main'));
    both((git) => git.resolve('main~1'));
  });

  it('finds the commits whose change adds or removes a text, newest first', () => {
    both((git) => git.pickaxe('docstamp-lock.yaml', 'aaaa'));
    both((git) => git.pickaxe('docstamp-lock.yaml', 'bbbb'));
    both((git) => git.pickaxe('docstamp-lock.yaml', 'version: 3'));
    both((git) => git.pickaxe('a.ts', 'three'));
    both((git) => git.pickaxe('missing.ts', 'x'));
  });

  it('reads a file at a revision, and throws for one that is not there', () => {
    both((git) => git.fileAt('HEAD', 'docstamp-lock.yaml'));
    both((git) => git.fileAt('HEAD^^^', 'a.ts'));
    for (const git of [real, memory]) {
      expect(() => git.fileAt('HEAD^^^', 'docstamp-lock.yaml')).toThrow();
      expect(() => git.fileAt('nope', 'a.ts')).toThrow();
    }
  });

  it('names the last commit that touched a path', () => {
    for (const path of ['a.ts', 'b.md', 'c.ts', 'lib/x.ts', 'docstamp-lock.yaml', 'nothing']) {
      both((git) => git.lastCommitTouching(path));
    }
  });

  it('gives the object names of regular files, one path or all', () => {
    for (const rev of ['HEAD', 'HEAD^', 'HEAD^^^']) {
      both((git) => git.objectAt(rev, 'a.ts'));
      both((git) => [...git.objectsAt(rev)].sort(([x], [y]) => (x < y ? -1 : 1)));
    }
    both((git) => git.objectAt('HEAD', 'missing'));
  });

  it('hashes work tree files as git hashes a blob', () => {
    both((git) => git.hashWorkFiles(['a.ts', 'new.ts', 'lib/x.ts']));
    both((git) => git.hashWorkFiles([]));
  });

  it('lists the changes of the work tree against a revision', () => {
    for (const rev of ['HEAD', 'HEAD^', 'HEAD^^', 'HEAD^^^']) both((git) => git.changesSince(rev));
  });

  it('lists the untracked paths that are not ignored', () => {
    both((git) => git.untracked());
  });

  it('knows a white space change from a real one', () => {
    for (const path of ['lib/x.ts', 'a.ts', 'new.ts', 'missing.ts']) {
      both((git) => git.isWhitespaceOnly('HEAD', path));
    }
  });

  it('lists the commits of a window with the paths they touched', () => {
    both((git) => git.log({ maxAge: 0 }));
    both((git) => git.log({ maxAge: T0 + 86400 }));
    both((git) => git.log({ after: git.resolve('HEAD^^^')! }));
    both((git) => git.log({ maxAge: T0 + 10 ** 9 }));
  });
});

describe('Git contract: a repository with no commit', () => {
  const { real, memory } = pair();
  it('has no commit and resolves nothing', () => {
    for (const git of [real, memory]) {
      expect(git.hasCommit()).toBe(false);
      expect(git.resolve('HEAD')).toBeNull();
    }
  });
});

describe('Git contract: a deleted file that comes back', () => {
  const built = pair();
  for (const op of [
    { write: 'a.ts', content: '1\n' },
    { commit: 'base', at: T0 },
    { remove: 'a.ts' },
    { write: 'a.ts', content: '2\n' },
  ] satisfies Op[]) {
    built.apply(op);
  }
  it('is a change against the commit and the same path is not untracked', () => {
    expect(built.memory.changesSince('HEAD')).toEqual(built.real.changesSince('HEAD'));
    expect(built.memory.untracked()).toEqual(built.real.untracked());
  });
});

// A user's own git configuration must not change an answer (SPEC §12.3 step 1): real git only
describe.skipIf(process.platform === 'win32')('Git contract: the file mode', () => {
  const built = pair();
  for (const op of [
    { write: 'run.sh', content: 'echo\n' },
    { commit: 'base', at: T0 },
    { mode: 'run.sh', to: 0o755 },
  ] satisfies Op[]) {
    built.apply(op);
  }
  it('a change of mode is a change, and not a white space one', () => {
    expect(built.memory.changesSince('HEAD')).toEqual(built.real.changesSince('HEAD'));
    expect(built.real.isWhitespaceOnly('HEAD', 'run.sh')).toBe(false);
    expect(built.memory.isWhitespaceOnly('HEAD', 'run.sh')).toBe(false);
  });
});
