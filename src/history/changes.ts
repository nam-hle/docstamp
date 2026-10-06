import { execFileSync } from 'node:child_process';
import { comparePaths } from '../core/order.ts';
import type { Change, Result } from '../core/types.ts';
import { parseLock } from '../lock/lock.ts';
import { select } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';

export interface RawChange {
  readonly status: string;
  readonly path: string;
}

export interface Keep {
  readonly covered: ReadonlySet<string>;
  readonly selectsDeleted: (path: string) => boolean;
}

const STATUS = { M: 'modified', T: 'modified', A: 'added', D: 'deleted' } as const;

const nulFields = (output: string): string[] => {
  const fields = output.split('\0');
  fields.pop();
  return fields.map((f) => f.normalize('NFC'));
};

// SPEC §12.3 step 2
export function parseNameList(output: string): string[] {
  return nulFields(output);
}

// SPEC §12.3 step 2
export function parseNameStatus(output: string): RawChange[] | null {
  if (output !== '' && !output.endsWith('\0')) return null;
  const fields = nulFields(output);
  if (fields.length % 2 !== 0) return null;
  const changes: RawChange[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    changes.push({ status: fields[i] as string, path: fields[i + 1] as string });
  }
  return changes;
}

// SPEC §12.3 steps 3 to 5
export function buildChanges(
  diff: readonly RawChange[],
  untracked: readonly string[],
  keep: Keep,
): Change[] | null {
  const merged = new Map<string, Change['status']>();
  for (const { status, path } of diff) {
    const mapped = STATUS[status as keyof typeof STATUS] as Change['status'] | undefined;
    if (mapped === undefined) return null;
    merged.set(path, mapped);
  }
  for (const path of untracked) {
    merged.set(path, merged.get(path) === 'deleted' ? 'modified' : (merged.get(path) ?? 'added'));
  }
  return [...merged]
    .filter(([path, status]) =>
      status === 'deleted' ? keep.selectsDeleted(path) : keep.covered.has(path),
    )
    .map(([path, status]) => ({ status, path }))
    .sort((a, b) => comparePaths(a.path, b.path));
}

const gitEnv = (): NodeJS.ProcessEnv => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  return { ...env, GIT_OPTIONAL_LOCKS: '0' };
};

const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    env: gitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  });

function recordedHash(root: string, rev: string, dependent: string): string | undefined {
  let text: string;
  try {
    text = git(root, ['show', `${rev}:./docsync-lock.yaml`]);
    return parseLock(Buffer.from(text)).entries.get(dependent);
  } catch {
    return undefined;
  }
}

// SPEC §12.3 step 1
function reviewCommit(root: string, dependent: string, hash: string): string | null {
  const log = git(root, ['log', '--format=%H', `-S${hash}`, '--', 'docsync-lock.yaml']);
  for (const commit of log.split('\n').filter((line) => line !== '')) {
    if (
      recordedHash(root, commit, dependent) === hash &&
      recordedHash(root, `${commit}^`, dependent) !== hash
    ) {
      return commit;
    }
  }
  return null;
}

// SPEC §12.3
export function changedSince(
  root: string,
  result: Result,
  entry: string,
): readonly Change[] | null {
  try {
    if (git(root, ['rev-parse', '--is-shallow-repository']).trim() !== 'false') return null;
    const id = reviewCommit(root, result.dependent, entry);
    if (id === null) return null;
    const diff = parseNameStatus(
      git(root, ['diff', '--name-status', '--no-renames', '-z', '--relative', id, '--']),
    );
    if (diff === null) return null;
    const untracked = parseNameList(
      git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
    );
    const patterns = result.covers.map((c) => parsePattern(c));
    if (patterns.some((p) => p === null)) return null;
    const changes = buildChanges(diff, untracked, {
      covered: new Set(result.covered),
      selectsDeleted: (path) =>
        path !== result.dependent && select(patterns as ParsedPattern[], [path]).length === 1,
    });
    return changes === null || changes.length === 0 ? null : changes;
  } catch {
    return null;
  }
}
