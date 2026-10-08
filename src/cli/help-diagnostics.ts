import type { Code } from '../core/types.ts';

// SPEC §15: one entry per code; the Record type keeps it in step with `Code`
export const DIAGNOSTIC_HELP: Record<Code, { meaning: string; fix: string }> = {
  E_USAGE: {
    meaning:
      'The command line is wrong: an unknown or repeated option, a missing value, an option ' +
      'used with a command that does not take it, a missing file argument, a file argument ' +
      'that resolves outside the root (any command), an unknown help name, or a suggest ' +
      '--write that cannot write a block.',
    fix:
      'Correct the command line as docstamp help <command> shows it. A removed option names ' +
      'its replacement. A file argument is resolved against the current directory, not --root.',
  },
  E_ROOT: {
    meaning: 'The directory given to --root does not exist.',
    fix: 'Pass an existing directory.',
  },
  E_CONFIG_MISSING: {
    meaning:
      'No configuration file was found, and the root has no file with a docstamp block, so ' +
      'there is nothing to check. A gate that checks nothing never passes unnoticed.',
    fix:
      'Create docstamp.yaml (or docstamp.config.ts) at the root, or add a docstamp block to ' +
      'the frontmatter of a Markdown file; see docstamp help start.',
  },
  E_CONFIG_AMBIGUOUS: {
    meaning: 'More than one configuration file is at the root; the subject lists them.',
    fix: 'Keep exactly one of docstamp.yaml, docstamp.config.ts, .mts, .js and .mjs.',
  },
  E_CONFIG: {
    meaning:
      'The configuration file cannot be read or has a wrong shape: not strict YAML, a script ' +
      'that fails or exports no plain data, a key with a value of the wrong type, a missing ' +
      'files.',
    fix:
      'Fix the key the subject names (presets.<name> for a preset, use for a file, ' +
      'default-presets for the default presets; an empty use needs default-presets); for a ' +
      'missing files, write files: {} for none (a key one or two edits from files, such as ' +
      'fils, is E_UNKNOWN_KEY alone); a script must export default plain data. See docstamp ' +
      'help config.',
  },
  E_CONFIG_VERSION: {
    meaning: 'The configuration file has no version: 2 (a version 1 file used other key names).',
    fix:
      'Add version: 2. For a version 1 file, also rename dependents to files and covers to ' +
      'dependencies.',
  },
  E_UNKNOWN_KEY: {
    meaning: 'A key that docstamp does not know, in the configuration file or in a docstamp block.',
    fix:
      'Remove or correct the key; the message names the nearest valid key when there is one. ' +
      'dependents and covers are version 1 names: files and dependencies.',
  },
  E_PATTERN: {
    meaning: 'A pattern is not valid: see docstamp help patterns. The file is invalid.',
    fix:
      'Correct the pattern; an empty pattern or a lone ! names nothing: write a path or ' +
      'remove it.',
  },
  E_UNKNOWN_PRESET: {
    meaning:
      'A file, or default-presets, names a preset that the configuration file does not ' +
      'define. For default-presets it is global and stops the run.',
    fix:
      'Define it under presets in the configuration file, or correct the name in use or ' +
      'default-presets.',
  },
  E_BLOCK: {
    meaning:
      'The docstamp block of a file is malformed; the subject names the part: docstamp, ' +
      'frontmatter, dependencies, use or hash.',
    fix:
      'Write the block as a block mapping with dependencies (a non-empty list) and optionally ' +
      'use and hash: <64 hex> alone on its line; see docstamp help inline.',
  },
  E_DUPLICATE_DECLARATION: {
    meaning: 'A file is declared both under files in the configuration file and inline.',
    fix: 'Declare it once: remove the entry under files or the docstamp block.',
  },
  E_FILE_MISSING: {
    meaning: 'A file listed under files does not exist under that exact name.',
    fix: 'Rename the key to the new path, or restore the file.',
  },
  E_EMPTY_PATTERN: {
    meaning:
      'A pattern without ! selects no file. The message says when the path exists but is ' +
      'ignored, when git shows it renamed, or when it holds a \\ (an escape, not a separator).',
    fix:
      'Correct or remove the pattern: depend on the new path, on the source of an ignored ' +
      'file, and use / as the separator.',
  },
  E_EMPTY_DEPENDENCIES: {
    meaning:
      'The patterns of a file together select no file, though none is E_EMPTY_PATTERN: there ' +
      'is no pattern without !, or the exclusions remove every selected file.',
    fix: 'Correct the patterns in dependencies; docstamp list-dependencies <file> shows them.',
  },
  E_UNREADABLE: {
    meaning: 'A file or directory cannot be read, or the root or a file cannot be written.',
    fix: 'Fix the permissions, or make the root writable.',
  },
  E_PATH_ENCODING: {
    meaning: 'A file name under the root is not valid UTF-8.',
    fix: 'Rename the file to valid UTF-8.',
  },
  E_PATH_COLLISION: {
    meaning:
      'Two paths differ only by letter case or Unicode normalization, so they cannot coexist ' +
      'on every file system.',
    fix: 'Rename one of the files.',
  },
  E_LOCK: {
    meaning: 'docstamp-lock.yaml is not valid, usually after a merge conflict left markers in it.',
    fix:
      'Resolve the conflict by taking either side, run docstamp and review what is stale; ' +
      'otherwise review every file, then docstamp update --all.',
  },
  E_LOCK_VERSION: {
    meaning: 'The lock is of another version, or a legacy docsync.lock is present.',
    fix:
      'For docsync.lock: delete it, review every file, then docstamp update --all. For a ' +
      'version 2 lock: docstamp update --all rewrites it as version 3 (hashes are unchanged).',
  },
  E_UNKNOWN_FILE: {
    meaning:
      'A file argument resolves inside the root to a file that is not stamped. One that ' +
      'resolves outside the root is E_USAGE.',
    fix:
      'Name a file listed under files or one with a docstamp block, resolved against the ' +
      'current directory; docstamp list-dependencies lists them all.',
  },
  E_HISTORY: {
    meaning:
      'stats needs git history it cannot read: no git, not a work tree, a shallow clone, no ' +
      'commit, or a --from that names no commit.',
    fix: 'Run in a git work tree with its full history (fetch-depth: 0 in CI); name a commit.',
  },
  W_ORPHAN: {
    meaning: 'The lock has an entry for a file that is no longer declared.',
    fix: 'Run docstamp update on any file; it removes the entry.',
  },
  W_EMPTY_EXCLUSION: {
    meaning: 'An exclusion (!) matches no file, so it excludes nothing. Nothing else changes.',
    fix: 'Correct or remove it, or keep it for files that do not exist yet.',
  },
  W_SHADOWED_EXCLUSION: {
    meaning: 'A later pattern selects again files that an exclusion removed.',
    fix:
      'Move the exclusion after that pattern (list exclusion presets last in use), or ' +
      'narrow the pattern, unless re-selecting those files is intended.',
  },
  W_DUPLICATE_PATTERN: {
    meaning: 'The same pattern is listed more than once for a file.',
    fix: 'Keep one copy, unless the order needs both: the last matching pattern wins.',
  },
  W_UNKNOWN_PATH: {
    meaning:
      'A list-dependents argument is not in the universe and not on disk, so nothing ' +
      'depends on it.',
    fix: 'Check the spelling; arguments are resolved against the current directory.',
  },
};
