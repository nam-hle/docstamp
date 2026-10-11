import { Raised, diag, sortDiagnostics } from '../core/diagnostics.ts';
import { comparePaths, sortPaths } from '../core/order.ts';
import type {
  Declaration,
  Diagnostic,
  Json,
  Lock,
  Reason,
  Result,
  SelectedEntry,
} from '../core/types.ts';
import { dependencyHashFrom, type Fragment } from '../hash/hash.ts';
import { patternMatches, select } from '../pattern/match.ts';
import { literalPath, parsePattern, type ParsedPattern } from '../pattern/parse.ts';
import { canonicalJson } from '../plugin/canonical.ts';

export interface EngineFs {
  isStampedFile(path: string): boolean;
  fileHash(path: string): string;
  // SPEC §8.7: the Fragment hashes of a Selected Dependency, or a Raised
  extractHashes?(path: string, select: Json): string[];
  // SPEC §8.5 NOTE: the path exists under Root but §7.3 keeps it out of the Universe
  isIgnoredPath?(path: string): boolean;
  // SPEC §12.7: the path git shows a missing literal path renamed to, or null
  renamedTo?(path: string): string | null;
}

const IGNORED_MESSAGE =
  'Correct or remove the pattern; it matches no file: it exists but is ignored by .gitignore ' +
  'or the ignore list; depend on its source, or remove that rule (gitignore: false skips ' +
  '.gitignore files).';

// SPEC §8.5 NOTE, §12.7
const RENAMED_MESSAGE =
  'Correct or remove the pattern; it matches no file: git shows it renamed to';

// SPEC §8.5 step 7
function shadowedExclusions(
  b: Declaration,
  patterns: readonly ParsedPattern[],
  resolved: readonly string[],
): Diagnostic[] {
  const shadowers = new Map<string, Set<number>>();
  for (const path of resolved) {
    const last = patterns.findLastIndex((pattern) => patternMatches(pattern, path));
    if (literalPath(patterns[last]!) === path) continue;
    patterns.forEach((pattern, i) => {
      if (!pattern.negated || !patternMatches(pattern, path)) return;
      const subject = b.dependencies[i]!;
      shadowers.set(subject, (shadowers.get(subject) ?? new Set()).add(last));
    });
  }
  return [...shadowers].map(([subject, later]) => {
    const named = [...later]
      .sort((x, y) => x - y)
      .map((j) => {
        const preset = b.origins?.[j] ?? null;
        return `"${b.dependencies[j]}"${preset === null ? '' : ` (preset "${preset}")`}`;
      });
    const message =
      `A later pattern selects again files the exclusion matches: ${named.join(', ')}; ` +
      'move the exclusion after it, or narrow that pattern.';
    return diag('W_SHADOWED_EXCLUSION', { file: b.file, subject, message });
  });
}

// SPEC §8.5
function resolveWithWarnings(
  b: Declaration,
  universe: readonly string[],
  isIgnoredPath: (path: string) => boolean = () => false,
  renamedTo: (path: string) => string | null = () => null,
): { resolved: string[]; warnings: Diagnostic[] } {
  const parsed = b.dependencies.map((source) => parsePattern(source));
  const invalid = b.dependencies.filter((_, i) => parsed[i] === null);
  if (invalid.length > 0) {
    throw new Raised(invalid.map((subject) => diag('E_PATTERN', { file: b.file, subject })));
  }
  const patterns = parsed as ParsedPattern[];
  const candidates = universe.filter((path) => path !== b.file);
  const problems: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  patterns.forEach((pattern, i) => {
    if (candidates.some((path) => patternMatches(pattern, path))) return;
    const subject = b.dependencies[i]!;
    const preset = b.origins?.[i] ?? null;
    if (pattern.negated) {
      if (preset === null) warnings.push(diag('W_EMPTY_EXCLUSION', { file: b.file, subject }));
      return;
    }
    const literal = literalPath(pattern);
    const ignored = literal !== null && isIgnoredPath(literal);
    const target = literal === null || ignored ? null : renamedTo(literal);
    const renamed = target !== null && target !== b.file ? target : null;
    const from = preset === null ? '' : ` It comes from the preset "${preset}".`;
    const message = ignored
      ? IGNORED_MESSAGE
      : renamed !== null
        ? `${RENAMED_MESSAGE} ${renamed}; depend on the new path.`
        : diag('E_EMPTY_PATTERN', { subject }).message;
    problems.push(
      diag('E_EMPTY_PATTERN', {
        file: b.file,
        subject,
        ...(ignored || renamed !== null || preset !== null ? { message: `${message}${from}` } : {}),
      }),
    );
  });
  const own = b.dependencies.filter((_, i) => (b.origins?.[i] ?? null) === null);
  const repeated = new Set(own.filter((s, i) => own.indexOf(s) !== i));
  for (const subject of repeated) {
    warnings.push(diag('W_DUPLICATE_PATTERN', { file: b.file, subject }));
  }
  const resolved = select(patterns, candidates);
  // §8.5 step 6: an E_EMPTY_PATTERN already explains an empty selection
  if (resolved.length === 0 && problems.length === 0 && (b.selected?.length ?? 0) === 0) {
    problems.push(diag('E_EMPTY_DEPENDENCIES', { file: b.file }));
  }
  warnings.push(...shadowedExclusions(b, patterns, resolved));
  if (problems.length > 0) throw new Raised([...problems, ...warnings]);
  return { resolved, warnings };
}

// SPEC §8.5
export function resolveDependencies(b: Declaration, universe: readonly string[]): string[] {
  return resolveWithWarnings(b, universe).resolved;
}

// SPEC §8.7 NOTE, §8.5 steps 2 and 3: a Selected path is a candidate file, never the file itself
function selectedProblems(b: Declaration, universe: readonly string[]): Diagnostic[] {
  const candidates = new Set(universe.filter((path) => path !== b.file));
  return (b.selected ?? [])
    .filter((entry) => !candidates.has(entry.path))
    .map((entry) => diag('E_EMPTY_PATTERN', { file: b.file, subject: entry.path }));
}

const bySelected = (a: SelectedEntry, b: SelectedEntry) =>
  comparePaths(a.path, b.path) || comparePaths(canonicalJson(a.select), canonicalJson(b.select));

// SPEC §8.7: the count rule over what the Plugin returned
function fragmentsOf(b: Declaration, fs: EngineFs, problems: Diagnostic[]): Fragment[] {
  const fragments: Fragment[] = [];
  for (const entry of [...(b.selected ?? [])].sort(bySelected)) {
    const select = canonicalJson(entry.select);
    try {
      const hashes = fs.extractHashes!(entry.path, entry.select);
      const subject = `${entry.path}#${select}`;
      if (hashes.length === 0) problems.push(diag('E_SELECT_NOT_FOUND', { subject }));
      else if (hashes.length > 1) {
        const message = `The selector matched ${hashes.length} times; narrow "select".`;
        problems.push(diag('E_SELECT_AMBIGUOUS', { subject, message }));
      } else fragments.push({ path: entry.path, select, hashes });
    } catch (e) {
      if (!(e instanceof Raised)) throw e;
      problems.push(...e.diagnostics);
    }
  }
  return fragments;
}

// SPEC §10.4
function dependencyHash(resolved: readonly string[], b: Declaration, fs: EngineFs): string {
  const problems: Diagnostic[] = [];
  const entries: Array<[string, string]> = [];
  for (const path of resolved) {
    try {
      entries.push([path, fs.fileHash(path)]);
    } catch (e) {
      if (!(e instanceof Raised)) throw e;
      problems.push(...e.diagnostics);
    }
  }
  const fragments = fragmentsOf(b, fs, problems);
  if (problems.length > 0) throw new Raised(problems);
  return dependencyHashFrom(entries, fragments);
}

// SPEC §12.1 (the recorded Hash of an inline Declaration is in its file, §5.6)
export function evaluate(
  b: Declaration,
  universe: readonly string[],
  lock: Lock,
  attached: readonly Diagnostic[],
  fs: EngineFs,
): Result {
  const base = {
    file: b.file,
    dependencies: b.dependencies,
    ...(b.use === undefined ? {} : { use: b.use }),
    ...(b.origins === undefined ? {} : { origins: b.origins }),
    ...(b.selected === undefined || b.selected.length === 0 ? {} : { selected: b.selected }),
  };
  const problems: Diagnostic[] = [...attached];
  const collect = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      if (!(e instanceof Raised)) throw e;
      problems.push(...e.diagnostics);
    }
  };
  if (!fs.isStampedFile(b.file)) {
    problems.push(diag('E_FILE_MISSING', { file: b.file }));
  }
  let resolved: string[] = [];
  let warnings: Diagnostic[] = [];
  if (attached.length === 0) {
    const ignored = (path: string) => fs.isIgnoredPath?.(path) ?? false;
    const renamed = (path: string) => fs.renamedTo?.(path) ?? null;
    collect(() => ({ resolved, warnings } = resolveWithWarnings(b, universe, ignored, renamed)));
    problems.push(...selectedProblems(b, universe));
  }
  const everything = sortPaths([
    ...new Set([...resolved, ...(b.selected ?? []).map((s) => s.path)]),
  ]);
  let current = '';
  if (problems.length === 0) collect(() => (current = dependencyHash(resolved, b, fs)));
  if (problems.length > 0) {
    const diagnostics = sortDiagnostics(problems.map((d) => ({ ...d, file: b.file })));
    return { ...base, state: 'invalid', reasons: [], resolved: [], current: '', diagnostics };
  }
  const reasons: Reason[] = [];
  const entry = b.inline ? b.inline.recorded : lock.entries.get(b.file);
  if (entry === undefined || entry === null) reasons.push('unrecorded');
  else if (entry !== current) reasons.push('content-changed');
  const state = reasons.length > 0 ? 'stale' : 'ok';
  const diagnostics = sortDiagnostics(warnings.map((d) => ({ ...d, file: b.file })));
  return { ...base, state, reasons, resolved: everything, current, diagnostics };
}

// SPEC §12.2 step 8: only a configured Declaration binds a LockEntry
export function orphans(declarations: readonly Declaration[], lock: Lock): Diagnostic[] {
  const bound = new Set(declarations.filter((b) => !b.inline).map((b) => b.file));
  return sortPaths([...lock.entries.keys()])
    .filter((file) => !bound.has(file))
    .map((file) => diag('W_ORPHAN', { subject: file }));
}
