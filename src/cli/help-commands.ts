import type { Command } from './args.ts';
import type { Example } from './help-format.ts';

export interface CommandPage {
  readonly synopsis: readonly string[];
  readonly summary: string;
  readonly description: string;
  readonly options: readonly (readonly [string, string])[];
  readonly reads: string;
  readonly writes: string;
  readonly examples: readonly Example[];
  readonly exit: readonly (readonly [string, string])[];
  readonly related: readonly string[];
}

const JSON_OPTION = [
  '--json',
  'Print one JSON document instead of text (docstamp help json).',
] as const;
const ROOT_OPTION = [
  '--root <dir>',
  'Use <dir> as the root, instead of the nearest directory upward with a configuration ' +
    'file, else with .git. File arguments are still resolved against the current directory.',
] as const;
const ERROR_EXIT = ['2', 'an error diagnostic, or a usage error.'] as const;

// SPEC §13.1 to §13.11: one page per command of the command table
export const COMMAND_PAGES: Record<Command, CommandPage> = {
  check: {
    synopsis: ['docstamp [check] [--json] [--only-stale] [--quiet] [--root <dir>] [<file>...]'],
    summary: "Check that each file's dependencies are unchanged since its last review.",
    description: `
The default command: a bare docstamp is docstamp check. It evaluates every stamped file (or only
the named ones), prints a block for each file that is not ok, a summary line, and next: lines that
name the command to run.

A stale block lists, when git history allows, the dependencies that changed since the last review
and a review: line with a read-only git command that shows the change; otherwise it lists the
file's patterns as depends lines. That report is advisory: the verdict never reads git.`,
    options: [
      JSON_OPTION,
      ['--only-stale', 'With --json, leave the ok files out of files; summary still counts them.'],
      ['--quiet', 'Print nothing on standard output when every selected file is ok.'],
      ROOT_OPTION,
      ['<file>...', 'Check only these stamped files.'],
    ],
    reads:
      'the configuration file, the docstamp blocks, every dependency, docstamp-lock.yaml; git ' +
      'history, read-only, for the changed-file report only.',
    writes: 'nothing.',
    examples: [
      {
        args: ['docs/guide.md'],
        exit: 1,
        out: `STALE    docs/guide.md  (unrecorded)
  depends   src
  depends   !src/**/*.test.ts
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update docs/guide.md
  run update only after the review, never --all just to pass; see docstamp help agents
`,
      },
      { args: ['--json', '--only-stale'] },
    ],
    exit: [
      ['0', 'every selected file is ok.'],
      ['1', 'a selected file is stale, and none is invalid.'],
      ['2', 'a selected file is invalid, an error diagnostic, or a usage error.'],
    ],
    related: ['update', 'list-dependencies', 'states', 'agents'],
  },
  update: {
    synopsis: ['docstamp update [--json] [--root <dir>] (--all | <file>...)'],
    summary: 'Record that you reviewed the named files against their dependencies.',
    description: `
Records the current dependency hash of each named file: in docstamp-lock.yaml for a file declared
in the configuration file, in the hash: line of its docstamp block for an inline file. It prints
written or unchanged for each file, and removed for a lock entry whose file is no longer declared.

A write asserts that a review happened, and docstamp cannot check that. Run it only after reading
the changed dependencies and fixing what the file no longer gets right. --all is for the first
adoption and for recovery from an unreadable lock, never for making a failing check pass. When a
named file is invalid nothing is written.`,
    options: [
      ['--all', 'Record every stamped file. Not with file arguments.'],
      JSON_OPTION,
      ROOT_OPTION,
      ['<file>...', 'The stamped files you reviewed.'],
    ],
    reads: 'what check reads, without git.',
    writes:
      'docstamp-lock.yaml (only when a file is declared in the configuration file, or the lock ' +
      'exists), and the hash: line of each named inline file.',
    examples: [
      { args: ['update', 'docs/guide.md'], out: 'written  docs/guide.md\n' },
      { args: ['check', 'docs/guide.md'], out: '1 ok, 0 stale, 0 invalid\n' },
    ],
    exit: [
      ['0', 'the hashes were written, or were already current.'],
      ['2', 'a named file is invalid (nothing written), an error diagnostic, or a usage error.'],
    ],
    related: ['check', 'agents', 'states'],
  },
  'list-dependencies': {
    synopsis: ['docstamp list-dependencies [--json] [--root <dir>] [<file>...]'],
    summary: 'List each file with its dependency patterns and the files they select.',
    description: `
For each stamped file (or the named ones): one depends line per pattern, in order, marked
(preset <name>) when it comes from a preset, then one resolved line per selected file. It does not
read the lock and does not hash, so it works before the first update.`,
    options: [JSON_OPTION, ROOT_OPTION, ['<file>...', 'List only these stamped files.']],
    reads: 'the configuration file, the docstamp blocks and the file tree; not the lock.',
    writes: 'nothing.',
    examples: [
      {
        args: ['list-dependencies', 'docs/guide.md'],
        out: `docs/guide.md
  depends   src
  depends   !src/**/*.test.ts
  resolved  src/cli.ts
  resolved  src/hash.ts
`,
      },
    ],
    exit: [
      ['0', 'the files were listed.'],
      ['2', 'a listed file is invalid, or an error.'],
    ],
    related: ['list-dependents', 'patterns', 'check'],
  },
  'list-dependents': {
    synopsis: ['docstamp list-dependents [--json] [--transitive] [--root <dir>] <file>...'],
    summary: 'List the files that depend on each named file, and the patterns that select it.',
    description: `
The reverse query: any file of the repository may be named. Run it before changing code to see
which docs the change affects. A path that is neither in the universe nor on disk prints
(no dependents) and the warning W_UNKNOWN_PATH; the exit code stays 0. Direct dependents only,
unless --transitive.`,
    options: [
      JSON_OPTION,
      [
        '--transitive',
        'Also list the dependents of each dependent, depth first; a file reached again is ' +
          'marked (listed above), a cycle (cycle).',
      ],
      ROOT_OPTION,
      ['<file>...', 'Any files, resolved against the current directory. At least one.'],
    ],
    reads: 'the configuration file, the docstamp blocks and the file tree; not the lock.',
    writes: 'nothing.',
    examples: [
      { args: ['list-dependents', 'src/hash.ts'], out: 'src/hash.ts\n  docs/guide.md   via src\n' },
    ],
    exit: [['0', 'the dependents were listed, even when there are none.'], ERROR_EXIT],
    related: ['list-dependencies', 'agents'],
  },
  stats: {
    synopsis: ['docstamp stats [--json] [--root <dir>] [--since <n>d | --from <rev>] [<file>...]'],
    summary: "Report how often each file's dependencies would have made it stale.",
    description: `
Replays the commits of a window against the files each stamped file selects today, and counts the
commits that would have made it stale. Use it to judge a list before committing to it: a list that
goes stale on most commits is a list people stop reading. It only reports: it writes nothing,
reads no lock, never changes the verdict of check, and exits 0 whatever the numbers are.

Columns: patterns, files they select, commits and distinct days that would make the file stale,
stale (those commits over all commits of the window) and sweep (the share of those commits that
touch over 200 paths). It needs the full git history (fetch-depth: 0 in CI), else E_HISTORY.`,
    options: [
      JSON_OPTION,
      ROOT_OPTION,
      ['--since <n>d', 'The last <n> days, written like 30d (1d to 3650d). The default: 30d.'],
      ['--from <rev>', 'The commits of <rev>..HEAD, which does not move from day to day.'],
      ['<file>...', 'Measure only these stamped files.'],
    ],
    reads: 'the configuration file, the docstamp blocks, the file tree and git history.',
    writes: 'nothing.',
    examples: [{ args: ['stats'] }, { args: ['stats', '--from', 'v1.0.0', 'docs/guide.md'] }],
    exit: [
      ['0', 'the statistics were listed.'],
      ['2', 'E_HISTORY, an invalid file, or an error.'],
    ],
    related: ['suggest', 'patterns'],
  },
  suggest: {
    synopsis: ['docstamp suggest [--json] [--root <dir>] [--write] <file>...'],
    summary: 'Propose dependencies from the paths each file mentions.',
    description: `
Reads each named file and proposes its dependencies from the repository paths it mentions (code
spans, links, paths in the prose), with the number of files each pattern selects and its stale
rate over the last 30 days (n/a without git history). Generic files such as package.json and
ignored paths are not proposed. A glob that selects test files is followed by exclusions of them
(!<scope>/**/*.test.* and the like). For a file that already declares dependencies, a status column
says declared (the same pattern), covered (the declared patterns already select its files) or new,
and only declared lines list the declared patterns it no longer mentions.

Read the proposal before keeping it: a mention can be an illustration, and a directory can select
many files. It is the quick way to enroll an existing doc: suggest --write, review, then update.`,
    options: [
      JSON_OPTION,
      ROOT_OPTION,
      [
        '--write',
        'Write the proposal into the file as a docstamp block without hash, so the file stays ' +
          'unrecorded until reviewed. A block that already declares patterns keeps them, in ' +
          'order, and gains only new ones; an addition that would change what they select is ' +
          'left out. Refuses (E_USAGE) a block that has a hash, a file declared in the ' +
          'configuration file, and a block with use that cannot be extended line by line.',
      ],
      ['<file>...', 'The files to read. At least one.'],
    ],
    reads: 'the configuration file, the named files, the file tree and git history (stale rate).',
    writes: 'with --write, the docstamp block of each named file that has a proposal.',
    examples: [
      {
        args: ['suggest', 'docs/notes.md'],
        out: `suggest docs/notes.md
  pattern      files   stale
  src/hash.ts      1  0.5000
`,
      },
      {
        args: ['suggest', 'docs/guide.md'],
        out: `suggest docs/guide.md
  pattern      files   stale  status
  src/cli.ts       1  1.0000  covered
  src/hash.ts      1  0.5000  covered
  only declared  src
  only declared  !src/**/*.test.ts
`,
      },
      { args: ['suggest', '--write', 'docs/notes.md'] },
    ],
    exit: [['0', 'the proposal was listed, even when it is empty.'], ERROR_EXIT],
    related: ['start', 'inline', 'stats'],
  },
  help: {
    synopsis: [
      'docstamp help [<command> | <topic>]',
      'docstamp help diagnostics <code>',
      'docstamp <command> --help',
    ],
    summary: 'Print the index, a command page or a topic page.',
    description: `
Without a name: the index of commands and topics. With a command or topic: its page. With
diagnostics and a code: that code alone. It reads no file. --help anywhere before -- prints the
page of the command word given, or the index when there is none.`,
    options: [],
    reads: 'nothing.',
    writes: 'nothing.',
    examples: [
      { args: ['help', 'start'] },
      { args: ['update', '--help'] },
      { args: ['help', 'diagnostics', 'E_EMPTY_PATTERN'] },
    ],
    exit: [
      ['0', 'the page was printed.'],
      ['2', 'an unknown name (E_USAGE lists the names).'],
    ],
    related: ['start', 'agents'],
  },
  version: {
    synopsis: ['docstamp version', 'docstamp --version'],
    summary: 'Print the installed version.',
    description: 'Prints the version of the installed package. It reads no file.',
    options: [],
    reads: 'nothing.',
    writes: 'nothing.',
    examples: [{ args: ['version'] }],
    exit: [['0', 'always.']],
    related: ['help'],
  },
};
