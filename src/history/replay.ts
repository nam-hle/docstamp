import { Raised, diag } from '../core/diagnostics.ts';
import type { CommitRecord } from '../engine/stats.ts';
import { git } from './git.ts';

export interface Window {
  readonly kind: 'days' | 'revision';
  readonly commits: readonly CommitRecord[];
}

const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const isHeader = (token: string): boolean =>
  token.startsWith('\u0001') && COMMIT_ID.test(token.slice(1));

// SPEC §12.4 step 5: `\u0001<id> NUL <seconds> NUL` then the paths, each ended by NUL
export function parseLog(output: string): CommitRecord[] | null {
  const tokens = output.split('\0');
  if (tokens.pop() !== '') return null;
  const commits: CommitRecord[] = [];
  let index = 0;
  while (index < tokens.length) {
    const seconds = tokens[index + 1];
    if (!isHeader(tokens[index]!) || seconds === undefined || !/^[0-9]+$/u.test(seconds)) {
      return null;
    }
    index += 2;
    const paths: string[] = [];
    while (index < tokens.length && !isHeader(tokens[index]!)) {
      const path = (
        paths.length === 0 ? tokens[index]!.replace(/^\n/u, '') : tokens[index]!
      ).normalize('NFC');
      if (path !== '') paths.push(path);
      index += 1;
    }
    const day = new Date(Number(seconds) * 1000).toISOString().slice(0, 10);
    commits.push({ day, paths });
  }
  return commits;
}

const history = (message: string, subject = '') =>
  new Raised([diag('E_HISTORY', { subject, message })]);

// SPEC §12.4
// SPEC §12.4 step 3: seconds, never a date for git to parse
export const daysRange = (days: number, now: number): string[] => [
  `--max-age=${now - days * 86400}`,
  'HEAD',
];

export type ReplayWindow =
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'from'; readonly value: string };

// SPEC §12.4
export function replay(root: string, window: ReplayWindow, now: number): Window {
  const run = (args: string[]) => git(root, args);
  try {
    if (run(['rev-parse', '--is-shallow-repository']).trim() !== 'false') {
      throw history('The repository is shallow; fetch its full history.');
    }
    run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  } catch (e) {
    if (e instanceof Raised) throw e;
    throw history(
      'Run docstamp stats with git installed, in a work tree that has at least one commit.',
    );
  }
  let range: string[];
  if (window.kind === 'days') range = daysRange(window.days, now);
  else {
    try {
      range = [
        `${run(['rev-parse', '--verify', '--quiet', `${window.value}^{commit}`]).trim()}..HEAD`,
      ];
    } catch {
      throw history(
        '--from names no commit of this repository; give a branch, tag or hash.',
        window.value,
      );
    }
  }
  try {
    const output = run([
      'log',
      '--no-merges',
      '--no-renames',
      '--no-show-signature',
      '--relative',
      '--name-only',
      '-z',
      '--format=%x01%H%x00%ct',
      ...range,
    ]);
    const commits = parseLog(output);
    if (commits === null) throw new Error('unparsable log');
    return { kind: window.kind === 'days' ? 'days' : 'revision', commits };
  } catch {
    throw history('git could not list the commits of the window.');
  }
}
