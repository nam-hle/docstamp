import { comparePaths } from './order.ts';
import type { Code, Diagnostic } from './types.ts';

const FIX: Record<Code, string> = {
  E_USAGE: 'Correct the command line; see docsync --help.',
  E_ROOT: 'Pass an existing directory to --root.',
  E_CONFIG_MISSING: 'Create docsync.yaml with "version: 1" and a "dependents" mapping.',
  E_CONFIG: 'Fix the named key in docsync.yaml.',
  E_CONFIG_VERSION: 'Set "version: 1" in docsync.yaml.',
  E_UNKNOWN_KEY: 'Remove or correct the key.',
  E_PATTERN: 'Correct the pattern; patterns use "/" and "\\" escapes.',
  E_DEPENDENT_MISSING: 'Rename the key in docsync.yaml or restore the file.',
  E_EMPTY_PATTERN: 'Correct or remove the pattern; it matches no file.',
  E_EMPTY_COVERS: 'Correct the patterns; together they select no file.',
  E_UNREADABLE: 'Fix the permissions or remove the entry.',
  E_PATH_ENCODING: 'Rename the file to a valid UTF-8 name.',
  E_PATH_COLLISION: 'Rename one of the files; names differ only by case or normalization.',
  E_LOCK:
    'Resolve the conflict by taking either side, or run "docsync update --all" ' +
    'after reviewing every Dependent.',
  E_LOCK_VERSION: 'Run "docsync update --all" after reviewing every Dependent.',
  E_UNKNOWN_DEPENDENT: 'Name a Dependent listed in docsync.yaml.',
  W_ORPHAN: 'Run "docsync update" on any Dependent to remove the entry.',
};

// SPEC §5
export function diag(
  code: Code,
  fields: { dependent?: string; subject?: string; message?: string } = {},
): Diagnostic {
  return {
    code,
    severity: code === 'W_ORPHAN' ? 'warning' : 'error',
    dependent: fields.dependent ?? '',
    subject: fields.subject ?? '',
    message: fields.message ?? FIX[code],
  };
}

// SPEC §5.5
export function sortDiagnostics(ds: readonly Diagnostic[]): Diagnostic[] {
  const sorted = [...ds].sort(
    (a, b) =>
      comparePaths(a.dependent, b.dependent) ||
      comparePaths(a.code, b.code) ||
      comparePaths(a.subject, b.subject),
  );
  return sorted.filter((d, i) => {
    const prev = sorted[i - 1];
    return !(
      prev &&
      prev.code === d.code &&
      prev.dependent === d.dependent &&
      prev.subject === d.subject &&
      prev.message === d.message
    );
  });
}

export class Raised extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => d.code).join(', '));
  }
}
