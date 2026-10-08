import { Raised, diag, sortDiagnostics } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import type { Declaration, Diagnostic, Lock, Reason, Result } from '../core/types.ts';
import { dependencyHashFrom } from '../hash/hash.ts';
import { patternMatches, select } from '../pattern/match.ts';
import { literalPath, parsePattern, type ParsedPattern } from '../pattern/parse.ts';

export interface EngineFs {
  isStampedFile(path: string): boolean;
  fileHash(path: string): string;
  // SPEC §8.5 NOTE: the path exists under Root but §7.3 keeps it out of the Universe
  isIgnoredPath?(path: string): boolean;
}

const IGNORED_MESSAGE =
  'Correct or remove the pattern; it matches no file: it exists but is ignored by .gitignore ' +
  'or the ignore list; depend on its source, or remove that rule (gitignore: false skips ' +
  '.gitignore files).';

// SPEC §8.5
function resolveWithWarnings(
  b: Declaration,
  universe: readonly string[],
  isIgnoredPath: (path: string) => boolean = () => false,
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
    const from = preset === null ? '' : ` It comes from the preset "${preset}".`;
    const message = ignored ? IGNORED_MESSAGE : diag('E_EMPTY_PATTERN', { subject }).message;
    problems.push(
      diag('E_EMPTY_PATTERN', {
        file: b.file,
        subject,
        ...(ignored || preset !== null ? { message: `${message}${from}` } : {}),
      }),
    );
  });
  const own = b.dependencies.filter((_, i) => (b.origins?.[i] ?? null) === null);
  const repeated = new Set(own.filter((s, i) => own.indexOf(s) !== i));
  for (const subject of repeated) {
    warnings.push(diag('W_DUPLICATE_PATTERN', { file: b.file, subject }));
  }
  const resolved = select(patterns, candidates);
  if (resolved.length === 0) problems.push(diag('E_EMPTY_DEPENDENCIES', { file: b.file }));
  if (problems.length > 0) throw new Raised([...problems, ...warnings]);
  return { resolved, warnings };
}

// SPEC §8.5
export function resolveDependencies(b: Declaration, universe: readonly string[]): string[] {
  return resolveWithWarnings(b, universe).resolved;
}

// SPEC §10.4
function dependencyHash(resolved: readonly string[], fs: EngineFs): string {
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
  if (problems.length > 0) throw new Raised(problems);
  return dependencyHashFrom(entries);
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
    collect(() => ({ resolved, warnings } = resolveWithWarnings(b, universe, ignored)));
  }
  let current = '';
  if (problems.length === 0) collect(() => (current = dependencyHash(resolved, fs)));
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
  return { ...base, state, reasons, resolved, current, diagnostics };
}

// SPEC §12.2 step 8: only a configured Declaration binds a LockEntry
export function orphans(declarations: readonly Declaration[], lock: Lock): Diagnostic[] {
  const bound = new Set(declarations.filter((b) => !b.inline).map((b) => b.file));
  return sortPaths([...lock.entries.keys()])
    .filter((file) => !bound.has(file))
    .map((file) => diag('W_ORPHAN', { subject: file }));
}
