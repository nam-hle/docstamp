import { execFileSync } from 'node:child_process';

// SPEC §12.3 step 1: no inherited repository or index selection, nothing written
const gitEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  return { ...env, GIT_OPTIONAL_LOCKS: '0', ...extra };
};

// SPEC §12.3 step 1: the work tree is compared byte for byte, whatever the user's line ending setup
const PINNED = ['-c', 'core.autocrlf=false'];

export const git = (
  root: string,
  args: readonly string[],
  extraEnv: Record<string, string> = {},
  input?: string,
): string =>
  execFileSync('git', [...PINNED, ...args], {
    cwd: root,
    env: gitEnv(extraEnv),
    encoding: 'utf8',
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });
