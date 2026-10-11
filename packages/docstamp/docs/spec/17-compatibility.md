## 17 Compatibility

A user commits a Lockfile and runs `docstamp` in CI. This clause defines which changes to docstamp
may alter what that Lockfile and that CI mean, and how they are announced.

### 17.1 Definitions

A *release* is a published version of docstamp. A change is *breaking* iff, for some Root, command
line or consumer that a previous release accepted, it makes a release do any of the following:

- compute a different Dependency Hash (§10.4) for the same Lockfile version;
- select a different set of dependencies (§8.5, §7.2);
- reject, or read with a different meaning, a Configuration file, Lockfile or command line that the
  previous release accepted;
- reach a different verdict (§12.1), exit code (§16) or Diagnostic code or severity (§15);
- change the shape or meaning of output that a program reads (§14.5);
- stop running on a platform it supported.

The classification of §17.2 is normative; where a change fits a row, the row decides.

### 17.2 Breaking changes

A change to any of the following is breaking:

| Area | Breaking |
|---|---|
| Hash inputs | the hash algorithm (§10.3); the normalization of content (§10.1, §10.2), including CR LF handling, a byte order mark, the binary sniff, the link rule and the `file`/`link` tags; anything that feeds the Dependency Hash, or its byte layout (§10.4), including the `content` of the Builtin Plugins (§8.8); the order of its entries (§3.3) |
| Selection | the pattern dialect or its parsing (§8.1); pattern matching, negation order or directory semantics (§8.2 to §8.5); the Universe: which entries it holds, ignore rules, `.gitignore` handling, the excluded names, path normalization and collisions (§7); symbolic link handling (§7.1) |
| Formats | the `version` of the Configuration file (§9.3) or the Lockfile (§11.1); a key name of either; the accepted Configuration file names and their precedence (§9.1); the canonical form of the Lockfile (§11.2) |
| Verdicts | what is `stale` or `ok`; the Reasons (§5.4); any Diagnostic that turns a run from passing to failing or the reverse, including a warning that becomes an error and an error that becomes a warning (§15, §16) |
| Contract | an exit code or its meaning (§16); the name, severity or meaning of a Diagnostic code (§15); a member of the JSON output removed, renamed or given another meaning, or the JSON output `version` (§14.5); a command name, an option name, or the meaning of an argument (§13) |
| Platform | the minimum Node.js version (the `engines` field of the package); how a script Carrier is loaded or what it may export (§9.5); a member of the Plugin API removed or given another meaning, or an `[[ApiVersion]]` no longer accepted (§8.7) |

NOTE: An exclusion that matches nothing was `E_EMPTY_PATTERN` and is `W_EMPTY_EXCLUSION` (§8.5): an
error that becomes a warning, so a *Verdicts* change and breaking. A file that was `invalid` for
this reason alone becomes `ok` or `stale`, and exit code 2 becomes 0 or 1; nothing needs to
migrate. No Hash input and no selection changes (§8.4 is unchanged), so the Lockfile `version`, the
Dependency Hashes and the pinned vectors of §17.7 stay as they are.

NOTE: An ignore rule was matched against the name as stored on disk and kept a space after an
escaped backslash; it is now matched against the NFC form (§7.2 step 3.4) and trims that space
(§7.3 step 2). The Universe changes, so *Selection* applies and the Lockfile `version` is 4
(§17.4 step 2). The migration is to review every file and run `docstamp update --all` (§11.1 step
4). The Hash algorithm and the pinned vectors of §17.7 are unchanged, since their trees hold no
such name or rule. An inline `hash:` line (§5.6) is not refused: a doc whose selection changed
reports stale; review it and run `docstamp update <file>`.

NOTE: An unknown key in an inline block was reported as `E_UNKNOWN_KEY` and, when it stood in for
`dependencies`, also as `E_BLOCK` (§9.6.2); it is now `E_UNKNOWN_KEY` alone. The file is `invalid`
and the exit code is 2 before and after, so no verdict changes, but the set of Diagnostic codes of
that run does (§17.1, fourth item; *Contract*: the meaning of `E_BLOCK`), so it is breaking. The
migration is to read `E_UNKNOWN_KEY` where a consumer looked for `E_BLOCK` with subject
`dependencies` on a file that also had an unknown key. No Hash input, selection or Lockfile
`version` changes.

NOTE: A file argument that does not resolve inside Root (§13.4) was `E_UNKNOWN_FILE` for `check`,
`update`, `list-dependencies` and `stats` (§13.3), and `E_USAGE` for `list-dependents` and
`suggest`, with the same message; it is now `E_USAGE` for every command. The exit code is 2 before
and after, but the Diagnostic code of that run changes (§17.1, fourth item), so it is breaking. The
migration is to read `E_USAGE` where a consumer looked for `E_UNKNOWN_FILE` with a message that
says the argument resolves outside Root; `E_UNKNOWN_FILE` now always means a file inside Root that
is neither declared nor carries an inline block. No Hash input, selection or Lockfile `version`
changes.

NOTE: One mistake gives one Diagnostic. A top-level key of the Configuration file whose near key is
`files`, with `files` absent (`fils: {}`), was `E_UNKNOWN_KEY` and `E_CONFIG` (subject `files`); it
is now `E_UNKNOWN_KEY` alone (§9.3 step 7), whose message names `files`. A Declaration whose
inclusions include one that matches nothing, so that nothing is selected (`src\core` as the only
pattern), was `E_EMPTY_PATTERN` and `E_EMPTY_DEPENDENCIES`; it is now `E_EMPTY_PATTERN` alone
(§8.5 step 6). The verdict (`invalid`, or a refused run) and the exit code 2 are unchanged, but the
set of Diagnostic codes of that run changes (§17.1, fourth item), so it is breaking. The migration
is to read `E_UNKNOWN_KEY` where a consumer looked for the `E_CONFIG` of a missing `files`, and
`E_EMPTY_PATTERN` on the file where it looked for `E_EMPTY_DEPENDENCIES`; `E_EMPTY_DEPENDENCIES`
now means that no inclusion is empty, yet together the patterns select nothing. A subject with a
`\` is no longer quoted on a Diagnostic line of text mode (§14.3); that is text layout (§17.3),
and `--json` is unchanged. No Hash input, selection or Lockfile `version` changes.

NOTE: A first non-option argument that names no existing path and is one or two edits from a
command name (`docstamp updte`) was a file argument of `check`, refused with `E_UNKNOWN_FILE`,
`E_USAGE` (outside Root) or a Root error such as `E_CONFIG_MISSING`; with `--help` it printed the
index and exited 0. It is now a mistyped command (§13.2 step 2): `E_USAGE`, exit 2, before any
Root is read, with or without `--help`. A command line that exited 0 now exits 2 and the
Diagnostic code changes (§17.1, fourth item), so it is breaking. The migration is to spell the
command, or to write `--` before a file argument that does not exist and is named like a command
(`docstamp -- updte`). An existing path is read as a file exactly as before. No Hash input,
selection or Lockfile `version` changes.

NOTE: A script Carrier may now export a top-level `plugins` member, and a `dependencies` List may
hold Maps (§8.7). `plugins` was `E_UNKNOWN_KEY` and a Map element was `E_CONFIG`: an error that
becomes a pass, so *Platform* (what a script Carrier may export) and *Verdicts*: breaking. The
migration is none for existing files. No Hash input, selection or Lockfile `version` changes for a
file without Selected Dependencies.

NOTE: The option `--root <dir>` is removed (§13.2) and `--cwd <dir>` takes its place (§13.4). It is
breaking under *Contract*: an option name, the meaning of an argument, and the Diagnostic code
`E_ROOT`, which is now `E_CWD`. `--root D` made *D* the Root without a search and left file
arguments to resolve against the current directory of the process; `--cwd D` runs as if from *D*:
the Root is found by §6 from *D*, and file arguments resolve against *D*. The migration is to write
`--cwd D` for `--root D`, and, where the old command passed file arguments relative to the process
directory, to write them relative to *D*. A *D* with no Configuration file and no `.git` at or above
it, which `--root` accepted, is now `E_CONFIG_MISSING`: add a Configuration file to it. The `next:` and `review:` lines (§14.3.3, §14.3.4) print `--cwd`. No Hash
input, selection or Lockfile `version` changes.

NOTE: A String of `dependencies` with a `:` that is not escaped, `docs/guide.md:Install`, was a
Pattern whose `:` was a Literal; it is now a Shorthand, a Selected Dependency (§8.7). A file or a
glob with an unescaped `:` in its name, as `notes:2024.md`, changes meaning: it was selected and is
now `E_CONFIG` (`E_BLOCK`), or a Selected Dependency of another path. The Pattern dialect and the
Universe change, so *Selection* applies, and so do *Verdicts*. The Lockfile `version` is 4, which no
release had yet when this changed (§17.4 step 2): version 4 is the one version that holds it, and
no new version is raised. The migration is to write `\:` for each `:` of such a name (`notes\:2024.md`),
which is the same Pattern as before; the Hash and the selection of the Declaration are then what they
were. A Shorthand adds no Hash input: its Dependency Hash is that of the Map it stands for, and the
vectors of §17.7 are unchanged.

### 17.3 Non-breaking changes

The following are not breaking:

- the wording of a Diagnostic `[[Message]]` (§5.5), which is informative; a test MAY snapshot it,
  and then the snapshot is updated with the change. This covers the near key named by
  `E_UNKNOWN_KEY` and `E_CONFIG` (§9.3 NOTE), the messages of `E_CONFIG_VERSION` for a first
  configuration file and of `E_CONFIG` for a missing `files` (§9.3 steps 4 and 7), which change
  no code and no Diagnostic order, and the renamed path named by `E_EMPTY_PATTERN`
  (§8.5 NOTE, §12.7), whose read of the history changes no verdict, code or exit code;
- a new Diagnostic with severity `warning`, which never affects the exit code (§16);
- a new command, or a new option that no existing command line uses: `stats` (§13.9), its options
  and the Diagnostic code `E_HISTORY`, which only it raises. The command has no option that sets an
  exit code. A bare argument `stats` used to be a
  file argument of `check`; it is now the command, and a file literally named `stats` is reached
  with `--` (§13.2), as for every other command word;
- `--only-stale` and `--quiet` of `check` (§13.5): new options that no existing command line uses,
  whose absence leaves every output as it was. Used with another command they are `E_USAGE`, as
  every unknown option was;
- the layout of the text output of §14.3: group lines (§14.3.1), the order in which the two streams
  are written (§14.3.2), the `next:` lines (§14.3.3), and the whitespace marker and the review line
  (§14.3.1, §14.3.4). A program reads the verdict from the exit
  code and from `--json` (§14.5), never from this layout. Standard error keeps every line and its
  order;
- `suggest` (§13.10), its option `--write`, and the proposal rules of §12.6, §9.6.5 and §14.9. It
  raises no new Diagnostic code, no command line that was accepted changes meaning, and no existing
  command changes. A bare argument `suggest` used to be a file argument of `check`; it is now the
  command, and a file literally named `suggest` is reached with `--` (§13.2), as for every other
  command word. `--write` without `suggest` is still refused (§13.2);
- a new member of the JSON output (§14.5: consumers ignore unknown members);
- *declared* of `suggest` (§13.10 step 4): the `status` column and the `only declared` lines of
  §14.9 for a file that already has a declaration, and the member `declared` of §14.5. A file
  without one prints exactly what it printed; the proposal, `--write` and the exit code are
  unchanged;
- the *status* `covered` of `suggest` (§13.10 step 4): a value of the `status` column of §14.9 for
  a Suggestion whose files the declared patterns already select, which was `new`, and the member
  `status` of a Suggestion in §14.5, a new member. The proposal and the exit code are unchanged;
- the legend line of `stats` in text mode (§14.8): a fixed line after the `window:` line; the rows,
  the `window:` line and `--json` are unchanged, and `stats` still exits 0;
- `[[Edited]]` (§5.4, §12.3 step 1.4): the edited line and the summary line of §14.3, and the
  member `dependenciesEdited` of §14.5. It is not a Reason, so `reasons` and every verdict are
  unchanged. `changes` may now be `[]` where it was `null`, for a file whose own list lost a
  pattern and whose dependencies did not change; `changes` was already defined as a List or
  `null`, and the changed-file report may vary with the history (§2);
- `[[Pair]]` (§12.3 step 8): the `renamed` change and group lines of §14.3.1, and the member `pair`
  of a Change in §14.5. Every Change is still listed in `changes` with the status it had, so a
  consumer that ignores `pair` reads what it read before;
- a change to the output of `--help`, `--version` or the changed-file report (§2); this includes
  the description of `update` in `--help`, reworded to hold for inline files too;
- the help pages of §13.11: `help <command>`, `help <topic>`, `help diagnostics <code>` and
  `<command> --help`, which printed the same usage before. A help name used to be ignored; an
  unknown one is now `E_USAGE` with exit 2. Help is read by people and agents, not parsed, and a
  bare `docstamp help` or `--help` still exits 0. So is shipping `docs/SPEC.md` in the package,
  which no command reads, the rule line after the stale `next:` line (§14.3.3, text layout of
  §14.3), and the wording of the `E_USAGE` and `E_CONFIG_MISSING` messages that name a help page;
- `help diagnostics <code>` with a code in another letter case (§13.11 step 4): it was `E_USAGE`
  with exit 2 and now prints the entry and exits 0, which only a person reads;
- `-h` (§13.1, §13.2): the same option as `--help`. It was an unknown option, `E_USAGE` with exit
  2, so no command line that a release accepted changes meaning;
- the warnings `W_DUPLICATE_PATTERN`, `W_SHADOWED_EXCLUSION` (§8.5) and `W_UNKNOWN_PATH` (§13.8): new, warning severity,
  no change to a verdict, a Hash, a selection or an exit code; `list-dependents` still exits 0
  for a path it does not know;
- the `[[Message]]` of the `E_USAGE` of §13.8 step 3 now names the directory and Root it was
  resolved against; the code, the exit code and the resolution of §13.4 are unchanged; so does
  the `[[Message]]` of the Diagnostic of §13.3 and of the `E_USAGE` of §13.10 for an argument
  that does not resolve inside Root, with the same code and exit code (the code of §13.3 later
  changed, §17.2 NOTE);
- the files of a `next:` line (§14.3.3) written relative to the current directory when it is not
  Root, so that the command shown runs as printed; it is part of the text layout of §14.3;
- `--transitive` (§13.2, §13.8): a new option of `list-dependents` that no existing command line uses;
  without it the output is unchanged;
- a new file shipped in the package, such as `schema-frontmatter.json` (§5.6), which no command reads;
  so is a change to a shipped JSON Schema that rejects only what §8.1 already rejects, such as an
  empty pattern or a lone `!`;
- Presets (§8.6): the optional key `presets` of the Configuration file (§9.3), the optional key `use`
  of a file and of an inline block, the Diagnostic code `E_UNKNOWN_PRESET`, and the members `use` and
  `origins` of `list-dependencies` for a file that uses a Preset. No existing input uses them: a Configuration file or block that
  does not name them behaves exactly as before, with the same Dependency Hashes, selection, verdicts,
  exit codes and output, and an old release refuses `presets` and `use` with `E_UNKNOWN_KEY` rather
  than reading them differently. The pattern dialect (§8.1) is unchanged, which is why no new pattern
  form carries a Preset. Hash inputs are unchanged too: the Dependency Hash depends on the resolved
  files only (§10.4), and the vectors of §17.7 stay as they are.
- default Presets (§8.6): the optional key `default-presets` of the Configuration file (§9.3), the
  empty `use` that opts out of them, and `E_UNKNOWN_PRESET` as a global Diagnostic for one of their
  names. No existing input uses them: an old release refuses `default-presets` with
  `E_UNKNOWN_KEY`, and an empty `use` stays `E_CONFIG` or `E_BLOCK` in a Root without
  `default-presets`, as before, so a Root that does not name the key behaves exactly as before.
  `use` and `origins` (§14.5) are the members Presets already added, now also present, with
  `"use": []`, on a file that gets the default Presets. Hash inputs, the pattern dialect, the
  Lockfile and its `version`, and the vectors of §17.7 are unchanged.
- a bug fix whose previous behavior contradicted this specification, unless it changes a Dependency
  Hash or the selection of dependencies (§17.4): a Lockfile records the value the previous release
  computed, so such a fix is breaking.
- inline declarations (§5.6, §9.6) and what they bring with them: the key `include` (§9.3), the
  Diagnostic codes `E_BLOCK` and `E_DUPLICATE_DECLARATION`, the Root found by `.git` (§6), and the
  rule that a Root with no Configuration file may have inline files only. A Root with no `docstamp:`
  line in column 0 in the frontmatter of a file that `[[Include]]` selects behaves exactly as
  before: the same Dependency Hashes, selection, verdicts, exit codes and output, and the same
  Lockfile bytes. The one exception is a Root that already has such a line in a Markdown
  frontmatter, which no earlier release gave a meaning; it can opt out with `include`. This is
  also why §10.2 step 4 does not change a Hash for a file with no inline block, and for one with an
  inline block that has no `hash` line.
- `[[Selection]]` (§5.4, §12.3 step 10): the selection lines of §14.3 and the member `selection` of
  §14.5, part of the changed-file report; no `changes`, verdict or exit code changes;
- `[[Fragments]]` (§5.4, §12.3 step 11): the fragment lines of §14.3 and the member `fragments` of
  §14.5. A stale Result with Selected Dependencies had `changes` `null` and `depends` lines; its
  `changes` is now a List (possibly empty) and the block lists what changed, with the Focus and the
  Lines of each Part when its Plugin gives them (§8.7). Both are advisory. The state, the
  reasons, the Hash and the exit code are unchanged, and the report may vary with the history (§2);
- the `-M` of the review line and the untracked line (§14.3.4), the `(preset <name>)` marker on a
  `depends` line of `check` (§14.3) and the wording of the second `next:` line for inline files
  (§14.3.3): text layout of §14.3; and the members `use` and `origins` in `check` and `update`
  (§14.5), new members;
- the test exclusions of a glob in a proposal (§12.6 step 9): a proposal rule of §12.6, like the
  directory exclusions; `suggest` prints and `--write` writes them, and nothing else reads them;
  so is dropping a scoped test exclusion that the same unscoped one makes redundant (§12.6 step 10):
  the written list selects the same files;
- `suggest --write` on a block without a `hash` that declares patterns (§9.6.5 steps 2.3 to 2.5,
  §13.10 step 7): it used to replace the list by the proposal, dropping every declared pattern the
  proposal lacked; it now keeps the declared patterns first and adds only `new` ones that leave
  their selection intact, extending a block list line by line and so keeping its `use` and
  comments. Every command line exits as before: a block that `suggest --write` refused (a `hash`,
  or `use` in a block it must rewrite) is still refused with `E_USAGE`, and no input is newly
  refused. It writes only a file that was not stamped, so no Hash, Lockfile or verdict of `check`
  changes, and `suggest` without `--write` writes nothing, as before;
- the indent of a block that `suggest --write` adds to an existing frontmatter (§9.6.5 step 3): it
  writes a file that was not stamped, the block declares the same patterns, and §9.6.5 step 5 still
  checks it;
- the optional `validateSelect` member of a Plugin (§8.7 `ValidateSelect`) and the optional `code` of
  a Plugin diagnostic, with `[[PluginCode]]` of a Diagnostic (§5.5), its bracketed tail in §14.3 and
  its member `pluginCode` in §14.5: optional members of the Plugin API, which keeps `[[ApiVersion]]`
  1; a Plugin that gives neither behaves as before, and no code, state, Hash or exit code changes;
- the optional `selectorFields` member of a Plugin (§8.7): an optional member of the Plugin API,
  which keeps `[[ApiVersion]]` 1; a Plugin without it is addressed by the Shorthand with its `select`
  as the String verbatim, and an old release ignores it (§8.7), so its own Shorthand is the breaking
  part, not this member.

### 17.4 The Hash Guarantee

1. For a given Lockfile `version`, the Dependency Hash of a given input (a Root's selected
   dependencies and their contents) MUST NOT change between releases.
2. Any change to a hash input or to the selection of dependencies (the rows *Hash inputs* and
   *Selection* of §17.2) MUST be released with a new Lockfile `version`.
3. A release MUST either verify every Lockfile version it names as supported, with the algorithm
   of that version, or refuse a Lockfile of another version with `E_LOCK_VERSION` (§11.1) whose
   message names the migration. It MUST NOT recompute a Hash in place of the recorded one, and MUST
   NOT accept a recorded Hash that now means something else.
4. A refusal is never silent and a migration is never implicit: only `docstamp update` writes a
   Lockfile (§13.6).

### 17.5 Current policy

A release supports exactly one Lockfile version, the one in the header of this document, and
refuses every other with `E_LOCK_VERSION` (§11.1). It keeps no algorithm of an older version. When
the Hash algorithm is unchanged between two versions, as between versions 3 and 4, which differ
only in the selection (§11.1 NOTE), the message says what changed, and `docstamp update --all`
after a review migrates.

A release that keeps verifying an older Lockfile version MUST, before it ships:

1. specify the algorithm of that version in this document, normatively, including its selection;
2. keep that algorithm, and the vectors of §17.7 for it, for as long as it is supported;
3. verify without writing: `check` MUST NOT rewrite the Lockfile, and `update` MUST either write
   the version it read or migrate every entry, never mix versions in one file;
4. treat dropping that support as a breaking change (§17.2, *Formats*).

A deprecation notice for an older version MAY be a new `warning` Diagnostic (§17.3).

An inline `hash` (§5.6) has no version of its own: it is the Dependency Hash of the Lockfile
version of this document. A future change to the hash rules adds an explicit optional key to the
block, whose absence means the rules of this version. A release that does not know the key refuses
it with `E_UNKNOWN_KEY` (§9.6.2 step 5), as it refuses a Lockfile of another version with
`E_LOCK_VERSION`, so §17.4 holds: it never accepts a Hash that now means something else.

### 17.6 Versioning and migration notes

- Before version 1.0.0 of the package, a breaking change raises the minor version; from 1.0.0 it
  raises the major version. A change that is not breaking never does.
- Each of the Configuration `version`, the Lockfile `version` and the JSON output `version` is
  raised only by a breaking change to its own format and by none other.
- Every breaking change MUST ship a migration note in the release notes: what changed (before and
  after) and the steps a user takes. The note is stated where the change is made, in the commit
  message, and is not inferred afterwards.
- Selected Dependencies, Plugins (§8.7, §8.8) and the Dependency Hash lines of §10.4 step 3 are not
  in a release before the one that first contains them, so the shape of a Plugin's result, the
  layout of those lines, the codes `E_SELECT`, `E_SELECT_NOT_FOUND` and `W_SELECT` and the vectors
  of §17.7 that cover them may change until that release, with no Lockfile `version` and no
  migration note.

### 17.7 Pinned vectors

The test suite of an implementation MUST pin, as literals computed once from a release (§17.6 says
which vectors may change until the release that first contains them):

- the file Hashes and the Dependency Hashes (§10) of a fixed tree that covers plain text, CR LF
  against LF, a byte order mark, binary bytes, an empty file, a symbolic link, a deleted
  dependency, a directory dependency of several files, a glob with a negation, and the order of
  entries;
- the selected dependencies (§8.4) of a fixed tree and pattern list, with ignore rules and
  `.gitignore` files in effect (§7);
- the file Hashes (§10.2 step 4) of a fixed tree of inline files: one with and one without a `hash`
  line (the same Hash), one whose `dependencies` differ (another Hash), one in CR LF, one with a
  byte order mark and one in `include` and one outside it, and a file with no block, whose Hash
  is the one of §10.3;
- the Dependency Hash with Fragments (§10.4 step 3):
  - entries `[('src/a.ts', 'a' x 64)]`, one Fragment { path `docs/guide.md`, select String
    `Install`, Parts with `[[Content]]` `« abc »` } gives
    `b97e1bef5907d4a4827ee34fcb74350137d74e7d8fd0c02db21bcd0b6a8e6ba5`;
  - no entries, one Fragment { path `docs/guide.md`, select Map `{ kind: function, name: abc }`,
    Parts with `[[Content]]` `« abc, def »` } gives
    `cf13425d12b91e9f192502bb184d8d8f30e0e6b3a8828a4f1ac2e5fcc4ee977c`;
- the Shorthand (§8.7) with the same Hash as its written form: for a Plugin that declares `main` `name` and the fields `name` (`string`), `kind` (`function`, `class`) and `part` (`shape`, `source`), `docs/guide.md:kind=function,name=abc` resolves to the Select Map of the second vector above and gives the same Dependency Hash `cf13425d12b91e9f192502bb184d8d8f30e0e6b3a8828a4f1ac2e5fcc4ee977c`, and `docs/guide.md:Install` resolves to the String `Install` of the first one and gives `b97e1bef5907d4a4827ee34fcb74350137d74e7d8fd0c02db21bcd0b6a8e6ba5`, with the same entries and Parts as there.

A change that makes a vector fail is breaking (§17.2). The vector is updated only together with a
new Lockfile `version` (§17.4) and its migration note (§17.6).
