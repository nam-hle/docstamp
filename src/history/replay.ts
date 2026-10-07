import { Raised, diag } from '../core/diagnostics.ts';
import type { CommitRecord } from '../engine/stats.ts';
import { git } from './git.ts';

export interface Window {
  readonly kind: 'revision' | 'date';
  readonly commits: readonly CommitRecord[];
}

const COUNT = /^[0-9]+[. ](?:second|minute|hour|day|week|month|year)s?(?:[. ]ago)?$/u;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:?\d{2})?$/u;

function isCalendarDate(year: string, month: string, day: string): boolean {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

// SPEC §12.4 ParseSince
export function parseSince(value: string): string | null {
  if (COUNT.test(value)) return value;
  const date = DATE.exec(value);
  if (date) return isCalendarDate(date[1]!, date[2]!, date[3]!) ? `${value}T00:00:00Z` : null;
  const time = DATE_TIME.exec(value);
  if (!time || !isCalendarDate(time[1]!, time[2]!, time[3]!)) return null;
  const [hour, minute, second] = [time[4]!, time[5]!, time[6] ?? '00'].map(Number);
  return hour! <= 23 && minute! <= 59 && second! <= 59 ? value : null;
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
export function replay(root: string, since: string): Window {
  const run = (args: string[]) => git(root, args, { TZ: 'UTC' });
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
  let kind: Window['kind'];
  try {
    range = [`${run(['rev-parse', '--verify', '--quiet', `${since}^{commit}`]).trim()}..HEAD`];
    kind = 'revision';
  } catch {
    const limit = parseSince(since);
    if (limit === null) {
      throw history(
        '--since names no commit and is not a date such as 2024-01-01 or a duration such as 90.days.',
        since,
      );
    }
    range = [`--since=${limit}`, 'HEAD'];
    kind = 'date';
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
    return { kind, commits };
  } catch {
    throw history('git could not list the commits of the window.');
  }
}
