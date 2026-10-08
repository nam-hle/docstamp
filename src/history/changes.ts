import { comparePaths } from '../core/order.ts';
import type { Change, Result } from '../core/types.ts';
import { git } from './git.ts';
import { recordedHash as inlineHash } from '../inline/frontmatter.ts';
import { parseLock } from '../lock/lock.ts';
import { select, viaOf } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';

export interface RawChange {
  readonly status: string;
  readonly path: string;
}

export interface Keep {
  readonly resolved: ReadonlySet<string>;
  readonly selectsDeleted: (path: string) => boolean;
  readonly viaOf: (path: string) => string[];
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
      status === 'deleted' ? keep.selectsDeleted(path) : keep.resolved.has(path),
    )
    .map(([path, status]) => ({ status, path, via: keep.viaOf(path), whitespaceOnly: false }))
    .sort((a, b) => comparePaths(a.path, b.path));
}

function recordedHash(
  root: string,
  rev: string,
  file: string,
  inline: boolean,
): string | undefined {
  try {
    if (inline) return inlineHash(git(root, ['show', `${rev}:./${file}`])) ?? undefined;
    const text = git(root, ['show', `${rev}:./docstamp-lock.yaml`]);
    return parseLock(Buffer.from(text)).entries.get(file);
  } catch {
    return undefined;
  }
}

// SPEC §12.3 step 1
function reviewCommit(root: string, file: string, hash: string, inline: boolean): string | null {
  const carrier = inline ? file : 'docstamp-lock.yaml';
  const log = git(root, ['log', '--format=%H', `-S${hash}`, '--', carrier]);
  for (const commit of log.split('\n').filter((line) => line !== '')) {
    if (
      recordedHash(root, commit, file, inline) === hash &&
      recordedHash(root, `${commit}^`, file, inline) !== hash
    ) {
      return commit;
    }
  }
  return null;
}

const MODES = /^:(\d+) (\d+) /u;

// SPEC §12.3 step 7
export function isWhitespaceOnly(root: string, commit: string, path: string): boolean {
  const diff = (...options: string[]) =>
    git(root, ['--literal-pathspecs', 'diff', ...options, commit, '--', path]);
  try {
    diff('--ignore-all-space', '--ignore-blank-lines', '--quiet');
    const modes = MODES.exec(diff('--raw', '--no-renames'));
    return modes === null || modes[1] === modes[2];
  } catch {
    return false;
  }
}

export interface ChangedReport {
  readonly changes: readonly Change[];
  readonly base: string;
}

// SPEC §12.3; `entry` is the LockEntry, or the recorded Hash of an inline file; `whitespace`
// remembers the answers of step 7 across the Results of one run
export function changedSince(
  root: string,
  result: Result,
  entry: string,
  inline = false,
  whitespace: Map<string, boolean> = new Map(),
): ChangedReport | null {
  try {
    if (git(root, ['rev-parse', '--is-shallow-repository']).trim() !== 'false') return null;
    const id = reviewCommit(root, result.file, entry, inline);
    if (id === null) return null;
    const diff = parseNameStatus(
      git(root, ['diff', '--name-status', '--no-renames', '-z', '--relative', id, '--']),
    );
    if (diff === null) return null;
    const untracked = parseNameList(
      git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
    );
    const patterns = result.dependencies.map((c) => parsePattern(c));
    if (patterns.some((p) => p === null)) return null;
    const parsed = patterns as ParsedPattern[];
    const changes = buildChanges(diff, untracked, {
      resolved: new Set(result.resolved),
      selectsDeleted: (path) => path !== result.file && select(parsed, [path]).length === 1,
      viaOf: (path) => viaOf(result.dependencies, parsed, path),
    });
    if (changes === null || changes.length === 0) return null;
    const whitespaceOnly = (path: string): boolean => {
      const key = `${id}\0${path}`;
      const known = whitespace.get(key) ?? isWhitespaceOnly(root, id, path);
      whitespace.set(key, known);
      return known;
    };
    return {
      changes: changes.map((c) =>
        c.status === 'modified' && whitespaceOnly(c.path) ? { ...c, whitespaceOnly: true } : c,
      ),
      base: id,
    };
  } catch {
    return null;
  }
}
