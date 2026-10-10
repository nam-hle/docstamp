import { comparePaths } from '../core/order.ts';
import type { Change, FragmentChange, Result } from '../core/types.ts';
import type { Git, RawChange } from '../host/git.ts';
import { fragmentChanges, type FragmentProbe } from './fragments.ts';
import { parseStrictYaml, type YamlMap, type YamlValue } from '../config/yaml-profile.ts';
import { parseBlock } from '../inline/block.ts';
import { recordedHash as inlineHash, scanFrontmatter } from '../inline/frontmatter.ts';
import { parseLock } from '../lock/lock.ts';
import { select, viaOf } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';

export interface Keep {
  readonly resolved: ReadonlySet<string>;
  readonly selectsDeleted: (path: string) => boolean;
  readonly viaOf: (path: string) => string[];
}

const STATUS = { M: 'modified', T: 'modified', A: 'added', D: 'deleted' } as const;

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

function recordedHash(git: Git, rev: string, file: string, inline: boolean): string | undefined {
  try {
    if (inline) return inlineHash(git.fileAt(rev, file)) ?? undefined;
    const text = git.fileAt(rev, 'docstamp-lock.yaml');
    return parseLock(Buffer.from(text)).entries.get(file);
  } catch {
    return undefined;
  }
}

// SPEC §12.3 step 1
function reviewCommit(git: Git, file: string, hash: string, inline: boolean): string | null {
  const carrier = inline ? file : 'docstamp-lock.yaml';
  for (const commit of git.pickaxe(carrier, hash)) {
    if (
      recordedHash(git, commit, file, inline) === hash &&
      recordedHash(git, `${commit}^`, file, inline) !== hash
    ) {
      return commit;
    }
  }
  return null;
}

// SPEC §12.3 step 1.4: `use` is undefined when the list has no `use` key (§8.6)
export interface OwnList {
  readonly dependencies: readonly string[];
  readonly use: readonly string[] | undefined;
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
  const use = entry.entries.get('use');
  return { dependencies, use: use === undefined ? undefined : (strings(use.value) ?? []) };
}

// SPEC §12.3 step 1.4: the own list of an inline file's text, null when unknown
export function inlineOwnList(text: string, file: string): OwnList | null {
  const scan = scanFrontmatter(text);
  if (scan === null) return null;
  const { declaration } = parseBlock(file, scan, true);
  if (declaration.dependencies.length === 0) return null;
  return { dependencies: declaration.dependencies, use: declaration.use };
}

// SPEC §12.3 step 1.4: the own list now, without the patterns a Preset brought
export function ownListOf(result: Result): OwnList {
  return {
    dependencies: result.dependencies.filter((_, i) => (result.origins?.[i] ?? null) === null),
    use: result.use,
  };
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.length === b.length && a.every((x, i) => x === b[i]);

// SPEC §12.3 step 1.4: the carrier and the own list at `rev` when it is known and differs
function editedCarrier(
  git: Git,
  rev: string,
  result: Result,
  inline: boolean,
): { carrier: string; ownThen: OwnList } | null {
  const carrier = inline ? result.file : 'docstamp.yaml';
  let then: OwnList | null;
  try {
    const text = git.fileAt(rev, carrier);
    then = inline ? inlineOwnList(text, result.file) : configuredOwnList(text, result.file);
  } catch {
    return null;
  }
  if (then === null) return null;
  const now = ownListOf(result);
  const same = sameList(then.dependencies, now.dependencies) && sameList(then.use, now.use);
  return same ? null : { carrier, ownThen: then };
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

function renamed(git: Git, commit: string, changes: readonly Change[]): Change[] {
  const added = changes.filter((c) => c.status === 'added' && !c.path.includes('\n'));
  if (added.length === 0 || !changes.some((c) => c.status === 'deleted')) return [...changes];
  try {
    const before = git.objectsAt(commit);
    const objects = git.hashWorkFiles(added.map((c) => c.path));
    const after = new Map(added.map((c, i) => [c.path, objects[i] ?? '']));
    return pairRenames(changes, before, after);
  } catch {
    return [...changes];
  }
}

export interface ChangedReport {
  readonly changes: readonly Change[];
  readonly base: string;
  readonly edited?: string;
  // SPEC §12.3 step 10: the own list at the base commit, when it was edited since
  readonly ownThen?: OwnList;
  // SPEC §12.3 step 11: present when the Declaration has Selected Dependencies
  readonly fragments?: readonly FragmentChange[];
}

// SPEC §12.3; `entry` is the LockEntry, or the recorded Hash of an inline file; `whitespace`
// remembers the answers of step 7 across the Results of one run
export function changedSince(
  git: Git,
  result: Result,
  entry: string,
  inline = false,
  whitespace: Map<string, boolean> = new Map(),
  probe?: FragmentProbe,
): ChangedReport | null {
  try {
    if (git.isShallow()) return null;
    const id = reviewCommit(git, result.file, entry, inline);
    if (id === null) return null;
    const diff = git.changesSince(id);
    if (diff === null) return null;
    const untracked = git.untracked();
    const patterns = result.dependencies.map((c) => parsePattern(c));
    if (patterns.some((p) => p === null)) return null;
    const parsed = patterns as ParsedPattern[];
    const changes = buildChanges(diff, untracked, {
      resolved: new Set(result.resolved.filter((path) => select(parsed, [path]).length === 1)),
      selectsDeleted: (path) => path !== result.file && select(parsed, [path]).length === 1,
      viaOf: (path) => viaOf(result.dependencies, parsed, path),
    });
    if (changes === null) return null;
    const edited = editedCarrier(git, id, result, inline);
    const fragments = probe === undefined ? undefined : fragmentChanges(git, id, probe);
    if (changes.length === 0 && edited === null && !fragments?.length) return null;
    const whitespaceOnly = (path: string): boolean => {
      const key = `${id}\0${path}`;
      const known = whitespace.get(key) ?? git.isWhitespaceOnly(id, path);
      whitespace.set(key, known);
      return known;
    };
    const marked = changes.map((c) =>
      c.status === 'modified' && whitespaceOnly(c.path) ? { ...c, whitespaceOnly: true } : c,
    );
    return {
      changes: renamed(git, id, marked),
      base: id,
      ...(fragments === undefined ? {} : { fragments }),
      ...(edited === null ? {} : { edited: edited.carrier, ownThen: edited.ownThen }),
    };
  } catch {
    return null;
  }
}
