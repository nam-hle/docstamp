import { Raised, diag } from '../core/diagnostics.ts';
import type { CommitRecord } from '../engine/stats.ts';
import type { Git, LogWindow } from '../host/git.ts';

export interface Window {
  readonly kind: 'days' | 'revision';
  readonly commits: readonly CommitRecord[];
}

const history = (message: string, subject = '') =>
  new Raised([diag('E_HISTORY', { subject, message })]);

export type ReplayWindow =
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'from'; readonly value: string };

// SPEC §12.4 step 5: the day of a commit is its UTC date
const dayOf = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

// SPEC §12.4
export function replay(git: Git, window: ReplayWindow, now: number): Window {
  try {
    if (git.isShallow()) throw history('The repository is shallow; fetch its full history.');
    if (!git.hasCommit()) throw new Error('no commit');
  } catch (e) {
    if (e instanceof Raised) throw e;
    throw history(
      'Run docstamp stats with git installed, in a work tree that has at least one commit.',
    );
  }
  let range: LogWindow;
  if (window.kind === 'days') {
    // SPEC §12.4 step 3: seconds, never a date for git to parse
    range = { maxAge: now - window.days * 86400 };
  } else {
    const id = git.resolve(window.value);
    if (id === null) {
      throw history(
        '--from names no commit of this repository; give a branch, tag or hash.',
        window.value,
      );
    }
    range = { after: id };
  }
  try {
    const entries = git.log(range);
    if (entries === null) throw new Error('unparsable log');
    const commits = entries.map(({ seconds, paths }) => ({ day: dayOf(seconds), paths }));
    return { kind: window.kind === 'days' ? 'days' : 'revision', commits };
  } catch {
    throw history('git could not list the commits of the window.');
  }
}
