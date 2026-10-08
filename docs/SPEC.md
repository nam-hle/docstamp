# docstamp Specification

Version 1 (draft; Configuration version 2, Lockfile version 3, JSON output version 2). This
document defines the observable behavior of docstamp. It does not define implementation structure. Code and tests cite its clause numbers (for example `§8.3`).

## 1 Scope

docstamp tracks hidden dependencies between files: a file whose correctness
rests on the content of other files (its *dependencies*). The primary case is documentation that
describes code, but any file may have dependencies and any file in the Universe may be one: a
fixture and the schema it mirrors, generated types and their source, a translation and its
original.

The workflow it serves:

1. CI runs `docstamp`. It exits 1 when a file's dependencies changed since its last Review.
2. A person or an agent reviews each stale file against its dependencies and edits it if
   needed.
3. They run `docstamp update <file>` to record the Review in the Lockfile. CI passes.

A file declares its dependencies in the Configuration file, or inline, in a `docstamp` block in
the frontmatter of a Markdown file (§5.6, §9.6). Both kinds of file are evaluated alike.

This specification defines how a Root is determined (§6), the Universe (§7), patterns (§8), the
Configuration file (§9), hashing (§10), the Lockfile (§11), evaluation (§12), the command line
(§13), output (§14), diagnostics (§15), exit codes (§16) and compatibility (§17).

## 2 Conformance

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in
RFC 2119.

For the same Root contents and the same command line, a conforming implementation MUST produce
the same exit code, byte-identical Lockfile contents, and byte-identical standard output, on any
host operating system, locale, time zone, wall-clock time and version-control history. The only
permitted variations are:

- the text of a Diagnostic's `[[Message]]` (§5.5), which is informative;
- the output of `--version` and `--help`;
- color escape sequences (§14.1);
- the choice of Root by the upward search of §6, which `--root` removes;
- Unicode normalization (§7.4) and case mapping (§7.5) of code points that are unassigned in the
  Unicode version of the implementation's runtime;
- the changed-file report (`[[Changes]]`, §5.4), which depends on the repository history available
  on the host, for example a shallow clone against a full clone;
- the output of `stats` (§13.9), which depends on the repository history and, for `--since`, on the
  wall-clock time;
- the `staleRate` of `suggest` (§13.10), which depends on the repository history and the wall-clock
  time, and is *none* when the history cannot answer.

A conforming implementation MUST NOT perform network access. It MAY invoke `git`, read-only, only
to compute the changed-file report (§12.3) and the replay of `stats` and `suggest` (§12.4). The
verdict (states and reasons), the Lockfile and the exit code of every command MUST NOT depend on
`git`, except that `stats` fails with exit 2 when the history it needs is missing (§12.4); `suggest`
never fails for want of history. `stats` and `suggest` are the only places that read the wall-clock
time: `stats` only for `--since`, `suggest` for its fixed window of 30 days.

## 3 Notational Conventions

### 3.1 Algorithms

Behavior is specified as algorithms of numbered steps, performed in order. An *abstract
operation*, written `Name(arg1, arg2)`, either returns a value or *raises* a non-empty List of
Diagnostics (§5.5).

`? Name(...)` means: if the call raises, the calling algorithm raises the same List and performs
no further steps.

An algorithm that *collects* a Diagnostic appends it to a List local to that algorithm, named in
the algorithm, and continues.

### 3.2 Data

A *List* is an ordered sequence, written « a, b ». A *Map* has unique keys and is enumerated in
path order (§3.3) of its keys. A *Record* has named fields, written `[[Field]]`.

A *String* is a sequence of Unicode code points. String *equality* is code point by code point,
with no normalization, case folding or trimming unless a step says so.

### 3.3 Path Order

*Path order* is ascending lexicographic order of Strings by UTF-16 code unit. It is the only
ordering in this specification. Locale-aware collation MUST NOT be used.

NOTE: For code points above U+FFFF this differs from UTF-8 byte order. It is still identical on
every host.

### 3.4 String Quoting

`Quote(s)` is the String `"`, then each code point *c* of *s* replaced as follows, then `"`:

| *c* | Replacement |
|---|---|
| `"` | `\"` |
| `\` | `\\` |
| U+0008, U+0009, U+000A, U+000C, U+000D | `\b`, `\t`, `\n`, `\f`, `\r` |
| any other code point in U+0000 to U+001F, U+007F to U+009F, U+2028, U+2029, U+FEFF | `\u` and 4 lowercase hex digits |
| anything else | *c* |

NOTE: `Quote` produces both a valid JSON string and a valid YAML 1.2 double-quoted scalar that
parse back to *s*. It is the only escaping used in output and in the Lockfile.

## 4 Terms

**Root**: the directory against which every RepoPath is resolved (§6).

**RepoPath**: a String naming an entry relative to Root. It uses `/` as separator, has no leading
or trailing `/`, no empty segment, no segment `.` or `..`, no U+0000, and is in Unicode
Normalization Form C (NFC).

**Declaration**: what gives a file its dependencies, as a List of patterns: an entry of `files` in
the Configuration file (a *configured* Declaration), or the `docstamp` block in the frontmatter of
the file itself (an *inline* Declaration, §5.6).

**File** (stamped file): a file that has a Declaration, and so rests on other files, its
dependencies. The Configuration file, the Lockfile and the JSON output name it `file`, and the
Configuration file's key for all of them `files`.

**Inline file**: a file with an inline Declaration. **Inline block**: its `docstamp` block (§5.6).

**Include**: the List of patterns (§9.3) that selects the files of the Universe searched for inline
blocks. Its default is « `**/*.md` ».

**Preset**: a named non-empty List of patterns that the Configuration file defines under
`presets` (§9.3) and a Declaration names under `use` (§8.6), so that a list shared by many files is
written once. A file's *effective patterns* are its own patterns followed by those of its presets
(§8.6).

**Dependency**: a file selected by a file's Declaration (§8.5).

**Dependent** (of *X*): a file that has *X* among its dependencies. `docstamp list-dependents <X>`
lists the dependents of *X*. The term is only used in this reverse direction.

**Review**: the act, outside docstamp, of checking a file against its dependencies.

**Write**: recording a file's current Dependency Hash in the Lockfile with `docstamp update`,
asserting that a Review happened.

**Window**: the commits of the repository history that `stats` replays (§12.4). A commit makes a
file *stale* in the window when it touched at least one of the file's dependencies (§12.5).

**Configuration file**: the one file at Root, among the names of §9.1, that holds the Config.
Written by people.

**Carrier**: the format a Configuration file is written in (§9.1). Every Carrier produces the same
*normalized value* (§9.2, §9.5), and only that value is validated (§9.3).

**Lockfile**: the file `docstamp-lock.yaml` at Root. Written only by `docstamp update`. It holds
the Dependency Hash of configured Declarations only (§5.3).

## 5 Records

### 5.1 Declaration

| Field | Type | Meaning |
|---|---|---|
| `[[File]]` | RepoPath | |
| `[[Dependencies]]` | List of String | the patterns, verbatim, in declaration order |
| `[[Use]]` | List of String | the names of the Presets it uses (§8.6), in order; « » when it has no `use` |
| `[[Origin]]` | `config` or `inline` | where it is declared |
| `[[Recorded]]` | Hash, or none | inline only: the Hash recorded in the block (§5.6), none if it has no `hash` key |

### 5.2 Config

| Field | Type | Default |
|---|---|---|
| `[[Ignore]]` | List of String (ignore rule lines, §7.3) | « » |
| `[[UseGitignore]]` | Boolean | true |
| `[[Include]]` | non-empty List of String (patterns, §8.1) | « `**/*.md` » |
| `[[Presets]]` | Map from preset name (§9.3) to non-empty List of String (patterns, §8.1) | an empty Map |
| `[[Declarations]]` | List of configured Declaration, in path order of `[[File]]` | (required) |

NOTE: A Config is built from the normalized value of the Configuration file (§9.3), whatever its
Carrier. When there is no Configuration file, every field has the default of this table, and
`[[Declarations]]` is « » (§9.3 step 2).

### 5.3 Lock

| Field | Type |
|---|---|
| `[[Entries]]` | Map from RepoPath (a file) to LockEntry |

A *LockEntry* is a Hash: the file's Dependency Hash (§10.4) at the last Write.

NOTE: The Lockfile has an entry for a configured Declaration only. An inline Declaration records
its Hash in its own file (§5.6), and the Lockfile is not created for a Root with no configured
Declaration (§13.6).

NOTE: The Lockfile does not record the patterns. The Dependency Hash includes every dependency
path, so a pattern change that changes the set of dependencies changes the Dependency Hash and the
file is `stale` with `content-changed`. A pattern change that leaves the set of dependencies
identical needs no Review (Principle 4).

### 5.4 Result

| Field | Type | Meaning |
|---|---|---|
| `[[File]]` | RepoPath | |
| `[[Dependencies]]` | List of String | the Declaration's effective patterns (§8.6): its `[[Dependencies]]` when it has no `[[Use]]` |
| `[[Use]]` | List of String | the Declaration's `[[Use]]` |
| `[[Origins]]` | List of String or none | one element per element of `[[Dependencies]]`: the name of the Preset the pattern comes from, or none for the Declaration's own pattern |
| `[[State]]` | `ok`, `stale` or `invalid` | §12.1 |
| `[[Reasons]]` | List of Reason | non-empty iff `[[State]]` is `stale` |
| `[[Resolved]]` | List of RepoPath, path order | empty iff `[[State]]` is `invalid` |
| `[[Current]]` | Hash or empty | empty iff `[[State]]` is `invalid` |
| `[[Diagnostics]]` | List of Diagnostic, §5.5 order | holds an error iff `[[State]]` is `invalid`; any Result may also hold warnings (§8.5) |
| `[[Changes]]` | List of Change in path order, or *unknown* | known only as defined in §12.3 |
| `[[Base]]` | a commit Id, or none | the commit *C* of §12.3 when `[[Changes]]` is known, else none |
| `[[Edited]]` | RepoPath, or none | the *carrier* of §12.3 step 1.4 when `[[Changes]]` is known and that step found the Declaration's own list edited since *C*, else none |

A *Reason* is `unrecorded` or `content-changed`; exactly one applies to a `stale` Result.

NOTE: An edit of the Declaration's own list is not a Reason. The Lockfile and the `hash` of a block
record a Hash and no pattern, so only the history can tell such an edit apart from a change of a
dependency, and the Reasons must not depend on `git` (§2). `[[Edited]]` is part of the changed-file
report instead.

A *Change* is { `[[Status]]`: `modified`, `added` or `deleted`, `[[Path]]`: RepoPath, `[[Via]]`: a
non-empty List of String, `[[WhitespaceOnly]]`: Boolean, `[[Pair]]`: RepoPath or none }.
`[[Pair]]` links a `deleted` and an `added` Change with the same content (§12.3 step 8).

NOTE: The Lockfile keeps one Hash per file, so a Declaration over thousands of files costs one
entry and the verdict cannot say which dependencies changed. `[[Changes]]` is a best-effort report
computed from the repository history (§12.3); it is *unknown* whenever that history cannot answer.

### 5.5 Diagnostic

| Field | Type | Meaning |
|---|---|---|
| `[[Code]]` | String | a code of §15 |
| `[[Severity]]` | `error` or `warning` | fixed per code (§15) |
| `[[File]]` | RepoPath or empty | the file it concerns |
| `[[Subject]]` | String or empty | the pattern, path, key or argument it concerns |
| `[[Message]]` | String | informative; see below |

A Diagnostic with a non-empty `[[File]]` is *attached* to that file; any other is
*global*.

*Diagnostic order*: by `[[File]]` in path order (empty first), then `[[Code]]` in path order,
then `[[Subject]]` in path order. Every List of Diagnostics that is output is in this order, with
duplicates (all fields equal) removed.

`[[Message]]` is one sentence naming the problem and its fix. It MUST NOT contain operating system
error text, parser error text, or absolute paths; it MAY contain an error code name such as
`EACCES`. The one exception is a file argument that does not resolve inside Root: the `E_USAGE` of
§13.8 step 3 and §13.10 step 2, and the `E_UNKNOWN_FILE` of §13.3 step 2, name the current
directory, the resolved path and Root, because that is what explains the failure.

### 5.6 Inline Block

An *inline block* is a mapping under the key `docstamp` in the frontmatter of a file:

```md
---
title: README
docstamp:
  dependencies: [src/cli, docs/SPEC.md]
  hash: 0f3a...64 lowercase hexadecimal digits...
---
```

`dependencies` is required: a non-empty List of patterns of the dialect of §8.1. `use` is optional:
a non-empty List of Preset names (§8.6). `hash` is optional:
a Hash (§10.3): the Dependency Hash (§10.4) recorded at the last Write of the file, the same value
the Lockfile records. It has no version of its own (§17.5).

The following definitions are lexical: they do not depend on the text being valid YAML, so that
the Hash of a file (§10.2) never depends on whether its block parses.

The *lines* of a text are its parts after each LF, each with its terminator (LF or CR LF; the
last line may have none). A line is *blank* if it has only U+0020 and U+0009. The *indent* of a
line is its leading run of U+0020 and U+0009.

`ScanFrontmatter(text)` returns a Scan or *none*:

1. Let *lines* be the lines of *text*, with a leading U+FEFF removed from the first.
2. If the first line, without its terminator and trailing blanks, is not `---`, return *none*.
3. Let *close* be the index of the first later line that, without its terminator and trailing
   blanks, is `---`. If there is none, return *none*.
4. Let *marker* be the index of the first line between them that starts with `docstamp:` followed
   by U+0020, U+0009, a line terminator or the end of the text. If there is none, return *none*.
5. Let *end* be the index of the first line after *marker* and before *close* that is neither
   blank nor indented, else *close*. Let *last* be the index of the last line from *marker* up to
   *end* that is not blank.
6. Let *keyIndent* be the indent of the first line after *marker* and before *end* that is neither
   blank nor starts with `#` after its indent; *keyIndent* is *absent* if there is none.
7. Let *hashLines* be the lines after *marker* and before *end* whose indent is *keyIndent* and
   which start with `hash:` after their indent.
8. Return the Scan { *lines*, *close*, *marker*, *last*, *keyIndent*, *hashLines* }.

NOTE: Only a `docstamp:` in column 0 marks a block: a quoted key (`"docstamp":`), an indented
`docstamp:` and a key such as `docstamp-x:` do not. A frontmatter that has no such line is never
parsed (§9.6.2), so unrelated frontmatter cannot make a run fail.

NOTE: The package ships `schema-frontmatter.json`, a JSON Schema (draft-07) for the frontmatter of a
file with an inline block, so that tools that validate frontmatter can catch a mistyped key: the
`docstamp` key is an object with `dependencies` (required, a non-empty array of strings, none of
them empty or a lone `!`, two invalid Patterns of §8.1), `use` (a
non-empty array of distinct Preset names) and `hash` (64 lowercase hexadecimal digits), and no other
key; other frontmatter keys are free. It is generated from the same keys as §9.6.2 and is
informative: docstamp does not read it, and §9.6.2 decides.

## 6 Root

`DetermineRoot(cwd, rootOption)`:

1. If *rootOption* is present:
   1. Let *dir* be *rootOption* resolved lexically against *cwd* (§13.4).
   2. If *dir* is not an existing directory, raise `E_ROOT`.
   3. Return *dir*.
2. Let *dir* be *cwd*.
3. Repeat:
   1. If *dir* contains an entry named by any of the Configuration file names of §9.1, return
      *dir*.
   2. If *dir* is the filesystem root, stop this loop.
   3. Set *dir* to the parent of *dir*.
4. Let *dir* be *cwd*.
5. Repeat:
   1. If *dir* contains an entry named `.git`, of any kind, return *dir*.
   2. If *dir* is the filesystem root, raise `E_CONFIG_MISSING`.
   3. Set *dir* to the parent of *dir*.

NOTE: A Configuration file in any ancestor wins over a nearer `.git`. The entry `.git` may be a
file, as in a linked work tree or a submodule. A Root found by step 5 has no Configuration file, so
the defaults of §5.2 apply (§9.3 step 2).

## 7 Universe

The *Universe* is the List, in path order, of RepoPaths of the files that may be dependencies.

### 7.1 Entries

An *entry* is something a directory listing returns. Its kind is one of: *directory*, *file*
(regular file), *link* (symbolic link, of any target), or *other* (socket, FIFO, device).

Symbolic links are never followed: a link is an entry of kind *link*, whatever its target.

### 7.2 Walk

`ComputeUniverse(root, config)`:

1. Let *errors* be an empty List. Let *rules* be an empty List of ignore rules.
2. Call `WalkDirectory(root, "")`, defined as follows for a directory *d* with RepoPath prefix
   *p*:
   1. If `config.[[UseGitignore]]` is true and *d* contains an entry `.gitignore` of kind *file*,
      append its rules (§7.3) to *rules*, scoped to *p*. If it cannot be read, collect
      `E_UNREADABLE` with `[[Subject]]` its RepoPath.
   2. If *d* cannot be listed, collect `E_UNREADABLE` with `[[Subject]]` *p* and return.
   3. For each entry *e* of *d*, with name *n* and RepoPath *q* (*p* joined with *n*):
      1. If *n* is not valid UTF-8, collect `E_PATH_ENCODING` with `[[Subject]]` the parent RepoPath
         and continue.
      2. If *n* is `.git`, of any kind, skip *e*.
      3. If *e* is *other*, skip *e*.
      4. If `IsIgnored(q, kind of e, rules, config)` (§7.3), skip *e*; *q* is then an *ignored entry*.
      5. If *e* is a *directory*: if it contains an entry named `.git`, skip *e* (a nested
         repository); otherwise call `WalkDirectory(e, q)`.
      6. If *e* is a *file* or *link*, add *q* to the Universe.
   4. Remove the rules scoped to *p* from *rules* before returning.
3. Remove from the Universe the entries of Root named by a Configuration file name of §9.1, and
   the entry `docstamp-lock.yaml` of Root.
4. Apply §7.4 and §7.5, collecting their Diagnostics.
5. If *errors* is not empty, raise it. Otherwise return the Universe in path order.

NOTE: Step 3 means a Write can never make any file stale. It removes only those entries of Root
itself. A file of the same name below Root, such as `sub/docstamp.yaml` or
`sub/docstamp-lock.yaml`, is an ordinary file: it is in the Universe, may be a dependency, and
is hashed like any other.

NOTE: Files tracked by git but matched by an ignore rule are not in the Universe. `core.excludesFile`
and `.git/info/exclude` are never read; they are per-machine and would break §2. A file git ignores
only through them is in the Universe.

### 7.3 Ignore Rules

An ignore rule file is read as UTF-8; a leading U+FEFF is removed; each line has a trailing U+000D
removed. Each line then becomes at most one rule:

1. A line that is empty or starts with `#` is no rule. `\#` at the start means a literal `#`.
2. Trailing U+0020 characters are removed unless escaped with `\`.
3. A leading `!` makes the rule *negated*; `\!` at the start means a literal `!`.
4. A trailing `/` makes the rule match directories only; it is then removed.
5. If the remaining text contains `/`, the rule is *anchored* to its scope; a leading `/` is then
   removed. Otherwise it matches an entry of that name at any depth below its scope.
6. The remaining text is a Glob (§8.1) without Alternation.

`IsIgnored(q, kind, rules, config)`:

1. Let *result* be false.
2. For each rule *r* of *rules*, in the order added, then each line of `config.[[Ignore]]` as a
   rule scoped to Root: if *r* matches *q* and (*r* is not directory-only or *kind* is
   *directory*), set *result* to true if *r* is not negated, else false.
3. Return *result*.

A rule scoped to *p* matches *q* if *q* is below *p* and either the rule is anchored and its Glob
matches *q* relative to *p*, or it is not anchored and its Glob matches the last segment of *q*.

NOTE: Because the walk does not enter an ignored directory, a negated rule cannot re-include a
file inside it. This is gitignore behavior.

### 7.4 Normalization

Each RepoPath produced by the walk is converted to NFC. The implementation keeps the on-disk name
for reading. If two entries of the Universe have the same RepoPath after conversion, collect
`E_PATH_COLLISION` with `[[Subject]]` that RepoPath.

### 7.5 Case Collisions

If two RepoPaths of the Universe are equal after applying the Unicode default lowercase mapping
(as ECMAScript `String.prototype.toLowerCase`) to both, collect `E_PATH_COLLISION` with
`[[Subject]]` the first of them in path order.

NOTE: Such files cannot coexist on case-insensitive file systems, so a Lockfile written on one
host would disagree with another. The collision is an error on every host.

## 8 Patterns

### 8.1 Syntax

```
Pattern     ::= Negation? Glob
Negation    ::= "!"
Glob        ::= Segment ( "/" Segment )*
Segment     ::= "**" | Part+
Part        ::= Literal | "*" | "?" | Class | Alternation
Alternation ::= "{" Alt ( "," Alt )+ "}"
Alt         ::= AltPart+
AltPart     ::= Literal | "*" | "?" | Class
Class       ::= "[" "!"? ClassItem+ "]"
ClassItem   ::= ClassChar | ClassChar "-" ClassChar
Literal     ::= any code point except * ? [ ] { } , / \  |  Escape
ClassChar   ::= any code point except ] / \  |  Escape
Escape      ::= "\" any code point except /
```

Additional rules:

- A leading `!` is always Negation. A literal leading `!` is written `\!`.
- `**` is a Segment only when it is the whole segment. Two consecutive `*` inside a longer segment
  make the Pattern invalid.
- In a Class, `-` is literal when it is the first or last ClassItem. A range whose first code
  point is greater than its second is invalid. `[!]` is invalid.
- A Pattern is *invalid* if it does not match the grammar, is empty after the Negation, starts
  with `/` after the Negation, ends with `/`, has a segment that is exactly `.` or `..`, or is not
  in NFC.

NOTE: `\` is the escape character, so a Windows path such as `src\cli` is the literal `srccli`.
Patterns always use `/`.

### 8.2 Glob Matching

`GlobMatches(glob, path)` is true iff *path* is in the language of *glob*:

- a Literal matches itself; an Escape `\c` matches *c*;
- `*` matches zero or more code points, none `/`;
- `?` matches one code point other than `/`;
- a Class matches one code point other than `/` that is (or, with `!`, is not) a listed code point
  or within a listed inclusive range;
- an Alternation matches what any one of its Alts matches;
- a Segment `**` that is the last segment matches one or more whole segments; any other Segment
  `**` matches zero or more whole segments;
- matching is case-sensitive and anchored at both ends; a leading `.` has no special meaning.

NOTE: `src/**` selects everything under `src/` but not a file named `src`.

### 8.3 Pattern Matching

`PatternMatches(pattern, path)`:

1. Let *glob* be *pattern* without its Negation.
2. If `GlobMatches(glob, path)`, return true.
3. If some proper prefix of *path* that ends immediately before a `/` satisfies
   `GlobMatches(glob, prefix)`, return true.
4. Return false.

NOTE: Step 3 gives directory semantics: `src/cli` selects every file under `src/cli/`, and so does
`src/*`, which matches the directory `src/cli`.

### 8.4 Selection

`Select(patterns, candidates)`:

1. Let *result* be an empty List.
2. For each *path* of *candidates*, in path order:
   1. Let *selected* be false.
   2. For each *pattern* of *patterns*, in order: if `PatternMatches(pattern, path)`, set
      *selected* to true if *pattern* has no Negation, else to false.
   3. If *selected*, append *path* to *result*.
3. Return *result*.

NOTE: The last matching pattern wins. Unlike an ignore rule (§7.3), a later pattern can re-select
a file under a directory an earlier negation removed.

### 8.5 Resolution

`ResolveDependencies(declaration, universe)`:

1. Let *problems* and *warnings* be empty Lists.
2. Let *candidates* be *universe* without `declaration.[[File]]`.
3. For each *pattern* of the effective patterns of *declaration* (§8.6; `declaration.[[Dependencies]]`
   when it has no `[[Use]]`): if no *path* of *candidates* satisfies `PatternMatches(pattern, path)`,
   then, with `[[Subject]]` *pattern*: if *pattern* has no Negation, collect `E_EMPTY_PATTERN` into
   *problems*; otherwise, unless *pattern* comes from a Preset, collect `W_EMPTY_EXCLUSION` into
   *warnings*.
4. For each distinct String that appears more than once in `declaration.[[Dependencies]]` (String
   equality, §3.2), collect `W_DUPLICATE_PATTERN` into *warnings*, `[[Subject]]` that String. A
   pattern that comes from a Preset is not counted: only the file's own patterns are.
5. Let *resolved* be `Select` of the effective patterns of *declaration* and *candidates*.
6. If *resolved* is empty, collect `E_EMPTY_DEPENDENCIES` into *problems*.
7. If *problems* is not empty, raise *problems* followed by *warnings*. Otherwise return *resolved*
   and *warnings*.

NOTE: A file is never one of its own dependencies (step 2), so editing a file never
makes it stale. A pattern without Negation must match something (Principle 6): a dependency that
matches nothing is a mistyped or stale rule, and a declaration whose patterns together select
nothing is a mistake (step 6).

NOTE: A *duplicate* is the same String twice, whatever its Negation, and is warned once however
many times it repeats. Patterns that differ in any code point, such as `src` and `src/**`, are not
duplicates even when they select the same files. The warning changes neither `Select` (§8.4), the
resolved files, the Dependency Hash nor the state of the file. Removing a repeat is not always
neutral, because the last matching pattern wins: in `src`, `!src/gen`, `src` the second `src`
selects `src/gen` again, and deleting it changes the selection.

NOTE: An exclusion *matches nothing* when no file of *candidates* satisfies `PatternMatches` for the
exclusion itself (step 3). The test looks at the exclusion alone: it does not depend on the
patterns before it, so an exclusion that matches a file nothing selected is not warned about, and
one that matches only files outside the Universe (ignored, §7.3) is. It never changes `Select`
(§8.4), the last matching pattern still wins, the resolved files, the Dependency Hash or the state
of the file. A warning lets a standard exclusion block be declared before the files it excludes
exist, and survive their deletion.

NOTE: The `[[Message]]` of `E_EMPTY_PATTERN` is informative (§5.5), and SHOULD say when the pattern
is a *literal path* that exists under Root but is not in the Universe because it is ignored, so
that nobody hunts for a typo. A literal path is a Pattern whose every Segment is made of Literals
only (no `*`, `?`, Class, Alternation or `**`); it denotes the String of those Literals, Escapes
resolved. It is *ignored* when it exists as an entry under Root (a file, link or directory, not
followed) and either it or a directory above it is an ignored entry (§7.2 step 3.4), or an ignored
entry is below it (a directory whose content is all ignored). This changes neither the selection,
nor the Diagnostic code, nor the Diagnostic order, nor any verdict. `git` is not consulted, so a
renamed file is not traced.

NOTE: For the same reason, the `[[Message]]` of `E_EMPTY_PATTERN` SHOULD say that patterns use `/`
as the separator and that `\` escapes the next character when the pattern holds a `\` followed by a
letter: `src\core` is the literal `srccore` (§8.1 NOTE), almost always a Windows path. When that
pattern is the Declaration's only inclusion, `E_EMPTY_DEPENDENCIES` (step 6) is raised too: the two
codes report two facts, the pattern that matches nothing and the Declaration that selects nothing,
and a consumer may read either, so neither is dropped (§17.1); the hint is in the message of the
first.

NOTE: A pattern that comes from a Preset (§8.6) is reported like any other when it is not an
exclusion: `E_EMPTY_PATTERN`, with the Preset named in the `[[Message]]`. An exclusion that comes
from a Preset never gives `W_EMPTY_EXCLUSION`: a Preset is a standard block shared by many files,
declared for the files that need it, and a file that has nothing to exclude could not remove the
warning without editing every other file that uses the Preset.

### 8.6 Presets

A Preset is defined in the Configuration file (§9.3). A Declaration, configured or inline, names the
Presets it uses in its `use` key; the patterns of a Preset are not a new syntax: they are patterns of
§8.1, and nothing in a pattern refers to a Preset, so no existing pattern changes meaning and a
Preset cannot refer to another one.

`ExpandPresets(declaration, presets, present)`, where *presets* is `config.[[Presets]]` and
*present* tells whether a Configuration file exists (§9.3), returns the effective patterns and their
origins of *declaration*, or raises:

1. Let *problems* be an empty List, *patterns* a copy of `declaration.[[Dependencies]]`, and *origins*
   a List of as many none elements.
2. For each name *n* of `declaration.[[Use]]`, in order: if *presets* has no key *n*, collect
   `E_UNKNOWN_PRESET` into *problems*, `[[Subject]]` *n*; otherwise append the patterns of the Preset
   *n*, in order, to *patterns*, and as many elements *n* to *origins*.
3. If *problems* is not empty, raise it. Otherwise return *patterns* and *origins*.

The message of `E_UNKNOWN_PRESET` is informative (§5.5); when *present* is false it SHOULD say that
Presets are defined in a Configuration file and that a Root without one has none.

NOTE: The effective patterns are the file's own patterns first, then each Preset in `use` order, so
an exclusion of a Preset applies after the file's own inclusions (§8.4: the last matching pattern
wins), and a later Preset can re-select what an earlier one excluded. The result is an ordinary
pattern list: `Select`, the Dependency Hash and the Lockfile are unaware of Presets. Editing a Preset
changes the dependencies of every file that uses it, and so is a `content-changed` exactly for the
files whose set of dependencies it changes (§12.1 NOTE). A Declaration whose `use` raises is
`invalid`, and its Result keeps its own patterns, unexpanded (§12.1 step 6).

NOTE: A file with an inline block that uses a Preset needs a Configuration file that defines it:
Presets are not definable in a block, so that a list shared by many files has one definition.

## 9 Configuration File

### 9.1 Carriers

The Configuration file is a file at Root named, in this order of discovery, one of:

| Name | Carrier |
|---|---|
| `docstamp.yaml` | YAML (§9.2) |
| `docstamp.config.ts`, `docstamp.config.mts` | script (§9.5), TypeScript |
| `docstamp.config.js`, `docstamp.config.mjs` | script (§9.5), JavaScript |

Exactly one of these names MAY be an entry of Root (§9.3). A Root with none of them uses the
defaults of §5.2 and declares its files inline only (§9.6). The Carrier is only a format: every
Carrier yields the same normalized value, and the rules of §9.3 apply to that value alone. The
Lockfile is always YAML.

The same configuration in the YAML Carrier:

```yaml
version: 2
files:
  CLAUDE.md:
    dependencies:
      - src/**
      - "!src/**/*.test.ts"
      - package.json
  tests/fixtures/user.json:
    dependencies:
      - schemas/user.schema.json
```

Patterns starting with `!` or `*` must be quoted in YAML.

In the script Carrier (§9.5) the file exports the same value:

```ts
import { defineConfig } from 'docstamp';

export default defineConfig({
  version: 2,
  files: {
    'CLAUDE.md': { dependencies: ['src/**', '!src/**/*.test.ts', 'package.json'] },
    'tests/fixtures/user.json': { dependencies: ['schemas/user.schema.json'] },
  },
});
```

### 9.2 YAML Profile

The YAML Carrier of the Configuration file and the Lockfile are read as YAML 1.2 with the Core
schema, restricted as follows. A violation raises `E_CONFIG` (Configuration file) or `E_LOCK`
(Lockfile). The profile applies to those two files only, never to a script Carrier.

- The file is UTF-8; a leading U+FEFF is ignored. It holds exactly one document.
- Anchors, aliases, tags, merge keys (`<<`) and complex keys are not allowed.
- Every mapping key is a plain or quoted scalar that resolves to a string. A plain scalar key
  such as `1`, `true` or `null` is an error, not a string.
- A mapping MUST NOT contain the same key twice.

The *normalized value* of a YAML document is the Value it denotes: a mapping is a Map, a sequence
is a List, and a scalar is the Null, Boolean, Number or String it resolves to. The one exception
is the value of the top-level key `version`: it is the Number 2 if it is the plain scalar `2`
exactly, and Null for any other scalar, so that `2.0`, `0x2`, `+2`, `02` and `"2"` are not
version 2.

### 9.3 Reading

`ReadConfig(root)` returns a Config, a List of attached Diagnostics and a Boolean *present*, or
raises:

1. Let *fatal* be an empty List. Let *attached* be an empty List.
2. Let *names* be the names of §9.1 that are entries of Root, of any kind, in the order of §9.1.
   1. If *names* has more than one element, raise « `E_CONFIG_AMBIGUOUS` », `[[Subject]]` the
      elements of *names* joined with `, `.
   2. If *names* is empty, return the Config of the defaults of §5.2, « » and *present* false.
   3. If its element is not an entry of kind *file*, raise « `E_CONFIG_MISSING` ».
3. Let *value* be the normalized value of that file: under §9.2 for `docstamp.yaml`, under §9.5
   for any other name. On failure, or if *value* is not a Map, raise « `E_CONFIG` ».
4. If the key `version` is absent, or its value is not the Number 2, raise « `E_CONFIG_VERSION` »,
   whose message names the migration from version 1.
5. For each key of *value* other than `version`, `gitignore`, `ignore`, `include`, `presets` and
   `files`, collect `E_UNKNOWN_KEY` into *fatal*, `[[Subject]]` the key.
6. If `gitignore` is present and not a Boolean, or `ignore` is present and not a List of
   Strings, collect `E_CONFIG` into *fatal*, `[[Subject]]` the key. If `include` is present and
   not a non-empty List of Strings, collect `E_CONFIG` into *fatal*, `[[Subject]]` `include`;
   otherwise, for each string *s* of `include` that is not a valid Pattern (§8.1), collect
   `E_PATTERN` into *fatal*, `[[Subject]]` *s*. If `presets` is present and not a Map, collect
   `E_CONFIG` into *fatal*, `[[Subject]]` `presets`; otherwise, for each (*name*, *list*) of it: if
   *name* is not of the form `[a-z][a-z0-9-]*`, or *list* is not a non-empty List of Strings,
   collect `E_CONFIG` into *fatal*, `[[Subject]]` `presets.` followed by *name*; otherwise, for each
   string *s* of *list* that is not a valid Pattern (§8.1), collect `E_PATTERN` into *fatal*,
   `[[Subject]]` *s*.
7. If `files` is absent, or not a Map, collect `E_CONFIG` into *fatal*, `[[Subject]]`
   `files`.
8. Otherwise, for each (*key*, *value*) of `files`:
   1. If *key* is not a RepoPath, collect `E_CONFIG` into *fatal*, `[[Subject]]` *key*, and
      continue.
   2. If *value* is not a Map, or has no key `dependencies`, or `dependencies` is not a non-empty
      List of Strings, collect `E_CONFIG` into *fatal*, `[[File]]` *key*, and continue.
   3. For each key of *value* other than `dependencies` and `use`, collect `E_UNKNOWN_KEY` into
      *fatal*, `[[File]]` *key*, `[[Subject]]` that key. If `use` is present and is not a non-empty
      List of Strings without a repeated element, collect `E_CONFIG` into *fatal*, `[[File]]` *key*,
      `[[Subject]]` `use`.
   4. For each string *s* of `dependencies` that is not a valid Pattern (§8.1), collect
      `E_PATTERN` into *attached*, `[[File]]` *key*, `[[Subject]]` *s*.
   5. Produce the Declaration { `[[File]]`: *key*, `[[Dependencies]]`: the strings of
      `dependencies`, `[[Use]]`: the strings of `use`, or « » if it is absent, `[[Origin]]`:
      `config`, `[[Recorded]]`: none }.
9. If *fatal* is not empty, raise *fatal*.
10. Return the Config, with defaults (§5.2) for absent keys, `[[Presets]]` from `presets`, and the
    Declarations in path order, *attached* and *present* true.

NOTE: A bad pattern makes only its file `invalid`; every other file is still evaluated.
A structural error stops evaluation.

NOTE: `include` replaces the default `**/*.md` (§5.2); it selects only where inline blocks are
searched (§9.6.1), never which files may be dependencies. `files` stays required: a Configuration
file that only sets `ignore` or `include` writes `files: {}`.

NOTE: Steps 5 to 10 never see the Carrier. Key order in a Map is not significant: the Declarations are
in path order (step 10).

### 9.4 Stamped Files

A file with a configured Declaration MUST be an entry of kind *file* whose name, in the listing of
its parent directory, is equal to the last segment of the file's RepoPath after §7.4. A file
need not be in the Universe; it may be an ignored file. An inline file is in the Universe
(§9.6.3).

NOTE: The check uses the directory listing, not a lookup by path, so `claude.md` does not resolve
to `CLAUDE.md` on a case-insensitive file system. Renaming a file without renaming its key
raises `E_FILE_MISSING`.

### 9.5 Script Carriers

`LoadScript(path)` returns the normalized value of a Configuration file whose name is not
`docstamp.yaml`, or raises `E_CONFIG`:

1. Evaluate the file at *path*, synchronously, as a module of the host runtime. If it cannot be
   loaded, if evaluation throws, or if evaluation is asynchronous (top-level `await`), raise
   « `E_CONFIG` ».
2. Let *exports* be the module's exports. If *exports* is an ECMAScript module namespace whose
   `default` export is absent, `undefined` or Null, raise « `E_CONFIG` »; its message says to
   use `export default`, and that a CommonJS `module.exports` value is accepted. Otherwise let
   *exported* be its `default` export if *exports* has one that is neither `undefined` nor Null,
   else *exports*.
3. Return ? `ToPlain(exported, empty)`.

`ToPlain(v, ancestors)`, where *ancestors* is the List of objects being converted, raises
`E_CONFIG` with `[[Subject]]` the top-level key whose value contains *v* (empty if *v* is the
exported value itself):

1. If *v* is Null, a Boolean or a String, return it.
2. If *v* is a Number, return it if it is finite, else raise.
3. If *v* is an object that is in *ancestors*, raise. If *v* is a Proxy, raise.
4. If *v* is an Array, every own property of it MUST be a data property named by an index below
   its length or `length`, and every index below its length MUST be present; otherwise raise.
   Return the List of `ToPlain(element, ancestors + « v »)` for its elements in index order.
5. If *v* is an object whose prototype is the Object prototype or null, every own property of it
   MUST be an enumerable data property named by a String; otherwise raise. Return the Map of
   each name to `ToPlain(value, ancestors + « v »)`.
6. Raise. This covers `undefined`, functions, symbols, big integers, accessors, class instances
   and every other object.

NOTE: A Proxy is rejected wherever it occurs, even one that wraps a plain object or an Array, since
its traps can answer differently on each access.

NOTE: A value nested too deeply to traverse, so that the host runtime exhausts its stack, raises
`E_CONFIG` with an empty `[[Subject]]`.

NOTE: A script Carrier is evaluated by the host runtime's module loader, which may cache it. A
process that reads the same path more than once may observe the first evaluation (the CLI reads
once).

NOTE: A value reached twice without a cycle is allowed and is converted twice. Duplicate keys
cannot occur, and the key order of a Map is not significant (§9.3).

NOTE: TypeScript files are evaluated by the host runtime's type stripping, so only erasable
TypeScript syntax is supported: no `enum`, no `namespace` with values, no parameter properties.

NOTE: Evaluating a Configuration file runs its code, and the code may import other files. Those
files are not dependencies, not hashed and not part of the Universe, so a change in them changes
no verdict. A script Carrier SHOULD import only `docstamp`, and its value SHOULD NOT depend on the
environment, the clock or the network (§2).

### 9.6 Inline Declarations

#### 9.6.1 Candidates

A *candidate* is a file of the Universe of kind *file* that `config.[[Include]]` selects
(`Select`, §8.4). A candidate is an *inline file* when `ScanFrontmatter` (§5.6) of its text is not
*none*. The text of a file is its bytes decoded as UTF-8, a leading U+FEFF kept; a file that is
binary (§10.1) or not valid UTF-8 has no text and is not an inline file.

#### 9.6.2 Parsing

`ParseBlock(file, scan)` returns a Declaration or raises a List of Diagnostics attached to *file*:

1. Let *problems* be an empty List.
2. If the marker line, after `docstamp:`, is not only blanks and an optional `#` comment, collect
   `E_BLOCK`, `[[Subject]]` `docstamp`, and return the Declaration with no dependencies together
   with *problems*: the block MUST be a block mapping.
3. Parse the lines between the delimiters, joined, under the strict profile of §9.2 (the profile
   of §9.2 applies to this text and to no other frontmatter). If that fails, collect `E_BLOCK`,
   `[[Subject]]` `frontmatter`, and return as in step 2. A duplicate `docstamp` key fails here.
4. If the document is not a mapping, or its key `docstamp` is not a mapping, collect `E_BLOCK`,
   `[[Subject]]` `docstamp`, and return as in step 2.
5. For each key of the block other than `dependencies`, `use` and `hash`, collect `E_UNKNOWN_KEY`,
   `[[Subject]]` the key.
6. If `dependencies` is present but not a non-empty List of Strings, or is absent and step 5
   collected no `E_UNKNOWN_KEY`, collect `E_BLOCK`, `[[Subject]]` `dependencies`. Otherwise, for
   each string *s* of it that is not a valid Pattern (§8.1), collect `E_PATTERN`, `[[Subject]]`
   *s*. If `use` is present and is not a non-empty List of Strings without a repeated element,
   collect `E_BLOCK`, `[[Subject]]` `use`.
7. If `hash` is present, let *recorded* be it. Collect `E_BLOCK`, `[[Subject]]` `hash`, unless
   *recorded* is a String of 64 characters of `[0-9a-f]`, the scan has exactly one
   line of *hashLines*, and that line, after `hash:`, is one or more blanks, *recorded* itself,
   optional blanks, an optional `#` comment and its terminator.
8. If *problems* is empty, return the Declaration { `[[File]]` *file*, `[[Dependencies]]` the
   strings of `dependencies`, `[[Use]]` the strings of `use`, or « » if it is absent, `[[Origin]]`
   `inline`, `[[Recorded]]` *recorded*, or none }. Otherwise raise *problems*, and the Declaration of the Result
   (§12.1) is { *file*, the strings of `dependencies` if it is a List of Strings else « » }.

NOTE: One fault, one Diagnostic. A key that is not part of the block is reported once, as
`E_UNKNOWN_KEY` attached to the file, and never also as `E_BLOCK`: a mistyped `dependancies` does
not add "`dependencies` is missing". `E_BLOCK` remains for exactly these cases: the marker line is
not a block mapping (step 2); the frontmatter is not strict YAML (step 3); the document or the
`docstamp` key is not a mapping (step 4); `dependencies` is absent and no key is unknown, or is
present and not a non-empty List of Strings (step 6); `use` is not a non-empty List of Strings
without a repeated element (step 6); `hash` is not 64 lowercase hexadecimal digits
alone on its line (step 7). A block with an unknown key and a malformed `dependencies` or `hash`
has one Diagnostic for each fault.

#### 9.6.3 Discovery

`ReadInline(root, universe, config)` returns the inline Declarations, the attached Diagnostics
and the *marked* Map from RepoPath to the `[[hashLines]]` of its scan, or raises:

1. Let *fatal* be an empty List, and let *candidates* be as in §9.6.1.
2. For each candidate *c*, in path order: read its text. If it cannot be read, collect
   `E_UNREADABLE` into *fatal*, `[[Subject]]` *c*, and continue. If `ScanFrontmatter` is *none*,
   continue. Add *c* and the hash lines of its scan to *marked*, and call `ParseBlock`: add the
   Declaration it returns to the Declarations, and its raised Diagnostics to *attached*.
3. If *fatal* is not empty, raise it. Otherwise return the three Lists.

NOTE: Only a file in the Universe is a candidate, so an inline file is never ignored by an ignore
rule or `.gitignore`, never a link, and is never the Configuration file or the Lockfile. A file
can be moved or renamed, because its declaration is in the file itself.

NOTE: The frontmatter of a candidate with no `docstamp:` line is not read as YAML at all, so
anchors, tags and every other YAML feature the profile rejects are harmless there.

#### 9.6.4 Stamping

`Stamp(root, file, hash)` writes the Hash *hash* into the inline block of *file*, whose scan is
*scan*. It changes no byte of the file other than the ones it names:

1. If *scan* has exactly one line of *hashLines*, replace in that line the 64 characters of its
   value by *hash*.
2. Otherwise insert, after the line *last* of *scan*, the line *keyIndent*, `hash: `, *hash*
   and the terminator of the line *last*, which has one because *close* follows it.
3. Replace *file* atomically with the resulting bytes, with its file mode: a concurrent reader sees
   either the old contents or the new. If this fails, raise « `E_UNREADABLE` » with `[[Subject]]`
   *file*, leaving the old contents.

NOTE: The text is not re-serialized: comments, quoting, key order, other frontmatter, the byte
order mark, the body and the line terminators of every line survive. The appended `hash` line uses
the terminator of the last line of the block, so CR LF files stay CR LF.

NOTE: Reformatting the frontmatter of an inline file *B* (a formatter reflowing `dependencies`,
say) is a content change of *B* (§10.2): every file that depends on *B* becomes `stale` with
`content-changed`, although no fact changed. A formatter that rewrites the `hash` line into
another form (quoted, wrapped) makes *B* `invalid` (§9.6.2 step 7). Exclude the block from
formatters, or run `docstamp update` after formatting.

NOTE: Deliberate, for now: an edit that touches only a comment or whitespace inside the `docstamp:`
block of an inline file *B*, apart from its `hash` line, still counts as a change of *B* (§10.2), so
the files that depend on *B* become `stale`. Counting only the declaration, or normalizing the
comments of the block, would change the Hash of every inline file that has such comments: that is a
hash input change, breaking (§17.2) and needing a deliberate decision and a Lockfile `version`
(§17.4). It is not part of this version; the issue that tracks it (nam-hle/docstamp#24) stays open
for that part.

#### 9.6.5 Writing a Block

`WriteBlock(text, dependencies)` returns the text of a file with an inline block that declares
*dependencies*, a non-empty List of patterns, and never a `hash` key, or raises `E_USAGE`. It is
used only by `suggest --write` (§13.10); it never records a Review.

1. Let *scan* be `ScanFrontmatter(text)`. Let *item*(*s*) be *s* if it matches
   `^([A-Za-z_]|\.[A-Za-z_])[A-Za-z0-9_./@+=*?\[\]{},-]*$` and is none of `true`, `false`, `null`,
   `y`, `n`, `yes`, `no`, `on`, `off`, `.inf`, `.nan` in any letter case, else `Quote(s)` (§3.4).
2. If *scan* is not *none*:
   1. If *hashLines* of *scan* is not empty, raise: a block that records a Hash is never
      overwritten; its message tells the user to edit it by hand. Likewise raise if a line from
      *marker* + 1 to *last* starts with *keyIndent* followed by `use:`: a block that names presets
      (§8.6) is never overwritten, so its `use` is never lost.
   2. If the marker line, after `docstamp:`, is not only blanks and an optional `#` comment, raise.
   3. Let *indent* be *keyIndent*, or two U+0020 if it is *absent*, and *eol* the terminator of the
      marker line. Replace the lines after *marker* up to and including *last* by the line *indent*
      and `dependencies:`, and, for each pattern *s*, the line *indent*, two U+0020, `- `,
      *item*(*s*), each followed by *eol*.
3. Otherwise, if the first line of *text* (without a leading U+FEFF) and a later line are `---`
   (§5.6 steps 2 and 3), insert before that later line the line `docstamp:` and, for the lines of
   step 2.3 with *indent* two U+0020, each followed by the terminator of the first line.
4. Otherwise let *text* start with the U+FEFF if it has one, then the lines `---`, `docstamp:` and
   the lines of step 2.3 with *indent* two U+0020, then `---`, each followed by the terminator of
   the first line of *text* (CR LF if it is CR LF, else LF), then the rest of *text*.
5. Let *result* be the text so produced. If `ScanFrontmatter(result)` is *none*, if `ParseBlock`
   (§9.6.2) of it raises, or if the dependencies it declares differ from *dependencies*, raise.
   Otherwise return *result*.

NOTE: Every byte of *text* outside the replaced lines survives: the other frontmatter, the byte
order mark, the body and the line terminators of every line. The replaced lines are the ones of the
block, so a comment inside a block without a `hash` is not kept; the marker line, with its own
comment, is. Step 5 is the safety net: a frontmatter this clause cannot extend with certainty (for
example one that is not strict YAML, §9.2, or already has a quoted `"docstamp"` key) is
refused, never rewritten.

## 10 Hashing

### 10.1 Binary Content

A byte sequence is *binary* iff its first min(8192, length) bytes contain the byte 0x00.

### 10.2 Normalized Content

`NormalizedContent(path, marked)`, for a RepoPath of the Universe and the Map *marked* of §9.6.3
(empty when no file has an inline block):

1. If the entry is a *link*, return the bytes `link`, 0x00, and the UTF-8 encoding of its target
   String as stored, with every `\` replaced by `/`.
2. Read the file's bytes. If reading fails, raise « `E_UNREADABLE` » with `[[Subject]]` *path*.
3. If the bytes are binary, let *body* be the bytes. Otherwise let *body* be the bytes with every
   pair 0x0D 0x0A replaced by 0x0A.
4. If *path* is in *marked* (§9.6.3), remove from *body* every line whose index is in the
   `[[hashLines]]` recorded for *path*, each with its LF.
5. Return the bytes `file`, 0x00, and *body*.

NOTE: Step 4 is the hash input rule for an inline file: the line holding its `hash` key, and only
it, is not part of its content, so that a Write of file *B* never makes a file *A* that depends on
*B* stale. Everything else of *B* counts: its prose, its other frontmatter and its `dependencies`.
A file that is not in *marked* is hashed exactly as before, and so is an inline file that has no
`hash` line. A file is *marked* only when it is in the Universe and selected by `[[Include]]`; the
same file hashes with its `hash` line when `[[Include]]` does not select it.

NOTE: The only normalization is CR LF to LF in text. There is no normalization of license or
copyright headers, of whitespace, of a final newline, or of formatting, so a change to any of
them is a content change. A lone CR, a byte order mark, UTF-16 text (binary by §10.1) and every
binary file are hashed byte for byte. A link is never followed: its target string is hashed, so a link
to a file outside Root hashes the same on every host.

### 10.3 Hash

A *Hash* is the lowercase hexadecimal encoding of a SHA-256 digest: exactly 64 characters in
`[0-9a-f]`. `FileHash(path)` is the Hash of `? NormalizedContent(path)`.

### 10.4 Dependency Hash

`DependencyHash(resolved)`, where *resolved* is a List of RepoPaths in path order:

1. Let *problems* be an empty List and *input* the empty byte sequence.
2. For each *path* of *resolved*: if `FileHash(path)` raises, add its Diagnostics to *problems*;
   otherwise append the UTF-8 encoding of *path*, the byte 0x00, the 64 ASCII bytes of the Hash,
   and the byte 0x0A.
3. If *problems* is not empty, raise *problems*. Otherwise return the Hash of *input*.

NOTE: The path is part of the input, so renaming or moving a dependency changes the Dependency Hash
even when its content does not. An empty file contributes the Hash of the bytes `file`, 0x00.

NOTE: The result for files modified while docstamp runs is undefined.

## 11 Lockfile

### 11.1 Reading

`ReadLock(root)` returns a Lock or raises:

1. If an entry named `docsync.lock` exists at Root, whatever its content, raise
   « `E_LOCK_VERSION` » with `[[Subject]]` `docsync.lock`. Its message names the fix: delete
   `docsync.lock`, review every file, then run `docstamp update --all`.
2. If `docstamp-lock.yaml` does not exist at Root, return a Lock with no entries.
3. Parse it under §9.2. On failure, or if the document is not a mapping, raise « `E_LOCK` ».
4. If the key `version` is absent, or its value is not the plain scalar `3`, raise
   « `E_LOCK_VERSION` ». For a version 2 Lockfile its message names the migration: run
   `docstamp update --all` to rewrite it as version 3; the hashes are unchanged.

5. Raise « `E_LOCK` » unless all of these hold:
   1. The document's keys are exactly `version` and `files`.
   2. `files` is a mapping whose keys are RepoPaths and whose values are each a String of 64
      characters in `[0-9a-f]`.
6. Return the Lock.

NOTE: Unresolved merge conflict markers fail step 3. The message for `E_LOCK` names the fix:
resolve the conflict by taking either side, then run `docstamp`.

NOTE: The version 3 Lockfile differs from version 2 only in the name of its top-level key, `files`
instead of `dependents`; the Dependency Hash (§10.4) is computed identically, so every entry of a
version 2 Lockfile is still correct. `update --all` rewrites it without a Review (§13.6).

NOTE: `docsync.lock` is the name of the version 1 Lockfile, written before the tool was renamed
docstamp; the old name is kept on purpose. It also recorded the patterns.
Step 1 refuses it so that stale records are never silently dropped. Nothing deletes it
automatically (§13.6): the error persists until the file is deleted.

### 11.2 Canonical Form

`LockText(lock)` is this text, with LF line endings and a final LF:

```
version: 3
files:
  <Quote(file)>: <hash>
```

- Keys always appear in this order: `version`, `files`.
- One line per entry, in path order of the file. With no entries, the second line is
  `files: {}`.
- Indentation is two spaces.

NOTE: Two branches that write the same file conflict on its `hash` line, as two branches that
change one dependency conflict in a package-manager lockfile. Resolution: take either side, run
`docstamp`, review what it reports stale, and write again.

### 11.3 Writing

`WriteLock(root, lock)`:

1. Let *text* be `LockText(lock)`.
2. If `docstamp-lock.yaml` exists and its contents, with every 0x0D 0x0A replaced by 0x0A, equal the
   UTF-8 encoding of *text*, return without writing.
3. Replace `docstamp-lock.yaml` atomically with the UTF-8 encoding of *text*: a concurrent reader sees
   either the old contents or the new. If this fails, for example because Root is not writable,
   raise « `E_UNREADABLE` » with `[[Subject]]` `docstamp-lock.yaml`, leaving the old contents.

NOTE: Step 2 tolerates a checkout that converted the Lockfile to CR LF. Repositories SHOULD
declare `docstamp-lock.yaml text eol=lf` in `.gitattributes`.

## 12 Evaluation

### 12.1 Evaluate

`Evaluate(declaration, universe, lock, attached)`, where *attached* is the List of Diagnostics
from §9.3, §9.6 and §12.2 attached to `declaration.[[File]]`:

1. Let *r* be a Result with `[[File]]`, `[[Use]]` and `[[Dependencies]]` from *declaration*, the
   latter being its effective patterns (§8.6) and `[[Origins]]` their origins (none for each, when
   *declaration* has no `[[Use]]`), empty `[[Reasons]]`, `[[Resolved]]` and `[[Diagnostics]]`, and
   empty `[[Current]]`.
2. Let *problems* be a copy of *attached*, and *warnings* an empty List.
3. If `declaration.[[File]]` does not satisfy §9.4, collect `E_FILE_MISSING` into
   *problems*. (An inline file always satisfies it.)
4. If *attached* is empty, let *resolved* and *warnings* be the result of
   `ResolveDependencies(declaration, universe)`; if it raises, add its Diagnostics, warnings
   included, to *problems*.
5. If *problems* is empty, let *current* be `DependencyHash(resolved)`; if it raises, add its
   Diagnostics to *problems*.
6. If *problems* is not empty, set *r*.`[[State]]` to `invalid` and *r*.`[[Diagnostics]]` to
   *problems*, each with `[[File]]` set to `declaration.[[File]]`, and return *r*.
7. Set *r*.`[[Resolved]]` to *resolved*, *r*.`[[Current]]` to *current* and *r*.`[[Diagnostics]]`
   to *warnings*, each with `[[File]]` set to `declaration.[[File]]`.
8. Let *entry* be `declaration.[[Recorded]]` if `declaration.[[Origin]]` is `inline`, else the
   LockEntry of `declaration.[[File]]` in *lock*, or *none*.
9. If *entry* is *none*, append `unrecorded`. Otherwise, if *entry* is not equal to *current*,
   append `content-changed`.
10. Set *r*.`[[State]]` to `stale` if *r*.`[[Reasons]]` is non-empty, else `ok`. Return *r*.

NOTE: `content-changed` is raised for every change to the set of dependencies: an edited file, a
new file the patterns select, a deleted file, a renamed or moved file, and so a pattern change that
changes the set of dependencies. A pattern change that leaves the set of dependencies identical
leaves the file `ok`.

### 12.2 EvaluateAll

`EvaluateAll(root, lockPolicy)` returns Results, the Lock, and a List of global Diagnostics, or
raises:

1. Let (*config*, *attached*, *present*) be `? ReadConfig(root)`.
2. Let *universe* be `? ComputeUniverse(root, config)`.
3. Let (*inline*, *more*, *marked*) be `? ReadInline(root, universe, config)`. Let *attached* be
   *attached* and *more*.
4. If *present* is false and *marked* is empty, raise « `E_CONFIG_MISSING` ».
5. Let *declarations* be `config.[[Declarations]]` and the Declarations of *inline*, in path order
   of `[[File]]`. For each file declared by both a configured and an inline Declaration, drop the
   inline Declaration and the Diagnostics of *attached* for that file that came from *inline*, and
   collect `E_DUPLICATE_DECLARATION` into *attached*, `[[File]]` that file. Then, for each remaining
   Declaration *d* with a non-empty `[[Use]]`, call `ExpandPresets(d, config.[[Presets]], present)`
   (§8.6): when it returns, the effective patterns and their origins are those of *d* from here on;
   when it raises, collect its Diagnostics into *attached*, `[[File]]` the file of *d*.
6. If *lockPolicy* is `discard-invalid` and `ReadLock(root)` raises, let *lock* be a Lock with no
   entries. Otherwise let *lock* be `? ReadLock(root)`.
7. Let *results* be `Evaluate(b, universe, lock, attached of b)` for each *b* of *declarations*,
   in path order, hashing every file with `NormalizedContent(path, marked)`.
8. Let *global* be a List holding, for each file of *lock* with no configured Declaration, a
   `W_ORPHAN` with `[[Subject]]` that file.
9. Return *results*, *lock* and *global*.

NOTE: A Root with no Configuration file and no inline block raises in step 4, as it did before
inline blocks existed, so that a gate that checks nothing never passes unnoticed. A Root with a
Configuration file and `files: {}` and no inline block has no Results and passes.

NOTE: There is no propagation between files. If C depends on B and B depends on code, a change in
the code makes B stale and leaves C ok. Writing B changes only the Lockfile, which is never in the
Universe (§7.2 step 3), so C stays ok. C becomes stale only when B's content changes. When B is an
inline file, writing B changes B itself, but not its `hash` line's part of its content (§10.2
step 4), so C stays ok in the same way. `list-dependents --transitive` (§13.8) lists such chains
without changing any verdict.

### 12.3 ChangedSince

`ChangedSince(root, result, entry)` returns a List of Change, the commit *C* below and the
`[[Edited]]` of step 9, or *unknown*. It is
run, in a check (§13.5), only for a Result whose `[[State]]` is `stale`, whose `[[Reasons]]`
contain `content-changed`, and whose file has a LockEntry *entry*, or an inline `[[Recorded]]`
Hash *entry*; for every other Result `[[Changes]]` is *unknown*.

1. Run `git` in Root with every environment variable starting with `GIT_` removed and
   `GIT_OPTIONAL_LOCKS=0` set, so that no inherited repository or index selection applies and
   nothing is written, and with `-c core.autocrlf=false` before the subcommand. If `git` is unavailable, Root is not inside a git work tree, the repository
   is shallow (`git rev-parse --is-shallow-repository` prints anything but `false`), or a command
   fails, return *unknown*.
   1. List the commits of `git log --format=%H -S<entry> -- docstamp-lock.yaml`, newest first.
   2. For each, parse `docstamp-lock.yaml` as of that commit and as of its first parent by §11.1
      steps 3 to 5. The file is *none* for a root commit, when it is absent there, or when it does
      not parse (for example a version 1 or 2 file); that is never an error.
   3. Let *C* be the first commit in which the file's LockEntry equals *entry* and its
      parent's does not. If there is none, return *unknown*.
   4. Let *edited* be true iff the Declaration's *own list* as of *C* is known and differs from its
      own list now. The own list is the pair (the patterns of `result.[[Dependencies]]` whose
      `[[Origins]]` element is none, in order; `result.[[Use]]`). As of *C* it is read from
      `docstamp.yaml` there for a configured file (the `dependencies` and `use` of the key
      `result.[[File]]` under `files`, parsed by §9.2), and from the inline block of the file there
      for an inline file (§9.6.2, its `dependencies` and `use`). It is unknown when that file is
      absent at *C*, does not parse, or does not declare `result.[[File]]` with a non-empty
      `dependencies`; a script Carrier (§9.5) is never read, so its own list at *C* is unknown.
      The *carrier* is `docstamp.yaml` for a configured file and `result.[[File]]` for an inline
      one.

   For an inline file, steps 1.1 to 1.3 are instead: list the commits of
   `git log --format=%H -S<entry> -- <file>`, newest first; the recorded Hash of the file as of a
   commit or its first parent is the Hash on the one line of *hashLines* of
   `ScanFrontmatter` (§5.6) of its text there, *none* if the file is absent, has no such line or no
   such value; *C* is as above. A file renamed since the commit yields *unknown*.
2. Let *diff* be the output of `git diff --name-status --no-renames -z
   --relative <C> --` run in Root (the work tree against *C*, so staged and unstaged edits are
   included), and *untracked* the output of `git ls-files --others --exclude-standard -z` run in
   Root. Their paths are relative to Root, so a Root below the top level of the work tree works.
   Convert every path to NFC.
3. Build the changes: git status `M` or `T` gives `modified`; `A` gives `added`; `D` gives
   `deleted`; any other status returns *unknown*. Every path of *untracked* is `added`. A path that
   is both `deleted` and `added` is `modified`.
4. Keep a Change only if its path is selected by the Declaration's patterns: for `added` and
   `modified`, the path is in `result.[[Resolved]]`; for `deleted`, the path is not
   `result.[[File]]` and `Select(result.[[Dependencies]], « path »)` selects it, since a deleted
   file is no longer a dependency.
5. If the Changes are empty and *edited* is false, return *unknown*.
6. Set `[[Via]]` of each Change to the patterns of `result.[[Dependencies]]` that have no Negation
   and satisfy `PatternMatches(pattern, path)`, in declaration order (as §13.8 step 4.2 does).
7. Set `[[WhitespaceOnly]]` of each Change: true iff its status is `modified`,
   `git --literal-pathspecs diff --ignore-all-space --ignore-blank-lines --quiet <C> -- <path>`,
   run in Root as step 1 does, exits with status 0, and `git --literal-pathspecs diff --raw
   --no-renames <C> -- <path>` shows no change of file mode; false for any other status, any other
   exit status and any failure.
8. Pair renamed files. Let *before* map each path to its object name in *C*, from
   `git ls-tree -r -z <C>` run in Root as step 1 does, for the entries of mode `100644` or
   `100755` only; and *after* map each path of an `added` Change that holds no LF to the object
   name printed for it by `git hash-object --stdin-paths`, run in Root as step 1 does with those
   paths, one per line, as its input, each preceded by the output of `git rev-parse --show-prefix`
   without its line end (git reads these paths from the top level of the work tree, not from
   Root). If any of these commands fails, no Change is paired. Otherwise, for
   each `deleted` Change *d* in path order whose path is in *before*, let *a* be the first `added`
   Change in path order that is not yet paired and whose path has the same object name in
   *after*; if there is one, set `[[Pair]]` of *d* to the path of *a* and `[[Pair]]` of *a* to the
   path of *d*. Every other Change has `[[Pair]]` none.
9. Return the Changes in path order, *C*, which is `[[Base]]` of the Result, and the carrier if
   *edited* is true, else none, which is its `[[Edited]]`.

NOTE: Two paths are paired only when the file was deleted at one and added at the other with
exactly the same content, as git stores it: a renamed file that was also edited stays a `deleted`
and an `added` Change. Pairing reads no similarity score and no git configuration of rename
detection, and step 2 still passes `--no-renames`, so the result is the same on every host with the
same history. Both paths stay Changes; `[[Pair]]` only links them.

Any error at any step returns *unknown*. `ChangedSince` never raises a Diagnostic and never affects
the exit code.

NOTE: *entry* is searched as text; no commit ID is stored. A rebase, squash or amend of
the review commit therefore keeps working. Step 1.3 ignores commits where another file with
the same Hash removed it. A shallow clone, or a Write that is not yet committed, yields *unknown*;
so does an empty result with no edit, since a stale `content-changed` Result must have changed
something. Removing a pattern from the own list changes the set of dependencies without changing
a file, so the Changes can be empty while *edited* is true: the report then says only that.

NOTE: `[[Via]]` names the patterns that select a path, so that a reviewer sees why a file is
in the report. `[[WhitespaceOnly]]` is the judgement of git on the text: it ignores any change in
the amount of white space, a carriage return at the end of a line, and blank lines. A change of
file mode or of file type is a difference, which the second command makes certain of: the first
alone depends on the version of git. `[[WhitespaceOnly]]` says nothing about meaning (white space
is significant in some formats) and never changes a state: the Dependency Hash still counts the
change (§10.2).

NOTE: `core.autocrlf=false` keeps the report independent of the user's git configuration. With
`core.autocrlf=true`, the default of Git for Windows, git converts CRLF to LF when it compares the
work tree, so a file rewritten from LF to CRLF would drop out of the report on one machine and be
listed `modified` (whitespace only) on another. Attributes the repository itself declares
(`.gitattributes` `text`, `eol`) still apply.

NOTE: Known limit. The report is the difference between the work tree and the commit *C* that
introduced the LockEntry, so an edit committed in the same commit as the Write is not in the
report: the file is `stale` with `content-changed`, but that edit is not listed. This follows from
storing one Hash and no commit ID. Commit the Lockfile separately from the edits it covers, or
list the dependencies (§13.7) and review them in full.

### 12.4 Replay

`Replay(root, window, now)` returns a Window or raises « `E_HISTORY` ». The argument *window* is
`days N` (*N* from 1 to 3650) or `from R` (*R* a String), and *now* the wall-clock time in whole
seconds since the epoch. A *Window* is { `[[Kind]]`: `days` or `revision`, `[[Commits]]`: a List of
Commit }. A *Commit* is { `[[Day]]`: a String `YYYY-MM-DD`, `[[Paths]]`: a List of RepoPath }.

1. Run `git` in Root as §12.3 step 1 does (every `GIT_` variable removed, `GIT_OPTIONAL_LOCKS=0`).
   If `git` is unavailable, Root is not inside a git work tree, `HEAD` does not name a commit, or
   the repository is shallow (`git rev-parse --is-shallow-repository` prints anything but
   `false`), raise `E_HISTORY` with an empty `[[Subject]]`.
2. For `from R`: let *id* be the output of `git rev-parse --verify --quiet R^{commit}`. If that
   fails, raise `E_HISTORY` with `[[Subject]]` *R*. The *kind* is `revision` and the *range* is
   `<id>..HEAD`.
3. For `days N`: let *limit* be *now* − *N* × 86400. The *kind* is `days` and the *range* is
   `--max-age=<limit>` and `HEAD`, where *limit* is written in decimal digits: git compares the
   committer time of each commit with that number of seconds and keeps the commit when it is not
   smaller, and parses no date.
4. Run `git log --no-merges --no-renames --no-show-signature --relative --name-only -z` with a
   format that prints, for each commit, its Id and its committer time in seconds since the epoch,
   and with the *range*: one invocation, newest commit first. If it fails, raise `E_HISTORY` with
   an empty `[[Subject]]`.
5. Return the Window whose Commits are those of the output in the same order: `[[Day]]` is the
   calendar date in UTC of the committer time, and `[[Paths]]` the paths the commit changed,
   relative to Root, in NFC, in the order git prints them.

NOTE: *last N days* means the commits whose committer time is not older than *N* × 86400 seconds
before *now*: a sliding window, not calendar days. It depends on the clock of the run, so the same
history gives another Window tomorrow; `from R` does not, and a test uses it. A `from R` that names
no commit is repository state, so it is `E_HISTORY`, where a malformed option value is `E_USAGE`
(§13.2).

NOTE: The Window excludes merge commits, so a change that exists only in the resolution of a
merge conflict is not seen. A commit that changed nothing under Root, or nothing at all, is in the
Window with no Paths. Because renames are not detected, a rename is a deletion of the old path
and an addition of the new one, and the commit touches both; at `HEAD` only the new path can be a
dependency (§12.5), and both count towards the size of the commit.

NOTE: The Window answers for the repository, not for Root: when Root is below the top level of
the work tree, the commits that changed nothing under Root are in the Window and make no file stale.

### 12.5 Statistics

`Statistics(results, window)` returns, for the Results (none `invalid`), a List of FileStats and the
Number *untouched*. The *sweep size* is the constant 200.

A Commit *touches* a Result when a path of its `[[Paths]]` is in the Result's `[[Resolved]]`: it
is a commit that would make the file stale. For each Result *r*, let *touching* be the Commits of
the Window that touch *r*:

- `[[Patterns]]`: the number of strings in `r.[[Dependencies]]`;
- `[[ResolvedCount]]`: the number of `r.[[Resolved]]`;
- `[[StaleCommits]]`: the number of *touching*;
- `[[Days]]`: the number of distinct `[[Day]]` among *touching*;
- `[[SweepCommits]]`: the number of Commits of *touching* whose `[[Paths]]` hold more than the
  sweep size of distinct paths;
- `[[StaleRate]]`: `Ratio(StaleCommits, N)`, where *N* is the number of Commits of the Window, and
  `[[SweepShare]]`: `Ratio(SweepCommits, StaleCommits)`.

`Ratio(n, d)` is 0 if *d* is 0; otherwise *n* ∕ *d* rounded half up to 4 decimal places, computed in
integers as `floor((20000 n + d) / (2 d))` ten-thousandths, so that the value never depends on
floating point. It is reported as the Number of that many ten-thousandths divided by 10000.

*untouched* is the number of Commits of the Window that touch no Result.

The FileStats are in descending order of `[[StaleRate]]` as reported, then ascending path order of
the file.

NOTE: Dependencies are the ones resolved now, at `HEAD` (§12.1), not the ones of each commit: a
file deleted or renamed inside the Window is not a dependency any more and is not seen. A Window
that crosses a reorganization therefore understates how often a list would have been stale.

### 12.6 Proposal

`Propose(doc, text, universe, isIgnored)` returns a List of *Suggestions* and a List of
*ignored* RepoPaths, in path order. *text* is the text of the file *doc* (§9.6.1), *universe* the Universe
(§7) and *isIgnored* the test of §8.5 NOTE. A *Suggestion* is { `[[Pattern]]`: a valid Pattern
(§8.1), `[[Files]]`: the List of RepoPaths it contributes, in path order }. Let *U* be *universe*
without *doc*. A *file* below is a member of *U*; a *directory* is a String that is a proper
prefix, before a `/`, of some path of *U*.

1. *Reading.* Let *lines* be the lines of *text* (§5.6). If `ScanFrontmatter(text)` is not *none*,
   remove the lines from its *marker* through its *last*: the inline block is never read, so that
   writing it (§9.6.5) cannot change a proposal. Remove the *fenced* lines: a line that, after at
   most three U+0020, starts with three or more U+007E, or with three or more U+0060 and has no
   other U+0060, opens a fence; the fence closes at the first later line that, after at most three U+0020, is only that
   code point, at least as many times, and blanks; one that is not closed lasts to the end. The
   opening, enclosed and closing lines are removed. Let *prose* be the other lines, joined.
2. *Spans.* A *code span* is a run of *n* U+0060 with no U+0060 next to it, code points that are
   not line terminators, and the next such run of exactly *n*. Collect, for each code span in
   *prose* from left to right, its content without leading and trailing blanks if that has no
   blank, a *span word*; replace the code span in *prose* by one U+0020.
3. *Links.* A *link target* is, in *prose*: after `](` and blanks, either `<`, code points other than
   `<`, `>` and line terminators, and `>`, or a run of code points other than whitespace, `(` and
   `)`; or, in a line that after at most three U+0020 is `[`, code points other than `]`, `]:` and
   blanks, the same two forms with a run of any non-whitespace code points. Collect each target
   without its `<` and `>`, and replace it, with them, by one U+0020.
4. *Words.* Split what remains of *prose* at whitespace and at each of U+0060, `(`, `)`, `<`, `>`,
   `"`, `'`, `|` and `;`. A *bare word* is a part that contains a `/` and does not start with `*`.
5. *Normalization.* `NormalizeWord(w)` returns a String or *none*: remove from the end of *w*, for a
   bare word only, every `.`, `,`, `;`, `:` and `!`; then a final `:` and digits, or `:`, digits, `:`
   and digits; cut *w* at its first `#`; remove every leading `./` and a leading `/`; remove every
   trailing `/`. Return *none* if *w* is then empty, starts with a scheme (`[A-Za-z][A-Za-z0-9+.-]*:`)
   or `!`, contains `\`, or has a segment that is empty, `.` or `..`. Otherwise return *w* in NFC.
   `NormalizeLink(t)` for a link target *t*: cut *t* at its first `#` or `?`; return *none* if it is
   then empty, starts with `//` or with a scheme; percent-decode it (a malformed escape leaves it
   as it is); resolve it lexically against the directory of *doc* (a leading `/` makes it relative
   to Root instead); return *none* if the result is empty or leaves Root; remove every trailing `/`;
   return it in NFC. The *candidates* are the `NormalizeWord` of every span word and of every bare
   word, and the `NormalizeLink` of every link target, that are not *none*, without duplicates.
6. *Classification.* A candidate with none of `*`, `?`, `[`, `{` is *literal*; it is dropped unless
   it is a valid Pattern without Negation that denotes itself (§8.5 NOTE). A literal candidate is a
   *file* if it is in *U*, else a *directory* if it is one, else it is added to *ignored* if
   *isIgnored* holds for it and it is not *doc*, else dropped. Any other candidate is a *glob*: it
   is dropped unless it is a valid Pattern without Negation with a Literal in some segment (so `*` and
   `**` are never proposed), and kept if `Select(« glob », U)` holds a file that is not *generic*.
7. *Generic files.* A file is *generic* iff it has no `/` and it is one of: `package.json`,
   `package-lock.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `yarn.lock`, `bun.lock`,
   `bun.lockb`, `deno.json`, `deno.jsonc`, `pyproject.toml`, `requirements.txt`, `setup.py`,
   `setup.cfg`, `poetry.lock`, `uv.lock`, `Cargo.toml`, `Cargo.lock`, `go.mod`, `go.sum`, `pom.xml`,
   `Gemfile`, `Gemfile.lock`, `composer.json`, `composer.lock`, `build.gradle`, `build.gradle.kts`,
   `settings.gradle`, `settings.gradle.kts`, `gradle.properties`, `Makefile`, `CMakeLists.txt`,
   `LICENSE`, `LICENSE.md`, `LICENSE.txt`, `LICENCE`, `COPYING`, `CHANGELOG.md`, `.gitignore`,
   `.gitattributes`, `docstamp.yaml`, `docstamp.config.ts`, `docstamp.config.mts`,
   `docstamp.config.js`, `docstamp.config.mjs`, `docstamp-lock.yaml`, or matches `tsconfig*.json`.
   Generic files are dropped from the *file* candidates.
8. *Collapse.* Let *files*, *dirs* and *globs* be the candidates so classified. For each directory
   *d* (never the empty String) with at least 3 of *files* directly in it, let *below* be the files
   of *U* below *d*: if *below* has at most 5 files, or every file of *below* is in *files*, add *d*
   to *dirs*.
9. *Coverage.* Remove from *dirs* every *d* below another member of *dirs*. For each *d* of *dirs*
   let its *exclusions* be, in this order, those of `!`*d*`/**/*.test.*`, `!`*d*`/**/*.spec.*`,
   `!`*d*`/**/__test__` and `!`*d*`/**/__tests__` that match (§8.3) at least one file of *U*, and
   none if some segment of *d* is `test`, `tests`, `spec`, `specs`, `__test__` or `__tests__`. Remove
   from *files* every file below a member *d* of *dirs* unless one of the exclusions of *d* matches it.
10. *Subsumption.* Let *reincluded* be the members of *files* below a member of *dirs* (those that
   an exclusion matches, step 9), and *base* the other members of *files*, *dirs* and *globs*. Let
   *sel*(*p*) be `Select(« p », U)`. Remove from *base* every *p* for which another member *q* of
   *base* has *sel*(*p*) ⊆ *sel*(*q*), and either *sel*(*q*) ⊄ *sel*(*p*) or *q* precedes *p* in
   path order; every *p* is tested against *base* as it was before this step. Let *cuts* be the
   exclusions of every member of *dirs*, in path order of their directory and, for one directory,
   in the order of step 9.
11. *Order.* The Suggestions are, first, the members *p* of *base* in path order, each with
   `[[Files]]` `Select(« p » followed by cuts, U)`; then
   one Suggestion for each of *cuts* in order, with `[[Files]]` the files of *U* that it matches;
   then the members *p* of *reincluded* in path order, each with `[[Files]]` « *p* ».

NOTE: A proposal is the list one would write by hand from what the doc says, and it is a proposal
only: nothing is read from the repository history, no pattern is judged too broad, and the doc is
not evaluated. Every non-excluding Suggestion selects a file of *U*, so the list passes §8.5 step 3
as written, and an exclusion matches a file of *U*, so it raises no `W_EMPTY_EXCLUSION`. Under the
last-match-wins rule of §8.4, an exclusion written before an inclusion that selects the same file
would be cancelled by it; steps 10 and 11 write every exclusion after every inclusion, so the
written list selects exactly the `[[Files]]` of its inclusions. The only patterns after the
exclusions are the files of *reincluded*: a file the doc names that an exclusion matches, such as a
test file it mentions, is named alone and selects only itself. Step 10 drops an inclusion that
another one covers, such as `packages/*` under `packages`, so the list has no redundant pattern;
of two that select the same files, the first in path order is kept. A Suggestion
for an exclusion has no files of its own: its `[[Files]]` are the files it matches. A mention in a
fenced block, in the inline block or of an ignored path is never proposed. A glob keeps a generic
file it happens to select. A literal path whose name has a `,`, `]` or `}` is not a valid Pattern
as written and is dropped.

## 13 Command Line

### 13.1 Synopsis

```
docstamp [check] [--json] [--only-stale] [--quiet] [--root <dir>] [<file>...]
docstamp update [--json] [--root <dir>] (--all | <file>...)
docstamp list-dependencies [--json] [--root <dir>] [<file>...]
docstamp list-dependents [--json] [--transitive] [--root <dir>] <file>...
docstamp stats [--json] [--root <dir>] [--since <n>d | --from <rev>] [<file>...]
docstamp suggest [--json] [--root <dir>] [--write] <file>...
docstamp help
docstamp version
docstamp --help
docstamp --version
```

The commands are `check` (§13.5), `update` (§13.6), `list-dependencies` (§13.7),
`list-dependents` (§13.8), `stats` (§13.9), `suggest` (§13.10), `help` and `version`. `--help` is the same command as `help`, and `--version` the same as `version`.

### 13.2 Parsing

The command line is parsed before anything else.

1. The options are `--json`, `--all`, `--transitive`, `--only-stale`, `--quiet`, `--write`, `--help`, `--version`, and the options with a value, each
   written `--name <value>` or `--name=<value>`: `--root`, `--since` and `--from`. Before any `--`, an argument starting with `-` other than a lone `-` is an
   option; an option with a value consumes the next argument as its value, unless that argument is
   `--` or another recognised option (including itself), which is a missing value. After `--`, every argument is a file argument.
2. The *first non-option argument* before any `--` is the command name if it is `check`, `update`,
   `list-dependencies`, `list-dependents`, `stats`, `suggest`, `help` or `version`; it is then not a file argument. Otherwise, and when there
   is none, the command is `check` and that argument stays a file argument. A command word in any
   later position, or after `--`, is a file argument. Options and file arguments may appear in
   any order.
3. `--help` before any `--`, or the command `help`, selects `help`; `--version` or the command
   `version` selects `version`. `help` wins over `version`. Both ignore every other argument and
   raise no `E_USAGE`.

Otherwise the following raise « `E_USAGE` » with `[[Subject]]` the offending argument, and exit 2.
Each message states the problem:

- an unknown option, a missing value for an option with a value (none, empty, `--`, or a
  recognised option, so `--root --json` is an error), or an option given twice;
- `--write` with any command but `suggest`, and `--files`, which were removed: the message names
  the replacement, `docstamp update` for `--write` and `docstamp list-dependencies` for `--files`;
- `--all` with any command but `update`;
- `--transitive` with any command but `list-dependents`;
- `--only-stale` or `--quiet` with any command but `check` (`[[Subject]]` the option);
- `update` with neither `--all` nor a file argument (`[[Subject]]` is `update`), or with both;
- `list-dependents` with no file argument (`[[Subject]]` is `list-dependents`), or `suggest` with
  none (`[[Subject]]` is `suggest`);
- `--since` or `--from` with any command but `stats`; `--since` and `--from` together (`[[Subject]]`
  `--since`, the message names both);
- a `--since` that is not a positive integer without leading zeros followed by `d` (`30d`), or is
  above `3650d`; the message shows the form. `30`, `30.days`, `0d`, `2 weeks ago` and dates are
  refused;
- a `--from` that starts with `-`.

`help` prints usage and `version` prints the version; both exit 0 (§14.1). A file named like a
command is reached as `docstamp check -- check`, `docstamp -- check` or `docstamp --json -- check`.

### 13.3 File Arguments

`SelectResults(args, cwd, root, results)` returns the selected Results or raises:

1. If *args* is empty, return *results*.
2. Let *problems* be an empty List. For each *arg*: let *path* be `ToRepoPath(arg, cwd, root)`.
   If that fails, or no Result has `[[File]]` equal to *path*, collect `E_UNKNOWN_FILE` with
   `[[Subject]]` *arg* into *problems*. When `ToRepoPath` failed, its `[[Message]]` says how *arg*
   was resolved, as §13.8 step 3 does.
3. If *problems* is not empty, raise *problems*.
4. Return the Results whose `[[File]]` was named, in path order without duplicates.

NOTE: A bad file argument raises, as a usage error does: nothing is reported for the good
arguments. A command line that cannot be answered in full is answered with its Diagnostics only.

### 13.4 Path Resolution

`ToRepoPath(arg, cwd, root)` is lexical: no symbolic link is resolved and no file system access
happens.

1. On Windows, replace every `\` in *arg* by `/`.
2. Join *arg* to *cwd* unless it is absolute, and remove `.` segments and resolve `..` segments
   textually.
3. If the result is not *root* followed by `/` and at least one segment, fail.
4. Return the remainder after *root* and `/`, converted to NFC. Fail if it is not a RepoPath.

No case folding is applied: the argument must equal the key under `files`, or the RepoPath of an
inline file.

### 13.5 Check

1. Let *root* be `? DetermineRoot(cwd, --root)`.
2. Let (*results*, *lock*, *global*) be `? EvaluateAll(root, strict)`.
3. Let *selected* be `? SelectResults(args, cwd, root, results)`.
4. Output *selected* and *global* (§14).
5. Exit with:
   - 2 if *global* contains an error or any of *selected* is `invalid`;
   - else 1 if any of *selected* is `stale`;
   - else 0.

If a step raises, output the raised Diagnostics as global and exit 2. No evaluation result
exists then, so nothing but the Diagnostics is output (§14.3, §14.5).

Step 4 evaluates Results as §12.1 and then sets `[[Changes]]` of each selected Result as §12.3.

`--only-stale` and `--quiet` change only what step 4 outputs, never a verdict or the exit code
of step 5. `--only-stale` omits the `ok` Results from `files` in JSON mode (§14.5); it has no
effect on text mode, which has no block for an `ok` Result. `--quiet` omits the summary line
of text mode when no selected Result is `stale` or `invalid` (§14.3); it has no effect on JSON
mode, which always outputs its document.

NOTE: Reviewer's recipe for a stale file. The text output (§14.3) and `changes` in JSON
(§14.5) name the dependencies that changed since the last Write when the repository history
allows (§12.3). Otherwise `docstamp list-dependencies <file>` lists the dependencies and the
reviewer compares them with the state at the last Write using its own tools.

### 13.6 Update

1. Let *root* be `? DetermineRoot(cwd, --root)`.
2. Let *policy* be `discard-invalid` if `--all` is given, else `strict`.
3. Let (*results*, *lock*, *global*) be `? EvaluateAll(root, policy)`.
4. If `--all` is given, let *targets* be *results*. Otherwise let *targets* be
   `? SelectResults(args, cwd, root, results)`.
5. If *global* contains an error or any of *targets* is `invalid`: output *targets* as a check
   does (§14.3) but without its `next:` lines, and *global*, write nothing, and exit 2.
6. For each *t* of *targets* whose Declaration is configured, set the LockEntry of
   *t*.`[[File]]` in *lock* to *t*.`[[Current]]`.
7. Let *removed* be the files of *lock* that have no configured Declaration, in path order. Remove
   their entries.
8. If some Declaration is configured, or `docstamp-lock.yaml` exists, `WriteLock(root, lock)`.
9. For each *t* of *targets* whose Declaration is inline, in path order, whose `[[Recorded]]` is
   not equal to *t*.`[[Current]]`: `Stamp(root, t.[[File]], t.[[Current]])` (§9.6.4).
10. Output, for each of *targets*, whether its LockEntry changed in step 6, or its `[[Recorded]]`
   Hash was none or differed from *t*.`[[Current]]` in step 9 (*written*), or was already equal to
   *t*.`[[Current]]` (*unchanged*), and *removed* (§14), and *global* without its `W_ORPHAN`
   Diagnostics, since step 7 removed those entries, and the warnings of *targets*. Exit 0.

If a step raises, output the raised Diagnostics as global and exit 2.

NOTE: `update --all` also migrates a version 2 Lockfile (§11.1): it discards the unreadable
Lockfile and records every current Dependency Hash, with no Review.

NOTE: `update --all` recovers from the legacy `docsync.lock` (§11.1 step 1) by writing
`docstamp-lock.yaml`, but does not delete `docsync.lock`: deletions stay explicit, and every
later run that reads the Lockfile raises `E_LOCK_VERSION` until the user deletes it.

NOTE: The Lockfile is not created for a Root whose Declarations are all inline: its first Write
leaves no `docstamp-lock.yaml`. A Write of an inline file is a Write of that file only: it
changes no other file, and a file that depends on it stays `ok` (§12.2 NOTE).

NOTE: A Write asserts that a Review happened; docstamp cannot check that, and trusts its caller.
`update` requires naming the files, or `--all` on purpose (first adoption, or recovery from an
unreadable Lockfile), so no file is marked reviewed by accident.

### 13.7 ListDependencies

1. Let *root* be `? DetermineRoot(cwd, --root)`.
2. Let (*config*, *attached*, *present*) be `? ReadConfig(root)`, *universe* be
   `? ComputeUniverse(root, config)`, and (*declarations*, *attached*, *marked*) be the Declarations
   and attached Diagnostics of steps 3 to 5 of §12.2.
3. Let *results* be `Evaluate(b, universe, « », attached of b)` for each Declaration *b* of
   *declarations*, in path order, except that no dependency is read or hashed (§10.4 is
   skipped), so a Result is never `invalid` for `E_UNREADABLE`.
4. Let *selected* be `? SelectResults(args, cwd, root, results)`.
5. Output *selected* (§14).
6. Exit 2 if any of *selected* is `invalid`; else 0.

If a step raises, output the raised Diagnostics as global and exit 2.

NOTE: `list-dependencies` reads neither `docstamp-lock.yaml` nor `docsync.lock`, so it does not
evaluate staleness, raises no `E_LOCK` or `E_LOCK_VERSION`, and emits no `W_ORPHAN`. It works before
the first `update` and while a legacy `docsync.lock` is still present.

### 13.8 ListDependents

The reverse query of §13.7: the arguments are any files, not only stamped files, and the answer is the
dependents of each: the stamped files that depend on it. At least one file argument is required (§13.2).

1. Let *root* be `? DetermineRoot(cwd, --root)`.
2. Let (*config*, *attached*, *present*) be `? ReadConfig(root)`, *universe* be
   `? ComputeUniverse(root, config)`, and (*declarations*, *attached*, *marked*) be the Declarations
   and attached Diagnostics of steps 3 to 5 of §12.2.
3. If `ToRepoPath(arg, cwd, root)` fails for any file argument *arg*, raise « `E_USAGE` with
   `[[Subject]]` *arg* » for each such *arg*; no entry is output. Its `[[Message]]` says how *arg*
   was resolved: against the current directory *cwd*, to which absolute path (step 2 of §13.4),
   and that this is outside *root*. A *path* need not exist.
4. Let *entries* be an empty List. For each distinct *arg* of the file arguments, in path order of
   its *path*:
   1. Let *path* be `ToRepoPath(arg, cwd, root)`.
   2. Let *found* be an empty List. For each Declaration *b* of *declarations* in path order
      whose file has no Diagnostic in *attached*: if *path* is in *universe*, *path* is not
      `b.[[File]]` and `Select(b.[[Dependencies]], « path »)` selects it, append { `[[File]]`:
      `b.[[File]]`, `[[Via]]`: the patterns of `b.[[Dependencies]]` that have no Negation and
      satisfy `PatternMatches(pattern, path)`, in declaration order } to *found*.
   3. If `--transitive` is given, let *found* be `DependentTree(path)` (below).
   4. Let *diagnostics* be « `W_UNKNOWN_PATH` », `[[Subject]]` *path*, with no `[[File]]`, if
      *path* is not in *universe* and is not an *existing entry*; else « ». An *existing entry* is
      an entry of any kind (§7.1, not followed) at *path* under *root*, whose name in the listing of
      its parent directory, after §7.4, equals the last segment of *path*, as §9.4 requires.
   5. Add the entry { `[[File]]`: *path*, `[[Dependents]]`: *found*, `[[Diagnostics]]`:
      *diagnostics* }.
5. Output *entries* and *attached* (§14).
6. Exit 2 if *attached* holds an error; else 0.

If a step raises, output the raised Diagnostics as global and exit 2.

`DependentTree(path)` is the List of the *nodes* below *path*, a node being { `[[File]]`, `[[Via]]`,
`[[Dependents]]`: a List of nodes, `[[Cycle]]`: Boolean, `[[Repeated]]`: Boolean }. Let *expanded* be
an empty Set, local to one call, and `Below(p, chain)` the List built from the direct dependents
of step 4.2 for *p*, *found(p)*, as follows; the result is `Below(path, « path »)`:

1. For each element *d* of *found(p)*, in order, add the node { `[[File]]` `d.[[File]]`, `[[Via]]`
   `d.[[Via]]` } with:
   1. if `d.[[File]]` is in *chain*: `[[Cycle]]` true, `[[Repeated]]` false, `[[Dependents]]` « »;
   2. otherwise, if `d.[[File]]` is in *expanded*: `[[Cycle]]` false, `[[Repeated]]` true,
      `[[Dependents]]` « »;
   3. otherwise: add `d.[[File]]` to *expanded*, `[[Cycle]]` and `[[Repeated]]` false, and
      `[[Dependents]]` `Below(d.[[File]], chain + « d.[[File]] »)`.

NOTE: Without `--transitive` only direct dependency is reported, so C that depends on B that
depends on code is not a dependent of the code; with it, C is listed below B. The Lockfile is not read (§13.7 NOTE), so
there is no `stale` information and the exit code is never 1. A file whose pattern is invalid
cannot be matched: it is skipped and its `E_PATTERN` is output; the same holds for any file with
an attached Diagnostic, such as an inline file with an `E_BLOCK` or a `use` that raises `E_UNKNOWN_PRESET`. For a file that uses
Presets, `[[Dependencies]]` here means its effective patterns (§8.6), so `[[Via]]` may name a pattern
that comes from a Preset. A file that is not in the Universe
(ignored, absent, or the Lockfile) has no dependents. A stamped file may itself be an argument.

NOTE: `W_UNKNOWN_PATH` makes a typo visible without breaking a script: the entry is still output
with no dependents and the exit code stays 0 (§16). A path that exists but is ignored, a directory,
or the Lockfile is not unknown: it has no dependents and no warning. The arguments are still
resolved against the current directory (§13.4), not against `--root`.

NOTE: `--transitive` only reports the chains: it changes no verdict, Hash or exit code, and a
change in a file still makes only its direct dependents `stale` (§12.2 NOTE); the chains show which
files become stale in later rounds, one Review at a time. A *cycle* is a node whose file is on its
own chain, the argument included: it is listed once, marked, and not followed. A file reached again
by another chain that is not a cycle (*repeated*) is listed, marked, and not followed again, so the
output is finite and its size at most the number of stamped files per argument. The order is the
path order of §13.8 step 4.2 at each level, depth first, so it is deterministic. There is no depth
option.

### 13.9 Stats

Reports how often the dependencies of each file would have made it stale over the recent history,
so that a list can be judged before it is committed to. The window is `--since <n>d`, the last *n*
days, or `--from <rev>`, the commits of `<rev>..HEAD`; without either it is `--since 30d`. The
command only reports: it exits 0 whatever the numbers are. Nothing is written and no Lockfile is
read.

1. Let *root* be `? DetermineRoot(cwd, --root)`.
2. Let *results* be the Results of steps 2 and 3 of §13.7, and *selected* be
   `? SelectResults(args, cwd, root, results)`.
3. If any of *selected* is `invalid`, raise their Diagnostics, so that the history is not read.
   Otherwise the warnings of *selected* (§8.5) are kept with their file.
4. Let *window* be `? Replay(root, w, now)` (§12.4), where *w* is `from R` for `--from R`, else
   `days N` for `--since Nd` or for the default 30, and *now* is the wall-clock time.
5. Let *stats* be `Statistics(selected, window)` (§12.5).
6. Output *stats*, the Window's size, its *kind* and *untouched* (§14), and exit 0.

If a step raises, output the raised Diagnostics as global and exit 2.

NOTE: `[[Patterns]]` (§12.5) counts the effective patterns of the file (§8.6): the Presets it uses
are counted pattern by pattern.

NOTE: `stats` resolves dependencies as §13.7 does, so it reports the same warnings, such as
`W_EMPTY_EXCLUSION`, on the same files: in text mode on standard error as §14.3 does, in `--json` as
the `diagnostics` of the file. Warnings never change the exit code.

NOTE: There is deliberately no option that turns the numbers into an exit code; a gate is future
work. `stats` shows how the lists of today would have behaved and never changes the verdict of
`check`. The caveat of §12.5 applies: the dependencies are those of `HEAD`. A file named `stats` is
reached as `docstamp -- stats` (§13.2).

### 13.10 Suggest

Proposes the `dependencies` of each named file from the paths it mentions (§12.6), with the files
each pattern selects and how often it would have made the file stale over the last 30 days. With
`--write` it records the proposal as an inline block without a `hash`, so the file stays
`unrecorded` until a person reviews it and runs `update` (§13.6). The command never stamps, never
reads or writes the Lockfile, and without `--write` writes nothing. It exits 0 whatever it finds.

1. Let *root* be `? DetermineRoot(cwd, --root)`, *config* be the Config of `? ReadConfig(root)`
   (§9.3; a Root with no Configuration file and no inline block is not an error here) and *universe*
   be `? ComputeUniverse(root, config)`.
2. For each distinct file argument *arg*, in path order of its *path*: if `ToRepoPath(arg, cwd, root)`
   (§13.4) fails, raise « `E_USAGE` with `[[Subject]]` *arg* », for each such *arg*, its
   `[[Message]]` as in §13.8 step 3. Otherwise, if *path*
   is not an entry of kind *file*, or has no text (§9.6.1), raise « `E_UNREADABLE` » with
   `[[Subject]]` *path*, for each such *path*.
3. If `--write` is given, then for each *path*, raise « `E_USAGE` with `[[Subject]]` *path* » when
   *path* has a configured Declaration (`[[Declarations]]` of *config*), or is not a candidate
   (§9.6.1): a block in such a file would never be read. The message tells the user to edit the
   configuration by hand, or to name a file that `include` selects.
4. Let (*suggestions*, *ignored*) be `Propose(path, text, universe, isIgnored)` (§12.6) for each *path*.
5. Let *window* be `Replay(root, days 30, now)` (§12.4), *now* being the wall-clock time; if it
   raises, or the Window has no Commit, let *window* be *none*: no Diagnostic is output for it.
6. For each Suggestion of each file whose pattern has no Negation, let its *staleRate* be the
   `[[StaleRate]]` that `Statistics` (§12.5) gives it for the Result with `[[Resolved]]` its
   `[[Files]]`, or *none* if *window* is *none*. The *staleRate* of every other Suggestion is *none*.
7. If `--write` is given, let *new* be, for each *path* whose *suggestions* is not empty,
   `? WriteBlock(text, patterns)` (§9.6.5), *patterns* being the patterns of *suggestions* in order.
   Only if no step has raised, replace each *path* whose *new* differs from its text atomically, as
   §9.6.4 step 3 does; it is then *written*, and every other file is not.
8. Output the Suggestions, *ignored* and, with `--write`, which files were *written* (§14.9, §14.5),
   and exit 0.

If a step raises, output the raised Diagnostics as global and exit 2; with `--write` nothing was
written then, except that a failure to replace a file (`E_UNREADABLE`) in step 7 leaves the files
replaced before it replaced.

NOTE: A block that records a `hash` is never overwritten by this command, nor is a configured
Declaration: both are the result of a decision, and the message says to edit them by hand. A block
without a `hash` is replaced, so `suggest --write` twice gives the same bytes (§12.6 step 1 never
reads the block). A file with no Suggestion is not written: a block needs a dependency. The
`staleRate` follows §12.5 with the caveat of its NOTE: dependencies are the ones of `HEAD`, and a
proposal that names a file the window deleted cannot see it. A file literally named `suggest` is
reached as `docstamp -- suggest` (§13.2).

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
  changed   1 modified, 1 added, 5 deleted
  modified  <path>
  added     <path>
  deleted   <dir>  (5 files)
```

- The first line is `STALE` or `INVALID`, padded with spaces to 9 characters, then the
  file; for `stale`, two spaces and the Reasons in parentheses, separated by `, `.
- For `stale` with a known `[[Changes]]`, instead of the `depends` lines:
  - if `[[Edited]]` is not none, the *edited line*: `  edited    `, `[[Edited]]` as in §14.2, and
    `  (dependency list)`;
  - if `[[Changes]]` has at least 5 Changes, the *summary line*: `  changed   ` and, for each status
    in the order `modified`, `added`, `deleted`, `renamed` that at least one entry of §14.3.1 has,
    `<n> <status>` with *n* the number of entries of that status, separated by `, `;
  - the *change lines* of §14.3.1. Each is two spaces, the status padded with spaces to 8
    characters, two spaces, and the path as in §14.2 (`  modified  <path>`, `  added     <path>`,
    `  deleted   <path>`, `  renamed   <from> -> <to>`), or a group line.
- For any other `stale`: one `depends` line per pattern, in declaration order.

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

omitting the bracketed parts when empty. §14.3.2 says when each is written.

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

and then, if any selected Result is `invalid`, the line

```
next: fix the configuration of each invalid file, then run: docstamp check <file> <file>
```

Each lists the files of its state in path order, each written as in §14.2 as a file argument that
§13.4 resolves, from the current directory, to that file: its RepoPath when the current directory
is Root, else the relative path from the current directory to Root, `/`, and its RepoPath, with
`/` as the separator on every platform (`../repo/docs/a.md`). When no relative path exists, as for
another drive on Windows, the RepoPath is written. The list is followed by ` --root ` and the
`--root` value as given, if one was given. At most 10 files are listed. When there are
more, the line lists the first 10 and is followed by the line `  and <m> more`, two spaces, with
*m* the number of files not listed. There is no `next:` line for a state that no selected Result
has, and none when §13.6 step 5 refused an update (§14.4).

NOTE: The second line points at the Diagnostics that §14.3.2 writes under each `INVALID` line.
Updating the first 10 stale files and running `docstamp` again lists the next 10.

#### 14.3.4 Review Line

For a stale Result with a known `[[Changes]]` that is not empty, or with an `[[Edited]]` that is
not none, the block ends with one line:

```
  review: git diff <C> -- <arg> <arg>
```

two spaces, `review: `, and a read-only git command that shows what changed: *C* is `[[Base]]`
as git printed it, and each *arg* is written with `ShellQuote`. If `--root` was given, `git diff`
is `git -C <root> diff`, *root* the value as given, written with `ShellQuote`. The *args* are:

- if the Result has at most 10 Changes (the *path cap*): the `[[Path]]` of each Change in path
  order, written as `:(literal)<path>` when it starts with `:` or contains `*`, `?`, `[` or `\`,
  so that git does not read it as a pattern;
- otherwise, for each pattern of `[[Dependencies]]` in declaration order, with *glob* the pattern
  without its Negation: `:(glob)<glob>` and, if *glob* contains `*`, `?` or `[` and its last
  segment is not `**`, also `:(glob)<glob>/**` (git reads a name as a directory, but not a
  wildcard); for a pattern with a Negation, `:(exclude,glob)` in place of `:(glob)`. If any
  pattern contains `{`, the line is not output.

When `[[Edited]]` is not none and no Change has its path, that path follows the other *args*,
written as a Change's path is in the first form; it does not count toward the path cap.

`ShellQuote(s)` is *s* if it is not empty and each of its code points is one of `A-Z`, `a-z`,
`0-9` and `_@%+=:,./-`; otherwise `'`, *s* with each `'` replaced by `'\''`, then `'`.

NOTE: The command compares the work tree with *C*, as §12.3 step 2 does, so the edits that are not
committed are in it; `<C>..HEAD` would leave them out. Git pathspecs are not patterns (§8): git lets
an exclusion win over every selection where the last matching pattern wins (§8.4), git has no
alternation (hence no line), and a file that git tracks but an ignore rule removed from the
Universe (§7.2) is in the diff. The second form may therefore list more files than the report. A
file that git does not track (an `added` Change from `git ls-files --others`, §12.3 step 2) is not
in the diff until `git add -N` names it.

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
  in path order, and `[]` for an `invalid` Result. Only an entry whose file has a non-empty
  `[[Use]]` has the members `use` (its `[[Use]]`) and `origins` (its `[[Origins]]`: one element per
  element of `dependencies`, `null` for none) between `dependencies` and `resolvedFiles`; any other
  entry is as it was before Presets. In every other mode `dependencies` is likewise the effective
  patterns, and `use` and `origins` are not output.
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
- The `diagnostics` of a file holds its errors when it is `invalid`, and its warnings (§8.5) in
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
          { "pattern": "src/cli", "resolvedCount": 12, "staleRate": 0.1234 },
          { "pattern": "!src/cli/**/*.test.*", "resolvedCount": 3, "staleRate": null }
        ],
        "ignored": ["dist/index.js"],
        "diagnostics": []
      }
    ],
    "diagnostics": []
  }
  ```

  It has no `summary`, `state`, `reasons` or `changes`. `files` holds each named file in path order,
  with `suggestions` the Suggestions of §12.6 in their order: `pattern`, `resolvedCount` the number
  of `[[Files]]`, and `staleRate` the Number of §13.10 step 6 (as `stats` writes `staleRate`, §14.5
  above) or `null`. `ignored` is the List of §12.6, `[]` when there is none. With `--write` each
  element adds `"written": true|false` after `diagnostics`. The `diagnostics` of a file are always
  `[]`, kept for the shape of the other modes; the top-level `diagnostics` hold the raised
  Diagnostics, in which case `files` is empty.
- A Diagnostic is `{ "code", "severity", "file", "subject", "message" }`, with `null` for an
  empty `[[File]]` or `[[Subject]]`. Diagnostic Lists are in Diagnostic order.
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
the name written as in §14.2. An `invalid` Result prints its first line only. There is no
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

With `--transitive` the rows form a tree, depth first (§13.8): the dependents of a dependent follow
its row, as a group of rows indented by two more spaces per level, each group padded to the width of
its own longest dependent. The row of a cycle ends with a space and `(cycle)`, the row of a repeated
node with a space and `(listed above)`; neither has rows below it:

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
for `--since` and `in <rev>..HEAD` for `--from`, with *rev* as given and written as in §14.2. When
the command raised or a file was `invalid`, nothing is output on standard output. Diagnostics as in
§14.3.

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
in path order. With `--write`, after all blocks, one line `written  <file>` or `unchanged  <file>`
per file in path order. Diagnostics as in §14.3, and nothing is output on standard output when the
command raised.

## 15 Diagnostics

| Code | Severity | Raised by | Fix named by the message |
|---|---|---|---|
| `E_USAGE` | error | §13.2, §13.8, §13.10, §9.6.5 | correct the command line; for a removed option, use the command it names; for a file argument outside Root, name a path that resolves, against the current directory, inside Root |
| `E_ROOT` | error | §6 | pass an existing directory |
| `E_CONFIG_MISSING` | error | §6, §9.3, §12.2 | create a Configuration file (§9.1), or add a `docstamp` block to the frontmatter of a Markdown file (§5.6) |
| `E_CONFIG_AMBIGUOUS` | error | §9.3 | keep one configuration file |
| `E_CONFIG` | error | §9.2, §9.3, §9.5 | fix the named key (`presets.<name>` for a Preset, `use` for a file); for a module without a default export, `export default` the value |
| `E_CONFIG_VERSION` | error | §9.3 | rename `dependents` to `files` and `covers` to `dependencies`, set `version: 2` |
| `E_UNKNOWN_KEY` | error | §9.3, §9.6.2 | remove or correct the key; for `dependents` rename it to `files`, for `covers` rename it to `dependencies`; attached to the file when it is a key of an inline block |
| `E_PATTERN` | error | §9.3, §9.6.2 | correct the pattern (§8.1); for an empty pattern, write a path or glob or remove it; for a lone `!`, write the path to exclude after it or remove it |
| `E_UNKNOWN_PRESET` | error | §8.6 | define the Preset under `presets` in the Configuration file, or correct the name in `use`; subject the name, attached to the file |
| `E_BLOCK` | error | §9.6.2 | write the `docstamp` block as a block mapping with `dependencies` and, optionally, `hash: <64 hex>` on one line; the subject names the part: `docstamp`, `frontmatter`, `dependencies`, `use` or `hash` |
| `E_DUPLICATE_DECLARATION` | error | §12.2 | declare the file once: remove the entry under `files` or the `docstamp` block |
| `E_FILE_MISSING` | error | §12.1 | rename the key or restore the file |
| `E_EMPTY_PATTERN` | error | §8.5 | correct or remove the pattern; it has no Negation; when it names an existing but ignored path, depend on its source or remove the ignore rule; when it holds `\` followed by a letter, use `/` as the separator (`\` escapes the next character) |
| `E_EMPTY_DEPENDENCIES` | error | §8.5 | correct the patterns in `dependencies` |
| `E_UNREADABLE` | error | §7.2, §9.6.3, §9.6.4, §10.2, §11.3, §13.10 | fix permissions, or make the Root writable |
| `E_PATH_ENCODING` | error | §7.2 | rename the file to valid UTF-8 |
| `E_PATH_COLLISION` | error | §7.4, §7.5 | rename one of the files |
| `E_LOCK` | error | §9.2, §11.1 | resolve the conflict, or `docstamp update --all` after reviewing every file |
| `E_LOCK_VERSION` | error | §11.1 | for `docsync.lock`, delete it, review every file, then `docstamp update --all`; for a version 2 Lockfile, `docstamp update --all` rewrites it as version 3 (hashes are unchanged); otherwise as `E_LOCK` |
| `E_UNKNOWN_FILE` | error | §13.3 | name a file listed under `files` in the Configuration file, or one with a `docstamp` block; for a file argument outside Root, name a path that resolves, against the current directory, inside Root |
| `E_HISTORY` | error | §12.4 | run in a git work tree with its full history; for `--from`, name a commit |
| `W_ORPHAN` | warning | §12.2 | run `docstamp update` on any file to remove it |
| `W_EMPTY_EXCLUSION` | warning | §8.5 | correct or remove the exclusion, or keep it: it matches no file of the Universe and changes nothing; attached to the file, subject the pattern |
| `W_DUPLICATE_PATTERN` | warning | §8.5 | keep one copy of the repeated pattern, unless the order of the patterns needs both (§8.4); attached to the file, subject the pattern, once per distinct repeated pattern |
| `W_UNKNOWN_PATH` | warning | §13.8 | check the spelling: the path is not in the Universe and not on disk, so nothing depends on it; subject the path as a RepoPath, carried by the entry of that path |

## 16 Exit Codes

| Code | Meaning |
|---|---|
| 0 | check: every selected file is `ok`; update: the Lockfile was written or already current; list-dependencies, list-dependents: the answer was listed; stats: the statistics were listed; suggest: the proposal was listed, even when it is empty; help, version |
| 1 | check only: a selected file is `stale`, none is `invalid`, no global error |
| 2 | an error Diagnostic, an `invalid` file, or a usage error |
| 70 | an uncaught internal fault of the runtime, reported on standard error as `internal error: ` and the stack; for example a failed write to standard output. No input produces it: every failure caused by the command line, the Root or the file system is a Diagnostic and exit 2 |

Warnings never affect the exit code.

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
| Hash inputs | the hash algorithm (§10.3); the normalization of content (§10.1, §10.2), including CR LF handling, a byte order mark, the binary sniff, the link rule and the `file`/`link` tags; anything that feeds the Dependency Hash, or its byte layout (§10.4); the order of its entries (§3.3) |
| Selection | the pattern dialect or its parsing (§8.1); pattern matching, negation order or directory semantics (§8.2 to §8.5); the Universe: which entries it holds, ignore rules, `.gitignore` handling, the excluded names, path normalization and collisions (§7); symbolic link handling (§7.1) |
| Formats | the `version` of the Configuration file (§9.3) or the Lockfile (§11.1); a key name of either; the accepted Configuration file names and their precedence (§9.1); the canonical form of the Lockfile (§11.2) |
| Verdicts | what is `stale` or `ok`; the Reasons (§5.4); any Diagnostic that turns a run from passing to failing or the reverse, including a warning that becomes an error and an error that becomes a warning (§15, §16) |
| Contract | an exit code or its meaning (§16); the name, severity or meaning of a Diagnostic code (§15); a member of the JSON output removed, renamed or given another meaning, or the JSON output `version` (§14.5); a command name, an option name, or the meaning of an argument (§13) |
| Platform | the minimum Node.js version (the `engines` field of the package); how a script Carrier is loaded or what it may export (§9.5) |

NOTE: An exclusion that matches nothing was `E_EMPTY_PATTERN` and is `W_EMPTY_EXCLUSION` (§8.5): an
error that becomes a warning, so a *Verdicts* change and breaking. A file that was `invalid` for
this reason alone becomes `ok` or `stale`, and exit code 2 becomes 0 or 1; nothing needs to
migrate. No Hash input and no selection changes (§8.4 is unchanged), so the Lockfile `version`, the
Dependency Hashes and the pinned vectors of §17.7 stay as they are.

NOTE: An unknown key in an inline block was reported as `E_UNKNOWN_KEY` and, when it stood in for
`dependencies`, also as `E_BLOCK` (§9.6.2); it is now `E_UNKNOWN_KEY` alone. The file is `invalid`
and the exit code is 2 before and after, so no verdict changes, but the set of Diagnostic codes of
that run does (§17.1, fourth item; *Contract*: the meaning of `E_BLOCK`), so it is breaking. The
migration is to read `E_UNKNOWN_KEY` where a consumer looked for `E_BLOCK` with subject
`dependencies` on a file that also had an unknown key. No Hash input, selection or Lockfile
`version` changes.

### 17.3 Non-breaking changes

The following are not breaking:

- the wording of a Diagnostic `[[Message]]` (§5.5), which is informative; a test MAY snapshot it,
  and then the snapshot is updated with the change;
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
- the warnings `W_DUPLICATE_PATTERN` (§8.5) and `W_UNKNOWN_PATH` (§13.8): new, warning severity,
  no change to a verdict, a Hash, a selection or an exit code; `list-dependents` still exits 0
  for a path it does not know;
- the `[[Message]]` of the `E_USAGE` of §13.8 step 3 now names the directory and Root it was
  resolved against; the code, the exit code and the resolution of §13.4 are unchanged; so does
  the `[[Message]]` of the `E_UNKNOWN_FILE` of §13.3 and of the `E_USAGE` of §13.10 for an argument
  that does not resolve inside Root, with the same code and exit code;
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
the Hash is unchanged between two versions, as between versions 2 and 3, the message says so and
`docstamp update --all` migrates.

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

### 17.7 Pinned vectors

The test suite of an implementation MUST pin, as literals computed once from a release:

- the file Hashes and the Dependency Hashes (§10) of a fixed tree that covers plain text, CR LF
  against LF, a byte order mark, binary bytes, an empty file, a symbolic link, a deleted
  dependency, a directory dependency of several files, a glob with a negation, and the order of
  entries;
- the selected dependencies (§8.4) of a fixed tree and pattern list, with ignore rules and
  `.gitignore` files in effect (§7);
- the file Hashes (§10.2 step 4) of a fixed tree of inline files: one with and one without a `hash`
  line (the same Hash), one whose `dependencies` differ (another Hash), one in CR LF, one with a
  byte order mark and one in `include` and one outside it, and a file with no block, whose Hash
  is the one of §10.3.

A change that makes a vector fail is breaking (§17.2). The vector is updated only together with a
new Lockfile `version` (§17.4) and its migration note (§17.6).
