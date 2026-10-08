import { comparePaths } from '../core/order.ts';
import type { Change, Result } from '../core/types.ts';
import { git } from './git.ts';
import { parseStrictYaml, type YamlMap, type YamlValue } from '../config/yaml-profile.ts';
import { parseBlock } from '../inline/block.ts';
import { recordedHash as inlineHash, scanFrontmatter } from '../inline/frontmatter.ts';
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
  const fromUntracked = new Set<string>();
  for (const path of untracked) {
    if (!merged.has(path)) fromUntracked.add(path);
    merged.set(path, merged.get(path) === 'deleted' ? 'modified' : (merged.get(path) ?? 'added'));
  }
  return [...merged]
    .filter(([path, status]) =>
      status === 'deleted' ? keep.selectsDeleted(path) : keep.resolved.has(path),
    )
    .map(([path, status]): Change => ({
      status,
      path,
      via: keep.viaOf(path),
      whitespaceOnly: false,
      ...(fromUntracked.has(path) ? { untracked: true } : {}),
    }))
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

interface OwnList {
  readonly dependencies: readonly string[];
  readonly use: readonly string[];
}

const isYamlMap = (v: YamlValue | undefined): v is YamlMap =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const strings = (v: YamlValue | undefined): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;

// SPEC §12.3 step 1.4: the own list of `file` in a docstamp.yaml text, null when unknown
export function configuredOwnList(text: string, file: string): OwnList | null {
  const top = parseStrictYaml(text)?.value;
  const files = isYamlMap(top) ? top.entries.get('files')?.value : undefined;
  const entry = isYamlMap(files) ? files.entries.get(file)?.value : undefined;
  if (!isYamlMap(entry)) return null;
  const dependencies = strings(entry.entries.get('dependencies')?.value);
  if (dependencies === null || dependencies.length === 0) return null;
  return { dependencies, use: strings(entry.entries.get('use')?.value) ?? [] };
}

// SPEC §12.3 step 1.4: the own list of an inline file's text, null when unknown
export function inlineOwnList(text: string, file: string): OwnList | null {
  const scan = scanFrontmatter(text);
  if (scan === null) return null;
  const { declaration } = parseBlock(file, scan);
  if (declaration.dependencies.length === 0) return null;
  return { dependencies: declaration.dependencies, use: declaration.use ?? [] };
}

// SPEC §12.3 step 1.4: the own list now, without the patterns a Preset brought
export function ownListOf(result: Result): OwnList {
  return {
    dependencies: result.dependencies.filter((_, i) => (result.origins?.[i] ?? null) === null),
    use: result.use ?? [],
  };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// SPEC §12.3 step 1.4: the carrier when the own list is known at `rev` and differs, else null
function editedCarrier(root: string, rev: string, result: Result, inline: boolean): string | null {
  const carrier = inline ? result.file : 'docstamp.yaml';
  let then: OwnList | null;
  try {
    const text = git(root, ['show', `${rev}:./${carrier}`]);
    then = inline ? inlineOwnList(text, result.file) : configuredOwnList(text, result.file);
  } catch {
    return null;
  }
  if (then === null) return null;
  const now = ownListOf(result);
  const same = sameList(then.dependencies, now.dependencies) && sameList(then.use, now.use);
  return same ? null : carrier;
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

const TREE_ENTRY = /^(100644|100755) blob ([0-9a-f]+)\t(.*)$/su;

// SPEC §12.3 step 8: path to object name, regular files only
export function parseTree(output: string): Map<string, string> {
  const objects = new Map<string, string>();
  for (const field of nulFields(output)) {
    const match = TREE_ENTRY.exec(field);
    if (match) objects.set(match[3]!, match[2]!);
  }
  return objects;
}

// SPEC §12.3 step 8: each deleted Change takes the first unpaired added Change of equal content
export function pairRenames(
  changes: readonly Change[],
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): Change[] {
  const pairs = new Map<string, string>();
  const added = changes.filter((c) => c.status === 'added');
  for (const d of changes.filter((c) => c.status === 'deleted')) {
    const object = before.get(d.path);
    if (object === undefined) continue;
    const a = added.find((c) => !pairs.has(c.path) && after.get(c.path) === object);
    if (a === undefined) continue;
    pairs.set(d.path, a.path);
    pairs.set(a.path, d.path);
  }
  return changes.map((c) => (pairs.has(c.path) ? { ...c, pair: pairs.get(c.path)! } : c));
}

function renamed(root: string, commit: string, changes: readonly Change[]): Change[] {
  const added = changes.filter((c) => c.status === 'added' && !c.path.includes('\n'));
  if (added.length === 0 || !changes.some((c) => c.status === 'deleted')) return [...changes];
  try {
    const before = parseTree(git(root, ['ls-tree', '-r', '-z', commit]));
    const prefix = git(root, ['rev-parse', '--show-prefix']).replace(/\r?\n$/u, '');
    const input = added.map((c) => `${prefix}${c.path}\n`).join('');
    const objects = git(root, ['hash-object', '--stdin-paths'], {}, input).split('\n');
    const after = new Map(added.map((c, i) => [c.path, objects[i]?.trim() ?? '']));
    return pairRenames(changes, before, after);
  } catch {
    return [...changes];
  }
}

export interface ChangedReport {
  readonly changes: readonly Change[];
  readonly base: string;
  readonly edited?: string;
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
    if (changes === null) return null;
    const edited = editedCarrier(root, id, result, inline);
    if (changes.length === 0 && edited === null) return null;
    const whitespaceOnly = (path: string): boolean => {
      const key = `${id}\0${path}`;
      const known = whitespace.get(key) ?? isWhitespaceOnly(root, id, path);
      whitespace.set(key, known);
      return known;
    };
    const marked = changes.map((c) =>
      c.status === 'modified' && whitespaceOnly(c.path) ? { ...c, whitespaceOnly: true } : c,
    );
    return {
      changes: renamed(root, id, marked),
      base: id,
      ...(edited === null ? {} : { edited }),
    };
  } catch {
    return null;
  }
}
