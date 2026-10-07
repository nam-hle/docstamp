import { Raised, diag, sortDiagnostics } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import type { Binding, Diagnostic, Lock, Reason, Result } from '../core/types.ts';
import { dependencyHashFrom } from '../hash/hash.ts';
import { patternMatches, select } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';

export interface EngineFs {
  isDependentFile(path: string): boolean;
  fileHash(path: string): string;
}

// SPEC §8.5
export function resolveDependencies(b: Binding, universe: readonly string[]): string[] {
  const parsed = b.dependencies.map((source) => parsePattern(source));
  const invalid = b.dependencies.filter((_, i) => parsed[i] === null);
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
      problems.push(
        diag('E_EMPTY_PATTERN', { dependent: b.dependent, subject: b.dependencies[i] }),
      );
    }
  });
  const resolved = select(patterns, candidates);
  if (resolved.length === 0) problems.push(diag('E_EMPTY_COVERS', { dependent: b.dependent }));
  if (problems.length > 0) throw new Raised(problems);
  return resolved;
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

// SPEC §12.1
export function evaluate(
  b: Binding,
  universe: readonly string[],
  lock: Lock,
  attached: readonly Diagnostic[],
  fs: EngineFs,
): Result {
  const base = { dependent: b.dependent, dependencies: b.dependencies };
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
  let resolved: string[] = [];
  if (attached.length === 0) collect(() => (resolved = resolveDependencies(b, universe)));
  let current = '';
  if (problems.length === 0) collect(() => (current = dependencyHash(resolved, fs)));
  if (problems.length > 0) {
    const diagnostics = sortDiagnostics(problems.map((d) => ({ ...d, dependent: b.dependent })));
    return { ...base, state: 'invalid', reasons: [], resolved: [], current: '', diagnostics };
  }
  const reasons: Reason[] = [];
  const entry = lock.entries.get(b.dependent);
  if (entry === undefined) reasons.push('unrecorded');
  else if (entry !== current) reasons.push('content-changed');
  const state = reasons.length > 0 ? 'stale' : 'ok';
  return { ...base, state, reasons, resolved, current, diagnostics: [] };
}

// SPEC §12.2
export function orphans(bindings: readonly Binding[], lock: Lock): Diagnostic[] {
  const bound = new Set(bindings.map((b) => b.dependent));
  return sortPaths([...lock.entries.keys()])
    .filter((dependent) => !bound.has(dependent))
    .map((dependent) => diag('W_ORPHAN', { subject: dependent }));
}
