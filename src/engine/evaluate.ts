import { Raised, diag, sortDiagnostics } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import type { Binding, Diagnostic, Lock, Reason, Result } from '../core/types.ts';
import { coverHashFrom } from '../hash/hash.ts';
import { patternMatches, select } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';

export interface EngineFs {
  isDependentFile(path: string): boolean;
  fileHash(path: string): string;
}

// SPEC §8.5
export function resolveCovers(b: Binding, universe: readonly string[]): string[] {
  const parsed = b.covers.map((source) => parsePattern(source));
  const invalid = b.covers.filter((_, i) => parsed[i] === null);
  if (invalid.length > 0) {
    throw new Raised(
      invalid.map((subject) => diag('E_PATTERN', { dependent: b.dependent, subject })),
    );
  }
  const patterns = parsed as ParsedPattern[];
  const candidates = universe.filter((path) => path !== b.dependent);
  const problems: Diagnostic[] = [];
  patterns.forEach((pattern, i) => {
    if (!candidates.some((path) => patternMatches(pattern, path))) {
      problems.push(diag('E_EMPTY_PATTERN', { dependent: b.dependent, subject: b.covers[i] }));
    }
  });
  const covered = select(patterns, candidates);
  if (covered.length === 0) problems.push(diag('E_EMPTY_COVERS', { dependent: b.dependent }));
  if (problems.length > 0) throw new Raised(problems);
  return covered;
}

// SPEC §10.4
function coverHash(covered: readonly string[], fs: EngineFs): string {
  const problems: Diagnostic[] = [];
  const entries: Array<[string, string]> = [];
  for (const path of covered) {
    try {
      entries.push([path, fs.fileHash(path)]);
    } catch (e) {
      if (!(e instanceof Raised)) throw e;
      problems.push(...e.diagnostics);
    }
  }
  if (problems.length > 0) throw new Raised(problems);
  return coverHashFrom(entries);
}

// SPEC §12.1
export function evaluate(
  b: Binding,
  universe: readonly string[],
  lock: Lock,
  attached: readonly Diagnostic[],
  fs: EngineFs,
): Result {
  const base = { dependent: b.dependent, covers: b.covers };
  const problems: Diagnostic[] = [...attached];
  const collect = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      if (!(e instanceof Raised)) throw e;
      problems.push(...e.diagnostics);
    }
  };
  if (!fs.isDependentFile(b.dependent)) {
    problems.push(diag('E_DEPENDENT_MISSING', { dependent: b.dependent }));
  }
  let covered: string[] = [];
  if (attached.length === 0) collect(() => (covered = resolveCovers(b, universe)));
  let current = '';
  if (problems.length === 0) collect(() => (current = coverHash(covered, fs)));
  if (problems.length > 0) {
    const diagnostics = sortDiagnostics(problems.map((d) => ({ ...d, dependent: b.dependent })));
    return { ...base, state: 'invalid', reasons: [], covered: [], current: '', diagnostics };
  }
  const reasons: Reason[] = [];
  const entry = lock.entries.get(b.dependent);
  if (entry === undefined) reasons.push('unrecorded');
  else if (entry !== current) reasons.push('content-changed');
  const state = reasons.length > 0 ? 'stale' : 'ok';
  return { ...base, state, reasons, covered, current, diagnostics: [] };
}

// SPEC §12.2
export function orphans(bindings: readonly Binding[], lock: Lock): Diagnostic[] {
  const bound = new Set(bindings.map((b) => b.dependent));
  return sortPaths([...lock.entries.keys()])
    .filter((dependent) => !bound.has(dependent))
    .map((dependent) => diag('W_ORPHAN', { subject: dependent }));
}
