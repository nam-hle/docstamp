import { execFileSync } from 'node:child_process';
import { parseLog, parseNameList, parseNameStatus, parseTree } from './git-output.ts';
import type { Git, LogWindow } from './git.ts';
import type { Clock } from './host.ts';

// SPEC §12.3 step 1: no inherited repository or index selection, nothing written
const gitEnv = (): NodeJS.ProcessEnv => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  return { ...env, GIT_OPTIONAL_LOCKS: '0' };
};

// SPEC §12.3 step 1: the work tree is compared byte for byte, whatever the user's line ending setup
const PINNED = ['-c', 'core.autocrlf=false'];
const LITERAL = ['--literal-pathspecs'];
const MODES = /^:(\d+) (\d+) /u;

const windowArgs = (window: LogWindow): string[] =>
  'maxAge' in window ? [`--max-age=${window.maxAge}`, 'HEAD'] : [`${window.after}..HEAD`];

// SPEC §12.3 steps 1 to 10, §12.4, §12.7: git run in `root`, read-only, with no shell
export function nodeGit(root: string): Git {
  const run = (args: readonly string[], input?: string): string =>
    execFileSync('git', [...PINNED, ...args], {
      cwd: root,
      env: gitEnv(),
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
      ...(input === undefined ? {} : { input }),
    });
  // git reads --stdin-paths from the top level of the work tree, not from Root
  const prefix = (): string => run(['rev-parse', '--show-prefix']).replace(/\r?\n$/u, '');

  return {
    isShallow: () => run(['rev-parse', '--is-shallow-repository']).trim() !== 'false',
    hasCommit: () => {
      try {
        run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
        return true;
      } catch {
        return false;
      }
    },
    resolve: (rev) => {
      try {
        return run(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).trim();
      } catch {
        return null;
      }
    },
    pickaxe: (path, needle) =>
      run(['log', '--format=%H', `-S${needle}`, '--', path])
        .split('\n')
        .filter((line) => line !== ''),
    fileAt: (rev, path) => run(['show', `${rev}:./${path}`]),
    lastCommitTouching: (path) =>
      run([...LITERAL, 'log', '-1', '--format=%H', '--', path]).trim() || null,
    objectAt: (rev, path) =>
      parseTree(run([...LITERAL, 'ls-tree', '-z', rev, '--', path])).get(path) ?? null,
    objectsAt: (rev) => parseTree(run(['ls-tree', '-r', '-z', rev])),
    hashWorkFiles: (paths) => {
      if (paths.length === 0) return [];
      const lead = prefix();
      const input = paths.map((path) => `${lead}${path}\n`).join('');
      return run(['hash-object', '--stdin-paths'], input)
        .split('\n')
        .slice(0, paths.length)
        .map((object) => object.trim());
    },
    changesSince: (rev) =>
      parseNameStatus(
        run(['diff', '--name-status', '--no-renames', '-z', '--relative', rev, '--']),
      ),
    untracked: () => parseNameList(run(['ls-files', '--others', '--exclude-standard', '-z'])),
    isWhitespaceOnly: (rev, path) => {
      const diff = (...options: string[]) => run([...LITERAL, 'diff', ...options, rev, '--', path]);
      try {
        diff('--ignore-all-space', '--ignore-blank-lines', '--quiet');
        const modes = MODES.exec(diff('--raw', '--no-renames'));
        return modes === null || modes[1] === modes[2];
      } catch {
        return false;
      }
    },
    log: (window) =>
      parseLog(
        run([
          'log',
          '--no-merges',
          '--no-renames',
          '--no-show-signature',
          '--relative',
          '--name-only',
          '-z',
          '--format=%x01%H%x00%ct',
          ...windowArgs(window),
        ]),
      ),
  };
}

export const systemClock: Clock = { now: () => Date.now() };
