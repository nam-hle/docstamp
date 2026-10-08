import type { Example } from './help-format.ts';

export interface TopicPage {
  readonly summary: string;
  readonly body: string;
  readonly examples?: readonly Example[];
}

// SPEC §13.11 step 3; `diagnostics` and `spec` add generated parts in help.ts
export const TOPICS = {
  start: {
    summary: 'From nothing to a first passing check, with a configuration file or inline.',
    body: `
docstamp fails a build when a file's dependencies changed since someone last reviewed that file.
You declare what each file (usually a doc) depends on; docstamp hashes those dependencies, and
docstamp update records the hash when a review is done. Requires Node.js 24 or newer.

1. Install it in the repository (or run it with npx docstamp):

    pnpm add -D docstamp

2. Declare the dependencies. Either in docstamp.yaml at the repository root (docstamp help config):

    version: 2
    files:
      docs/guide.md:
        dependencies:
          - src
          - "!src/**/*.test.ts"

Or in the frontmatter of a Markdown file, with no configuration file at all in a git repository
(docstamp help inline):

    ---
    docstamp:
      dependencies: [docs/guide.md]
    ---

To enroll an existing doc quickly, docstamp suggest --write <doc> proposes its dependencies from the
paths it mentions and writes them as such a block. Read the proposal and trim it.

3. Run docstamp. On the first run every file is stale (unrecorded): no review is recorded yet.

4. Review each file against its dependencies, fix it, then run docstamp update <file>. At the first
adoption, docstamp update --all records every file once you reviewed them all. Commit the files
and docstamp-lock.yaml (created only for files declared in the configuration file).

5. Run docstamp in CI. It exits 1 when a file is stale and 2 on an error. Fetch the full history
(fetch-depth: 0) so that a stale report can name the changed files.

When it fails later, follow docstamp help agents.`,
    examples: [
      {
        args: ['suggest', '--write', 'docs/notes.md'],
        out: `suggest docs/notes.md
  pattern      files  stale
  src/hash.ts      1    n/a
written  docs/notes.md
`,
      },
      {
        args: ['docs/notes.md'],
        exit: 1,
        out: `STALE    docs/notes.md  (unrecorded)
  depends   src/hash.ts
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update docs/notes.md
  run update only after the review, never --all just to pass; see docstamp help agents
`,
      },
      { args: ['update', 'docs/notes.md'], out: 'written  docs/notes.md\n' },
    ],
  },
  config: {
    summary: 'The configuration file: docstamp.yaml or docstamp.config.ts, and every key.',
    body: `
The configuration file sits at the root. It is one of docstamp.yaml, docstamp.config.ts,
docstamp.config.mts, docstamp.config.js and docstamp.config.mjs; two of them are
E_CONFIG_AMBIGUOUS. Without one, only inline declarations exist (docstamp help inline).

    # yaml-language-server: $schema=https://unpkg.com/docstamp/schema.json
    version: 2
    gitignore: true
    ignore:
      - build/
    include:
      - "**/*.md"
    presets:
      no-tests:
        - "!**/*.test.ts"
    default-presets: [no-tests]
    files:
      docs/guide.md:
        dependencies:
          - src
          - "!src/gen"

- version: required, exactly 2. A file without it is E_CONFIG_VERSION: add version: 2 (or, for a version 1 file, migrate its keys).
- files: required, even when empty (E_CONFIG otherwise). Maps each file, by its path from the root, to dependencies (a non-empty list of patterns, docstamp help patterns) and optionally use (preset names, docstamp help presets). Write files: {} when every file is inline.
- gitignore: read the .gitignore files (default true). Ignored files are not in the universe and cannot be dependencies.
- ignore: more ignore rules, in .gitignore syntax, relative to the root.
- include: the patterns of the files searched for docstamp blocks (default "**/*.md").
- presets: named pattern lists that a file includes with use.
- default-presets: presets every file without its own use gets (docstamp help presets).
- Any other key is E_UNKNOWN_KEY. In YAML, quote a pattern that starts with ! or *.

The same value as a script, which must export plain data (no functions or class instances, no
top-level await). TypeScript runs through Node's type stripping, so no enum and no value
namespace. Import only docstamp:

    import { defineConfig } from 'docstamp';

    export default defineConfig({
      version: 2,
      files: { 'docs/guide.md': { dependencies: ['src', '!src/gen'] } },
    });

The root is --root, else the nearest directory upward with a configuration file, else the nearest
with .git. docstamp update writes docstamp-lock.yaml next to it; commit it. After a merge conflict
in the lock, take either side, run docstamp, review what is stale and update again.`,
  },
  inline: {
    summary: 'Declaring dependencies in the frontmatter of a Markdown file.',
    body: `
A file can carry its own declaration in a docstamp block of its frontmatter:

    ---
    title: Guide
    docstamp:
      dependencies: [src, "!src/gen"]
      use: [no-tests]
      hash: <64 lowercase hex digits>
    ---

- docstamp: must start in column 0 and hold a block mapping, not a flow mapping.
- dependencies is required: a non-empty list of patterns (docstamp help patterns).
- use is optional: names of presets, which only the configuration file defines. Without use, the block gets the default-presets of the configuration file, if any; use: [] gets none.
- hash is written by docstamp update, alone on its line. Never write or edit it by hand.
- Searched files: those that include selects (default "**/*.md") and that are not ignored. Only a frontmatter with a docstamp: line is parsed, and strictly: no anchors, tags or duplicate keys.
- A malformed block makes only that file invalid (E_BLOCK, E_UNKNOWN_KEY, E_PATTERN); the others still run.
- update rewrites the hash: line, or appends it as the last key; every other byte stays. No lock is written for inline files.
- A file both under files and inline is E_DUPLICATE_DECLARATION.
- In a git repository, no configuration file is needed: the root is the nearest directory with .git.
- The hash: line is not part of the file's content for the files that depend on it, so updating B does not make A stale. Its prose, other frontmatter and dependencies still count.
- A formatter that rewrites the block changes the file; exclude the block from formatters.
- docstamp suggest --write <file> writes a block without hash.

The JSON Schema for this frontmatter: docstamp help schema.`,
  },
  patterns: {
    summary: 'The pattern language: paths, globs, ! exclusions, last match wins, escapes.',
    body: `
A pattern selects files of the universe: the files under the root, without ignored files (.gitignore
and the ignore key), .git, the root configuration file and docstamp-lock.yaml. Patterns are relative
to the root and use / as the separator on every platform.

    src/cli           the file src/cli, or every file under the directory src/cli
    src/*             * matches within one segment; a matched directory selects its files
    src/**/*.ts       ** matches any number of whole segments
    docs/?.md         ? matches one character other than /
    src/[a-c]*.ts     a class of characters; [!a-c] is its complement
    src/{cli,core}    alternation
    !src/gen          a leading ! excludes; \\! is a literal leading !

- The last matching pattern wins: write an exclusion after the patterns it cuts from. A later inclusion selects the excluded files again (W_SHADOWED_EXCLUSION).
- A pattern without ! must select a file (E_EMPTY_PATTERN), and the list together too (E_EMPTY_DEPENDENCIES). An exclusion that matches nothing is only W_EMPTY_EXCLUSION.
- \\ escapes the next character, so src\\cli is the literal srccli. Escape * ? [ ] { } , and \\ to mean them literally.
- Matching is case-sensitive, and a leading . is not special. No leading or trailing /, no . or .. segment.
- A file is never its own dependency. An ignored file cannot be a dependency: depend on its source.
- In YAML, quote a pattern that starts with ! or *.

docstamp list-dependencies <file> shows what a list selects.`,
  },
  presets: {
    summary: 'Named pattern lists shared by many files (presets and use).',
    body: `
When many files repeat the same lines, define them once under presets in the configuration file
and name them with use, in a files entry or in a docstamp block:

    presets:
      no-tests:
        - "!**/*.test.ts"
    files:
      docs/guide.md:
        dependencies: [src]
        use: [no-tests]

- A file's patterns are its own dependencies first, then each preset in use order; the last match still wins, so list exclusion presets last.
- Names are [a-z][a-z0-9-]*; a preset is a non-empty list of patterns and cannot name another preset.
- dependencies stays required; use is a non-empty list of distinct names.
- An unknown name makes the file invalid with E_UNKNOWN_PRESET.
- Editing a preset makes a file stale only when it changes the files that file selects.
- An exclusion of a preset that matches nothing gives no warning.
- list-dependencies and check mark preset patterns with (preset <name>).

default-presets names presets that every file gets, configured or inline, when it has no use key:

    presets:
      no-tests: ["!**/*.test.ts", "!**/__test__/**"]
    default-presets: [no-tests]

- They come last: the file's own dependencies, then the default presets in order.
- A file with its own use does not get them; re-list one to keep it. use: [] gets none, and is E_CONFIG (E_BLOCK inline) without default-presets.
- default-presets is a non-empty list of distinct names (E_CONFIG); an unknown name is a global E_UNKNOWN_PRESET that stops the run.
- An inline file gets the default-presets of the root configuration file; with no configuration file there are none.
- Editing default-presets is like editing a preset: only files whose selection changes go stale.
- In JSON a file that gets them has "use": [] and the preset names in origins.`,
  },
  states: {
    summary: 'The states ok, stale and invalid, and the reasons unrecorded and content-changed.',
    body: `
Each stamped file is in one state:

    ok        its dependencies hash to what was recorded at its last review
    stale     they do not, for one reason:
                unrecorded        no review was recorded yet (no lock entry, no hash: line)
                content-changed   a dependency changed: edited, added, deleted, renamed or moved,
                                  or the patterns now select another set of files
    invalid   it cannot be evaluated; an error diagnostic says why (docstamp help diagnostics)

A stale file needs a review: read the changes its block lists (or its dependencies), fix what the
file no longer gets right, then docstamp update <file> (docstamp help agents). An invalid file needs
its declaration fixed, then docstamp check <file>.

- Every byte counts, except that CR LF is read as LF in text files: whitespace, a final newline, a license header.
- An edit of the pattern list that selects the same files changes nothing.
- No propagation: if C depends on B and B on code, a code change makes B stale. C becomes stale only when B's content changes.
- Warnings (W_ codes) never change a state or an exit code.
- The changed-file report (modified, added, deleted, renamed lines and the review: line) reads git history and is advisory; without history the block lists depends lines instead.`,
  },
  'exit-codes': {
    summary: 'What each exit code means.',
    body: `
    0    check: every selected file is ok. update: written or already current. list-dependencies,
         list-dependents, stats, suggest: listed. help, version.
    1    check only: a selected file is stale, none is invalid, no global error.
    2    an error diagnostic, an invalid file, or a usage error.
    70   an internal fault, reported on standard error as "internal error:" and a stack.

Warnings never affect the exit code.`,
  },
  json: {
    summary: 'The shape of the --json output of every command.',
    body: `
With --json, one JSON document goes to standard output and nothing to standard error. Every
document starts with version (2), mode (the command) and exitCode, and ends with diagnostics: the
global ones, each { code, severity, file, subject, message }, file and subject null when empty.
Consumers must ignore members they do not know: later releases only add members.

- check: summary { ok, stale, invalid } and files, one per selected file: { file, state, reasons, dependencies, changes, diagnostics }. changes is null, or a list of { status, path, via } (whitespaceOnly and pair when they apply). dependenciesEdited and selection appear when the file's own list was edited; use and origins when it uses presets (use is [] when they are only default-presets).
- update: as check, with written true or false on each file and a top-level removed list. A written file reports state ok.
- list-dependencies: files of { file, dependencies, resolvedFiles, diagnostics }, plus use and origins with presets, default-presets included.
- list-dependents: files of { file, dependents: [{ file, via }], diagnostics }; with --transitive each dependent also has dependents, cycle and repeated.
- stats: window { kind, value, commits, untouched } and files of { file, patterns, resolvedCount, staleCommits, days, staleRate, sweepCommits, sweepShare, diagnostics }.
- suggest: files of { file, suggestions: [{ pattern, resolvedCount, staleRate, status }], ignored, declared, diagnostics }, plus written with --write.

A command that fails before it evaluates anything has an empty files list and no summary. Read the
verdict from exitCode and state, and the next step from the text mode's next: lines, which have no
JSON member: a stale file needs a review, then docstamp update <file>.`,
    examples: [
      {
        args: ['--json', 'list-dependents', 'src/hash.ts'],
        out: `{
  "version": 2,
  "mode": "list-dependents",
  "exitCode": 0,
  "files": [
    {
      "file": "src/hash.ts",
      "dependents": [
        {
          "file": "docs/guide.md",
          "via": [
            "src"
          ]
        }
      ],
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
`,
      },
    ],
  },
  diagnostics: {
    summary: 'Every diagnostic code, what it means and how to fix it.',
    body: `
A diagnostic is written to standard error as

    <severity>: <code>[: <file>][: <subject>]: <message>

An error (E_) makes its file invalid, or the run fail, with exit 2. A warning (W_) never changes a
state or an exit code. docstamp help diagnostics <code> prints one entry.`,
  },
  agents: {
    summary: 'The review workflow for AI agents, ready to paste into CLAUDE.md or AGENTS.md.',
    body: `
docstamp only decides when a review is due; the review is the reader's job, and docstamp update
asserts that it happened. When docstamp exits 1, for each stale file:

1. Read what changed: the modified, added, deleted and renamed lines of its block, and the
command on its review: line. Without them, docstamp list-dependencies <file> lists the
dependencies; compare them with the version that was reviewed.

2. Read the file and fix every claim the change made untrue. A change that does not affect the
file needs no edit.

3. Only then run docstamp update <file>, naming that file.

Never run docstamp update without that review, and never use update --all, or edit a hash: line, to
make the check pass. Exit 2 is not a review matter: fix the declaration its diagnostic names
(docstamp help diagnostics <code>), then run docstamp check <file>. Before changing code, docstamp
list-dependents <file> shows which docs the change affects, so they can be fixed in the same change.

Paste into CLAUDE.md or AGENTS.md:

    ## Docs
    docstamp fails when a doc's dependencies changed since it was last reviewed. When it
    fails, for each stale doc: read the changed files it lists (git diff for more context),
    compare them with what the doc claims, and fix every claim that is no longer true. Only
    then run docstamp update <doc>. Never run docstamp update without that re-check, and
    never use --all to make the check pass.`,
  },
  schema: {
    summary: 'The JSON Schemas the package ships, and how to point an editor at them.',
    body: `
The package ships two JSON Schemas (draft-07). docstamp itself does not read them; it checks the
same rules on its own.

    schema.json               the configuration file docstamp.yaml
    schema-frontmatter.json   the frontmatter of a file with a docstamp block

They are at the top of the installed package (in a project, node_modules/docstamp/schema.json),
exported as docstamp/schema.json and docstamp/schema-frontmatter.json, and online at
https://unpkg.com/docstamp/schema.json (the latest release). For editor completion in
docstamp.yaml, start it with one of:

    # yaml-language-server: $schema=https://unpkg.com/docstamp/schema.json
    # yaml-language-server: $schema=./node_modules/docstamp/schema.json`,
  },
  spec: {
    summary: 'Where the specification is, and its sections.',
    body: `
The specification defines all observable behavior: formats, algorithms, output, diagnostics, exit
codes and compatibility. The help pages summarize it; it decides. It ships with the package, for
the installed version, as docs/SPEC.md (in a project, node_modules/docstamp/docs/SPEC.md), and is
online at https://github.com/nam-hle/docstamp/blob/main/docs/SPEC.md. Clauses are numbered, such
as 8.4 for selection; search the file for the heading. Its sections:

    1 Scope
    2 Conformance
    3 Notational Conventions
    4 Terms
    5 Records
    6 Root
    7 Universe
    8 Patterns
    9 Configuration File
    10 Hashing
    11 Lockfile
    12 Evaluation
    13 Command Line
    14 Output
    15 Diagnostics
    16 Exit Codes
    17 Compatibility`,
  },
} as const satisfies Record<string, TopicPage>;

export type Topic = keyof typeof TOPICS;
