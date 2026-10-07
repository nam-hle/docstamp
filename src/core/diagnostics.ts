import { comparePaths } from './order.ts';
import type { Code, Diagnostic } from './types.ts';

const FIX: Record<Code, string> = {
  E_USAGE: 'Correct the command line; see docstamp --help.',
  E_ROOT: 'Pass an existing directory to --root.',
  E_CONFIG_MISSING:
    'Create docstamp.yaml with "version: 2" and a "files" mapping, ' +
    'or docstamp.config.ts exporting the same value.',
  E_CONFIG_AMBIGUOUS: 'Keep one configuration file.',
  E_CONFIG: 'Fix the named key in the configuration file.',
  E_CONFIG_VERSION:
    'Rename "dependents" to "files" and "covers" to "dependencies", set "version: 2".',
  E_UNKNOWN_KEY: 'Remove or correct the key.',
  E_PATTERN: 'Correct the pattern; patterns use "/" and "\\" escapes.',
  E_DEPENDENT_MISSING: 'Rename the key in the configuration file or restore the file.',
  E_EMPTY_PATTERN: 'Correct or remove the pattern; it matches no file.',
  E_EMPTY_DEPENDENCIES: 'Correct the patterns in "dependencies"; together they select no file.',
  E_UNREADABLE: 'Fix the permissions or remove the entry.',
  E_PATH_ENCODING: 'Rename the file to a valid UTF-8 name.',
  E_PATH_COLLISION: 'Rename one of the files; names differ only by case or normalization.',
  E_LOCK:
    'Resolve the conflict by taking either side, or run "docstamp update --all" ' +
    'after reviewing every Dependent.',
  E_LOCK_VERSION: 'Run "docstamp update --all" after reviewing every Dependent.',
  // Lockfile version 2 uses a dedicated message (lock.ts).
  E_UNKNOWN_DEPENDENT: 'Name a Dependent listed in the configuration file.',
  W_ORPHAN: 'Run "docstamp update" on any Dependent to remove the entry.',
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
