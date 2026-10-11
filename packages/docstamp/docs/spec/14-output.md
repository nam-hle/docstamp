## 14 Output

### 14.1 Streams and Encoding

Standard output and standard error are UTF-8 without a byte order mark, with LF line endings and
a final LF, on every host.

In text mode, Results go to standard output and Diagnostics to standard error. With `--json`, one
JSON document goes to standard output and nothing to standard error.

Text mode MAY add color escape sequences only when standard output is a terminal and the
environment variable `NO_COLOR` is unset or empty. Removing them MUST yield the uncolored output.

### 14.2 Paths and Patterns in Text

In text mode, a RepoPath or pattern *s* is written as *s* if it contains no code point that
`Quote` (§3.4) would replace and no U+0020, `(` or `)`; otherwise as `Quote(s)`.

### 14.3 Check, Text Mode

One block per selected Result that is not `ok`, in path order.

```
STALE    <file>  (<reason>, <reason>)
  depends   <pattern>
```

or, for a stale Result with a known `[[Changes]]`:

```
STALE    <file>  (<reason>, <reason>)
  edited    <carrier>  (dependency list)
  added     <path>  (selection)
  changed   1 modified, 1 added, 5 deleted
  modified  <path>
  added     <path>
  deleted   <dir>  (5 files)
  fragment  <path>#<select>  (changed)
```

- The first line is `STALE` or `INVALID`, padded with spaces to 9 characters, then the
  file; for `stale`, two spaces and the Reasons in parentheses, separated by `, `.
- For `stale` with a known `[[Changes]]`, instead of the `depends` lines:
  - if `[[Edited]]` is not none, the *edited line*: `  edited    `, `[[Edited]]` as in §14.2, and
    `  (dependency list)`;
  - if `[[Selection]]` is not none, one *selection line* per SelectionChange in order: two spaces,
    the status padded with spaces to 8 characters, two spaces, the path as in §14.2, and
    `  (selection)` (`  added     <path>  (selection)`, `  removed   <path>  (selection)`). They
    are not grouped and not counted by the summary line;
  - if `[[Changes]]` has at least 5 Changes, the *summary line*: `  changed   ` and, for each status
    in the order `modified`, `added`, `deleted`, `renamed` that at least one entry of §14.3.1 has,
    `<n> <status>` with *n* the number of entries of that status, separated by `, `;
  - the *change lines* of §14.3.1. Each is two spaces, the status padded with spaces to 8
    characters, two spaces, and the path as in §14.2 (`  modified  <path>`, `  added     <path>`,
    `  deleted   <path>`, `  renamed   <from> -> <to>`), or a group line;
  - if `[[Fragments]]` is not none, one *fragment line* per FragmentChange in order, after the change
    lines: `  fragment  `, the path, `#` and `CanonicalJson(select)` as one String of §14.2, and
    `  (changed)` or `  (new)`, then, if `[[Parts]]` is not none, two spaces and a description of
    each Part that has a Focus or Lines (so a Part with neither is not described here, while the
    `"parts"` of §14.5 holds one element for each Part), joined by `; `: its Focus String, followed by
    `(lines <start>-<end>)` after a space when Lines is given (`lines <start>-<end>` alone when
    there is no Focus). They are not counted by the summary line.
- For any other `stale`: one `depends` line per pattern, in declaration order, with the
  `(preset <name>)` marker of §14.6 for a pattern that comes from a Preset, then one `depends` line
  per Selected Dependency (§8.7), in order of appearance: the path, `#` and `CanonicalJson(select)`,
  as one String of §14.2.

Then one summary line:

```
<n> ok, <m> stale, <k> invalid
```

counting the selected Results. With `--quiet`, the summary line is not output when no selected
Result is `stale` or `invalid`, so that standard output is empty on success; in every other case
it is output. When the command raised before any Result existed (§13.5), none
of this is output: no block, no summary line and no `next:` line, only the Diagnostics. Then the
`next:` lines of §14.3.3.

Each Diagnostic, global and attached, in Diagnostic order, is written to standard error as:

```
<severity>: <code>[: <file>][: <subject>]: <message>
```

omitting the bracketed parts when empty. A Diagnostic with a `[[PluginCode]]` ends its line with
a space and the code in square brackets (`... : <message> [heading-not-found]`). `<file>` is written as in §14.2, and so is `<subject>`,
except that a `\` alone does not make it quoted: a pattern or argument is shown as the user wrote
it (`src\core`, not `"src\\core"`). A Diagnostic line is read, never pasted as a command, so this
loses nothing. §14.3.2 says when each is written.

#### 14.3.1 Change Lines

Let *changes* be the `[[Changes]]` of a stale Result, in path order. Its *entries* are: for each
`deleted` Change *d* whose `[[Pair]]` is not none, one `renamed` entry from the path of *d* (its
*from*) to its `[[Pair]]` (its *to*); for every Change whose `[[Pair]]` is none, one entry of its
status and path. A paired `added` Change has no entry of its own.

A *run* is the set of entries of one status, `added` or `deleted`, whose path is one *directory*
*d* followed by exactly one more segment, where *d* is a String that ends with `/`; or the set of
`renamed` entries whose *from* is one directory *d* followed by one more segment *s* and whose *to*
is another directory *e* followed by the same *s*. A run with at least 5 entries is *grouped*: its
entries are replaced by one *group line*:

```
  added     <d>  (<n> files)
  deleted   <d>  (<n> files)
  renamed   <d> -> <e>  (<n> files)
```

two spaces, the status padded with spaces to 8 characters, two spaces, *d* as in §14.2 (for
`renamed`, then ` -> ` and *e* as in §14.2), two spaces and `(<n> files)` with *n* the number of
entries of the run. Every other entry, a `modified` one always and one of a run of fewer than 5,
is one *change line*: as in §14.3, followed by ` (whitespace only)` when the `[[WhitespaceOnly]]`
of its Change is true; for `renamed`, `  renamed   `, *from* as in §14.2, ` -> ` and *to* as in
§14.2. An entry is in the run of the directory it is directly in only: an entry in a subdirectory
is never in the run of its parent.

The lines are in path order of their path (*from* for `renamed`), a group line by *d* with its
trailing `/`; on a tie a group line of `added` precedes one of `deleted`, which precedes one of
`renamed`. Change lines and group lines are in text mode only: `changes` in `--json` always lists
every Change (§14.5). The last line of the block is the review line of §14.3.4.

The *rename lines* of a block are its change lines and group lines of status `renamed`, in order.
When a block has at least 2 rename lines and an earlier block of the same output has exactly the
same rename lines, they are replaced by one *same line* at the position of the first of them:

```
  renamed   (same <n> renames as <file>)
```

two spaces, `renamed` padded with spaces to 8 characters, two spaces, and `(same <n> renames as
<file>)`, with *n* the number of `renamed` entries of the block and *file* the file of the first
block of the output that printed those rename lines, as in §14.2. The summary line still counts
every entry, and the review line still lists every path: only the lines between them change.

NOTE: A move that several stale files depend on would otherwise print the same rename lines under
each of them. The first block in path order keeps them, so every block can be read alone with one
look up; a block whose renames differ in any line prints them all. JSON is unchanged (§14.5).

NOTE: A moved directory of 13 files, on which 5 files depend, prints one line per file, not 26:
`renamed   src/old/ -> src/new/  (13 files)`. Only a file whose content is unchanged is paired
(§12.3 step 8); a moved file that was also edited is a `deleted` and an `added` entry, and those
still form the runs above. A run is the files of one directory, so a moved tree of many small
directories is not shortened.

#### 14.3.2 Order of Output

Text mode writes to standard output and standard error in this order, so that on a terminal, or
with both streams merged, each Diagnostic follows the line it belongs to:

1. the global Diagnostics, to standard error;
2. for each selected Result in path order: its block, to standard output, when it is not `ok`;
   then its attached Diagnostics, to standard error, in Diagnostic order;
3. the summary line and the `next:` lines, to standard output.

Each stream, taken alone, holds what §14.3 and §14.1 define, in the same order (global
Diagnostics first, then the Diagnostics of each file in path order): the order above is not
visible to a consumer that reads the streams separately, as a command substitution does. With
`--json` nothing is written to standard error (§14.1).

#### 14.3.3 Next Lines

If any selected Result is `stale`, the line

```
next: review each stale file against its dependencies, then run: docstamp update <file> <file>
```

followed, after its `and <m> more` line if any, by the *rule line*

```
  run update only after the review, never --all just to pass; see docstamp help agents
```

and then, if any selected Result is `invalid`, the line

```
next: fix the configuration of each invalid file, then run: docstamp check <file> <file>
```

where `the configuration` reads `the docstamp block` when the Declaration of every invalid selected
Result is inline (§5.6), and `the configuration or docstamp block` when some are inline and some
configured.

Each lists the files of its state in path order, each written as in §14.2 as a file argument that
§13.4 resolves, from the working directory, to that file: its RepoPath when the working directory
is Root, else the relative path from the working directory to Root (§6 NOTE), `/`, and its
RepoPath, with `/` as the separator on every platform (`../repo/docs/a.md`). The list is followed
by ` --cwd ` and the `--cwd` value as given, if one was given. At most 10 files are listed. When there are
more, the line lists the first 10 and is followed by the line `  and <m> more`, two spaces, with
*m* the number of files not listed. There is no `next:` line for a state that no selected Result
has, and none when §13.6 step 5 refused an update (§14.4).

NOTE: The second line points at the Diagnostics that §14.3.2 writes under each `INVALID` line.
Updating the first 10 stale files and running `docstamp` again lists the next 10.

#### 14.3.4 Review Line

For a stale Result with a known `[[Changes]]` that is not empty, or with an `[[Edited]]` that is
not none, or with `[[Fragments]]` that are not empty, the block ends with one line:

```
  review: git diff -M <C> -- <arg> <arg>
```

two spaces, `review: `, and a read-only git command that shows what changed: *C* is `[[Base]]`
as git printed it, and each *arg* is written with `ShellQuote`. If `--cwd` was given, `git diff`
is `git -C <dir> diff`, *dir* the `--cwd` value as given, followed, when the working directory is
not Root, by `/` and the relative path from it to Root (§6 NOTE), written with `ShellQuote`, so
that the RepoPaths below are relative to the directory git acts in. `-M` lets git show a
renamed file as one rename rather than a deletion and an addition. The *args* are:

- if the Result has at most 10 Changes (the *path cap*): the `[[Path]]` of each Change in path
  order, written as `:(literal)<path>` when it starts with `:` or contains `*`, `?`, `[` or `\`,
  so that git does not read it as a pattern;
- otherwise, for each pattern of `[[Dependencies]]` in declaration order, with *glob* the pattern
  without its Negation: `:(glob)<glob>` and, if *glob* contains `*`, `?` or `[` and its last
  segment is not `**`, also `:(glob)<glob>/**` (git reads a name as a directory, but not a
  wildcard); for a pattern with a Negation, `:(exclude,glob)` in place of `:(glob)`. If any
  pattern contains `{`, the line is not output.

When `[[Edited]]` is not none and no Change has its path, that path follows the other *args*,
written as a Change's path is in the first form; it does not count toward the path cap. The path of
each FragmentChange follows in the same way, in order, once, unless a Change or the `[[Edited]]`
path is already one of the *args*.

When the review line is output in the first form and some of its Change *args* are the path of an
`added` Change that came from *untracked* (§12.3 step 2, not from *diff*), the review line is
followed by one line:

```
  untracked: git add -N -- <arg> <arg>
```

two spaces, `untracked: ` and the git command that makes git show those paths in the diff: the
same `git` or `git -C <root>` as the review line, then `add -N -- ` and those *args*, in path order,
written as in the review line. It is a hint, not part of the review: it changes the index, and
docstamp never runs it.

`ShellQuote(s)` is *s* if it is not empty and each of its code points is one of `A-Z`, `a-z`,
`0-9` and `_@%+=:,./-`; otherwise `'`, *s* with each `'` replaced by `'\''`, then `'`.

NOTE: The command compares the work tree with *C*, as §12.3 step 2 does, so the edits that are not
committed are in it; `<C>..HEAD` would leave them out. Git pathspecs are not patterns (§8): git lets
an exclusion win over every selection where the last matching pattern wins (§8.4), git has no
alternation (hence no line), and a file that git tracks but an ignore rule removed from the
Universe (§7.2) is in the diff. The second form may therefore list more files than the report. A
file that git does not track (an `added` Change from `git ls-files --others`, §12.3 step 2) is not
in the diff until `git add -N` names it, which is why the untracked line names them: after a plain
`mv`, without it the review line shows only the deletion. With the second form the untracked files
are not listed, since the patterns do not name them. Whether git pairs a rename with `-M` depends on
its similarity score; the report's own pairing does not (§12.3 NOTE), and the lines stay the same on
every host.

### 14.4 Update, Text Mode

One line per target in path order: `written  <file>` if it was written (§13.6 step 10), else
`unchanged  <file>`; then one line `removed  <file>` per removed entry in path order.
Diagnostics as in §14.3. When step 5 of §13.6 refused, the blocks and summary line of §14.3 are
output for the targets, in the order of §14.3.2, without the `next:` lines, and nothing is written. When the command
raised before any Result existed, only the Diagnostics are output.

### 14.5 JSON Mode

The document is the output of ECMAScript `JSON.stringify(value, null, 2)` followed by LF, except
that every string is encoded with `Quote` (§3.4). Object members appear in the order listed here.

```json
{
  "version": 2,
  "mode": "check",
  "exitCode": 1,
  "summary": { "ok": 12, "stale": 1, "invalid": 0 },
  "files": [
    {
      "file": "CLAUDE.md",
      "state": "stale",
      "reasons": ["content-changed"],
      "dependencies": ["src/**", "!src/**/*.test.ts", "package.json"],
      "changes": [{ "status": "modified", "path": "src/cli/run.ts", "via": ["src/**"] }],
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
```

- `mode` is `check`, `update`, `list-dependencies`, `list-dependents`, `stats` or `suggest`.
- `files` holds every selected Result (check) or every target (update), in path order,
  including `ok` ones. With `check --only-stale` the `ok` ones are omitted, and `summary`
  still counts every selected Result (§13.5).
- `changes` is the Result's `[[Changes]]` as a List of `{ "status", "path", "via" }` in this
  order, or `null` when it is *unknown* or not applicable (§12.3), including in update mode.
  `via` is `[[Via]]`, the List of patterns that selected the path. A fourth member,
  `"whitespaceOnly": true`, follows `via` in the entry of a Change whose `[[WhitespaceOnly]]` is
  true, and is absent otherwise. A last member, `"pair"`, is the Change's `[[Pair]]` when it is not
  none (§12.3 step 8), and is absent otherwise; both Changes of a pair stay in the List.
- `"dependenciesEdited": true` follows `changes` when the Result's `[[Edited]]` is not none, and
  is absent otherwise. The summary line of §14.3 is text only: its counts follow from `changes`.
- `"selection"` follows `dependenciesEdited` when the Result's `[[Selection]]` is not none, and is
  absent otherwise: a List of `{ "status", "path" }`, `status` being `added` or `removed`, in path
  order (§12.3 step 10).
- `"fragments"` follows `selection` (or `dependenciesEdited`, or `changes`, as far as they are
  present) when the Result's `[[Fragments]]` is not none, and is absent otherwise: a List of
  `{ "path", "select", "status" }` in order, `select` written as in `selected` below and `status`
  being `changed` or `new` (§12.3 step 11), then `"parts"` when `[[Parts]]` is not none: a List with
  one `{ }` for each Part, holding `"focus"` (a String) and `"lines"` (`{ "start", "end" }`) when
  the Part has them; without `"parts"` otherwise.
- An element of `files` whose Declaration uses a Preset (§8.6) has the members `use` and `origins`
  between `dependencies` and `changes`, as `list-dependencies` has them (below).
- A member `"selected"` follows `dependencies` (after `use` and `origins` when present) in an
  element of `files` of `check`, `update` and `list-dependencies` when the Declaration has Selected
  Dependencies (§8.7), and is absent otherwise: a List of `{ "path", "select" }` in order of
  appearance, `select` as the plain value with its Map keys in path order.
- With `update`, each element of `files` adds `"written": true|false` after
  `diagnostics` (true only when it was written, §13.6 step 10; false when it was unchanged or when
  step 5 of §13.6 refused), and the top level adds `"removed"`, a
  List of files, after `diagnostics`. An element with `"written": true` reports the state after
  the Write: `state` is `ok` and `reasons` is empty; `summary` counts those states. An unchanged
  element also reports `ok`; a refused element reports the state evaluated by §12.1.
- With `list-dependencies` the document is instead (§13.7):

  ```json
  {
    "version": 2,
    "mode": "list-dependencies",
    "exitCode": 0,
    "files": [
      {
        "file": "CLAUDE.md",
        "dependencies": ["src/**", "package.json", "!src/**/*.test.ts"],
        "use": ["tests"],
        "origins": [null, null, "tests"],
        "resolvedFiles": ["package.json", "src/cli/run.ts"],
        "diagnostics": []
      }
    ],
    "diagnostics": []
  }
  ```

  It has no `summary`, `state`, `reasons` or `changes`. In an entry, `file` is the Result's
  `[[File]]`, `dependencies` its effective patterns (§8.6), and `resolvedFiles` is its `[[Resolved]]`
  in path order, and `[]` for an `invalid` Result. Only an entry whose Declaration uses a Preset
  (§8.6) has the members `use` (its `[[Use]]`, `[]` when it is none) and `origins` (its
  `[[Origins]]`: one element per element of `dependencies`, `null` for none) between `dependencies`
  and `resolvedFiles`; any other entry is as it was before Presets. A file that gets the default
  Presets has `"use": []` and the names of the default Presets in `origins`: `origins` says where
  each pattern comes from, so no other member marks a default Preset. In every other mode `dependencies` is likewise the effective
  patterns; `check` and `update` output `use` and `origins` as above, and the other modes do not.
- With `list-dependents` the document is instead (§13.8):

  ```json
  {
    "version": 2,
    "mode": "list-dependents",
    "exitCode": 0,
    "files": [
      {
        "file": "src/cli/run.ts",
        "dependents": [{ "file": "CLAUDE.md", "via": ["src/**"] }],
        "diagnostics": []
      }
    ],
    "diagnostics": []
  }
  ```

  Each entry is { `[[File]]`, `[[Dependents]]` } of §13.8 step 4, `dependents`
  a List of { `"file"`, `"via"` } in path order, empty when nothing depends on `file`. With
  `--transitive` each element is instead { `"file"`, `"via"`, `"dependents"`, `"cycle"`,
  `"repeated"` }: `dependents` the List of the nodes below it in the same shape (`[]` for a
  node that is a cycle, is repeated, or has no dependents), and `cycle` and `repeated` its
  Booleans of §13.8. The `diagnostics` of an entry holds its `W_UNKNOWN_PATH` (§13.8 step 4.4),
  and is `[]` otherwise. The top-level
  `diagnostics` hold the attached `E_PATTERN` Diagnostics, or the raised Diagnostics, in which
  case `files` is empty.
- The `diagnostics` of a file holds its errors when it is `invalid`, and its warnings (§8.5, §8.7) in
  every state, so an `ok` or `stale` file may have a non-empty `diagnostics`.
- With `stats` the document is instead (§13.9):

  ```json
  {
    "version": 2,
    "mode": "stats",
    "exitCode": 0,
    "window": { "kind": "days", "value": "30d", "commits": 326, "untouched": 91 },
    "files": [
      {
        "file": "CLAUDE.md",
        "patterns": 8,
        "resolvedCount": 53,
        "staleCommits": 129,
        "days": 36,
        "staleRate": 0.3957,
        "sweepCommits": 4,
        "sweepShare": 0.031,
        "diagnostics": []
      }
    ],
    "diagnostics": []
  }
  ```

  When files are named (§13.9) each element of `files` also has `dependencies`, before `diagnostics`:
  the DependencyStats of §12.5 in their order, each { `dependency`, `commits`, `only` }; without a
  file argument the member is absent.

  It has no `summary`, `state`, `reasons` or `changes`. `window` is { `kind`: the Window's `[[Kind]]`;
  `value`: the value of `--since` (`30d` by default) or of `--from`, as given; `commits`: the number
  of its Commits; `untouched` } of §12.5, and `null` when a step raised. `files` is the FileStats of
  §12.5 in their order, with `resolvedCount` for `[[ResolvedCount]]`, `staleCommits` for
  `[[StaleCommits]]`, `staleRate` and `sweepShare`, and `[]` when a step raised. The `diagnostics` of a
  file are the warnings of its Result; the top-level `diagnostics` hold the raised Diagnostics.
  `staleRate` and `sweepShare` are JSON numbers: the ten-thousandths of §12.5 divided by 10000,
  written as ECMAScript writes a Number (`0.3957`, `0.5`, `1`, `0`).
- With `suggest` the document is instead (§13.10):

  ```json
  {
    "version": 2,
    "mode": "suggest",
    "exitCode": 0,
    "files": [
      {
        "file": "README.md",
        "suggestions": [
          { "pattern": "src/cli", "resolvedCount": 12, "staleRate": 0.1234, "status": null },
          {
            "pattern": "!src/cli/**/*.test.*",
            "resolvedCount": 3,
            "staleRate": null,
            "status": null
          }
        ],
        "ignored": ["dist/index.js"],
        "declared": null,
        "diagnostics": []
      }
    ],
    "diagnostics": []
  }
  ```

  It has no `summary`, `state`, `reasons` or `changes`. `files` holds each named file in path order,
  with `suggestions` the Suggestions of §12.6 in their order: `pattern`, `resolvedCount` the number
  of `[[Files]]`, and `staleRate` the Number of §13.10 step 6 (as `stats` writes `staleRate`, §14.5
  above) or `null`, then `status`, the *status* of §13.10 step 4 (`"declared"`, `"covered"` or
  `"new"`), or `null` when `declared` is `null`. `ignored` is the List of §12.6, `[]` when there is none. `declared` follows
  `ignored`: the List *declared* of §13.10 step 4, in its order, or `null` when it is *none*. With `--write` each
  element adds `"written": true|false` after `diagnostics`. The `diagnostics` of a file are always
  `[]`, kept for the shape of the other modes; the top-level `diagnostics` hold the raised
  Diagnostics, in which case `files` is empty.
- A Diagnostic is `{ "code", "severity", "file", "subject", "message" }`, with `null` for an
  empty `[[File]]` or `[[Subject]]`, and a last member `"pluginCode"` that is present only when the
  Diagnostic has a `[[PluginCode]]`. Diagnostic Lists are in Diagnostic order.
- When a step raises before Results exist, `summary` is omitted (as it always is for
  `list-dependencies` and `list-dependents`) and `files` is empty, so a run that evaluated
  nothing never reports zero counts.
- Consumers MUST ignore unknown members. Within version 2, later revisions only add members.

### 14.6 List-Dependencies, Text Mode

One block per selected Result, in path order:

```
<file>
  depends   <pattern>
  resolved  <dependency>
```

with one `depends` line per effective pattern (§8.6) in order, then one `resolved` line per
dependency in path order, each written as in §14.2. A `depends` line of a pattern that comes from a
Preset ends with a space and `(preset <name>)`, as in `  depends   !**/*.test.* (preset tests)`, with
the name written as in §14.2. After the `depends` lines of the patterns, one `depends` line per
Selected Dependency (§8.7), as in §14.3. An `invalid` Result prints its first line only. There is no
summary line. Diagnostics as in §14.3.

### 14.7 List-Dependents, Text Mode

One block per entry, in the order of §13.8:

```
<file>
  <dependent>   via <pattern>, <pattern>
```

with one row per dependent, in path order: two spaces, the dependent padded with spaces to the
width of the longest dependent of the block, three spaces, `via `, and the patterns joined with
`, `, each written as in §14.2. An entry with no dependents has the single row `  (no dependents)`,
also when it has a `W_UNKNOWN_PATH`. Diagnostics as in §14.3, those of the entries included.

With `--transitive` the rows form the tree of `DirectFirstTree` (§13.8), depth first: the
dependents of a dependent follow its row, as a group of rows indented by two more spaces per level,
each group padded to the width of its own longest dependent. The row of a cycle ends with a space
and `(cycle)`, the row of a repeated node with a space and `(listed below)` when its `[[Below]]` is
true, else `(listed above)`; none of these has rows below it. Every direct dependent of the
argument therefore has its full row and rows at the first level:

```
src/core/hash.ts
  docs/GUIDE.md   via src/core
    README.md   via docs/GUIDE.md
      docs/GUIDE.md   via README.md (cycle)
```

### 14.8 Stats, Text Mode

```
file       patterns  files  commits  days   stale   sweep
CLAUDE.md         8     53      129    36  0.3957  0.0310
README.md         1      4        9     6  0.0276  0.0000
window: 326 commits in the last 30 days, 91 make no file stale
legend: patterns declared, files they select, commits and distinct days that would make the file stale; stale = commits / window commits; sweep = share of those commits that touch over 200 paths
```

A header row, then one row per FileStats in the order of §12.5, when there is at least one. The
columns are `file`, `patterns`, `files` (`[[ResolvedCount]]`), `commits` (`[[StaleCommits]]`), `days`,
`stale` (`[[StaleRate]]`) and `sweep` (`[[SweepShare]]`), separated by two spaces. The `file` column
is the file as in §14.2, padded with spaces on the right; every other column is padded on the left;
each to the width of its longest cell, header included. `stale` and `sweep` are written with
exactly four decimals, from the ten-thousandths of §12.5 (`0.0276`, `1.0000`). A row has no
trailing space.

Then the line `window: <n> commits <where>, <k> make no file stale`, always written (also with no
row), where *n* is the number of Commits, *k* is *untouched*, and *where* is `in the last <N> days`
for `--since` and `in <rev>..HEAD` for `--from`, with *rev* as given and written as in §14.2. Then,
when there is at least one row, the *legend line*, the fixed text shown above, which explains the
columns; the sweep size it names is the one of §12.5. The legend is text only: `--json` has no
member for it (§14.5). When the command raised or a file was `invalid`, nothing is output on
standard output. Diagnostics as in §14.3.

When files are named (§13.9), then, for each row in its order, an empty line, the file as in §14.2
and a table of its DependencyStats in their order (§12.5):

```
NARROW.md
dependency  commits  only
src/a.ts          2     2
```

The header row has the columns `dependency` (`[[Dependency]]` as in §14.2), `commits` and `only`,
separated by two spaces, padded as the table above; a row has no trailing space.

### 14.9 Suggest, Text Mode

```
suggest docs/architecture.md
  pattern                           files   stale
  config/*.yaml                         2  0.1111
  src/server/handlers                   4  0.2222
  !src/server/handlers/**/*.test.*     -1
  src/store/index.ts                    1  0.0000
  ignored  dist/server.js
written  docs/architecture.md
```

One block per file, in path order. The first line is `suggest ` and the file as in §14.2. Then, when
the file has at least one Suggestion, a header row and one row per Suggestion in order, with the
columns `pattern`, `files` and `stale`, separated by two spaces and indented by two spaces. The
`pattern` column is the pattern as in §14.2, padded with spaces on the right; the others are padded
on the left, each to the width of its longest cell, header included. `files` is the number of
`[[Files]]`, written with a leading `-` for a Suggestion whose pattern has a Negation. `stale` is
the `staleRate` with exactly four decimals as in §14.8, `n/a` when it is *none* for a pattern with no Negation,
and empty for one with a Negation. A row has no trailing space. A file with no Suggestion has the
single line `  no paths found`. Then one line `  ignored  <path>` per *ignored* path, as in §14.2,
in path order.

When *declared* (§13.10 step 4) is not *none*, the table has a fourth column, `status`, padded on
the right like `pattern` (a row has still no trailing space): the *status* of the Suggestion
(§13.10 step 4), `declared`, `covered` or `new`. Then, after the `ignored` lines, one line
`  only declared  <pattern>` per distinct pattern of *declared* that no Suggestion has, in the
order of *declared*, written as in §14.2:

```
suggest docs/architecture.md
  pattern               files   stale  status
  src/server/handlers       4  0.2222  declared
  src/server/router.ts      1  0.2222  new
  only declared  src/legacy
```

When *declared* is *none*, the block is exactly as above, without the column and those lines.
With `--write`, after all blocks, one line `written  <file>` or `unchanged  <file>`
per file in path order. Diagnostics as in §14.3, and nothing is output on standard output when the
command raised.
