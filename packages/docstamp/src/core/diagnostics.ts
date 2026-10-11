import { comparePaths } from './order.ts';
import type { Code, Diagnostic } from './types.ts';

const FIX: Record<Code, string> = {
  E_USAGE: 'Correct the command line; see docstamp help.',
  E_ROOT: 'Pass an existing directory to --root.',
  E_CONFIG_MISSING:
    'Create docstamp.yaml with "version: 2" and a "files" mapping, ' +
    'or docstamp.config.ts exporting the same value, ' +
    'or add a docstamp block to the frontmatter of a Markdown file; ' +
    'docstamp help start shows each.',
  E_CONFIG_AMBIGUOUS: 'Keep one configuration file.',
  E_CONFIG: 'Fix the configuration file; the key named, if any, is the problem.',
  E_CONFIG_VERSION:
    'Rename "dependents" to "files" and "covers" to "dependencies", set "version: 2".',
  E_UNKNOWN_KEY: 'Remove or correct the key.',
  E_PATTERN: 'Correct the pattern; "/" separates its segments and "\\" escapes the next character.',
  E_UNKNOWN_PRESET:
    'Define the preset under "presets" in the configuration file, or correct the name in "use".',
  E_BLOCK:
    'Write the docstamp block as a block mapping with "dependencies" and, optionally, ' +
    '"hash: <64 hex>" on one line.',
  E_DUPLICATE_DECLARATION:
    'Declare the file once: remove its entry under "files" or its docstamp block.',
  E_FILE_MISSING: 'Rename the key under "files" in the configuration file or restore the file.',
  E_EMPTY_PATTERN: 'Correct or remove the pattern; it matches no file.',
  E_EMPTY_DEPENDENCIES: 'Correct the patterns in "dependencies"; together they select no file.',
  E_UNREADABLE: 'Fix the permissions or remove the entry.',
  E_PLUGIN:
    'Register valid plugins in docstamp.config.ts or .js: { name, apiVersion: 1, files, extract }.',
  E_SELECT: 'Register a plugin whose "files" select the path, or fix the plugin or the file.',
  E_SELECT_NOT_FOUND: 'The plugin found nothing for the selector; correct "select" or the file.',
  E_SELECT_AMBIGUOUS: 'The selector matched more than once; narrow "select".',
  E_PATH_ENCODING: 'Rename the file to a valid UTF-8 name.',
  E_PATH_COLLISION: 'Rename one of the files; names differ only by case or normalization.',
  E_LOCK:
    'The Lockfile is not valid; after a merge conflict take either side, otherwise ' +
    'run "docstamp update --all" after reviewing every file.',
  E_LOCK_VERSION: 'Run "docstamp update --all" after reviewing every file.',
  // Lockfile version 2 uses a dedicated message (lock.ts).
  E_UNKNOWN_FILE:
    'Name a file listed under "files" in the configuration file, or one with a docstamp block.',
  E_HISTORY:
    'Run in a git work tree with its full history (not a shallow clone); ' +
    'for --from, name a commit.',
  W_ORPHAN: 'Run "docstamp update" on any file to remove the entry.',
  W_EMPTY_EXCLUSION:
    'The exclusion matches no file, so it excludes nothing; remove it, or keep it for later.',
  W_DUPLICATE_PATTERN:
    'The pattern is listed more than once; keep one copy, unless the order of the patterns needs ' +
    'both.',
  W_SHADOWED_EXCLUSION:
    'A later pattern selects again files the exclusion matches; move the exclusion after it, ' +
    'or narrow that pattern.',
  W_UNKNOWN_PATH:
    'The path is neither tracked nor on disk, so nothing depends on it; check the spelling ' +
    '(arguments are resolved against the current directory).',
};

// SPEC §8.1, §15: the two invalid patterns that name nothing get a message of their own
const PATTERN_FIX: Record<string, string> = {
  '': 'Write a path or a glob, or remove the pattern; it is empty.',
  '!': 'Write the path to exclude after the "!", as in "!src/gen", or remove the pattern.',
};

// SPEC §8.1 NOTE, §15: "src\cli" is the literal "srccli", the usual cause of a Windows path
const SEPARATOR_HINT =
  'Correct the pattern; it matches no file: patterns use "/" as the separator, and "\\" ' +
  'escapes the next character.';
const BACKSLASH_LETTER = /\\\p{L}/u;

function defaultMessage(code: Code, subject: string): string {
  if (code === 'E_PATTERN') return PATTERN_FIX[subject] ?? FIX[code];
  if (code === 'E_EMPTY_PATTERN' && BACKSLASH_LETTER.test(subject)) return SEPARATOR_HINT;
  return FIX[code];
}

// SPEC §5
export function diag(
  code: Code,
  fields: { file?: string; subject?: string; message?: string } = {},
): Diagnostic {
  const subject = fields.subject ?? '';
  return {
    code,
    severity: code.startsWith('W_') ? 'warning' : 'error',
    file: fields.file ?? '',
    subject,
    message: fields.message ?? defaultMessage(code, subject),
  };
}

// SPEC §5.5
export function sortDiagnostics(ds: readonly Diagnostic[]): Diagnostic[] {
  const sorted = [...ds].sort(
    (a, b) =>
      comparePaths(a.file, b.file) ||
      comparePaths(a.code, b.code) ||
      comparePaths(a.subject, b.subject),
  );
  return sorted.filter((d, i) => {
    const prev = sorted[i - 1];
    return !(
      prev &&
      prev.code === d.code &&
      prev.file === d.file &&
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
