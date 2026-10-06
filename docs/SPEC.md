# docsync Specification

Version 1 (draft). This document defines the observable behavior of docsync. It does not define
implementation structure. Code and tests cite its clause numbers (for example `§8.3`).

## 1 Scope

docsync tracks hidden dependencies between files: a file (the *Dependent*) whose correctness
rests on the content of other files (its *covered files*). The primary case is documentation that
describes code, but any file may be a Dependent and any file in the Universe may be covered: a
fixture and the schema it mirrors, generated types and their source, a translation and its
original.

The workflow it serves:

1. CI runs `docsync`. It exits 1 when a Dependent's covered files changed since its last Review.
2. A person or an agent reviews each stale Dependent against its covered files and edits it if
   needed.
3. They run `docsync --write <file>` to record the Review in the Lockfile. CI passes.

This specification defines how a Root is determined (§6), the Universe (§7), patterns (§8), the
Configuration file (§9), hashing (§10), the Lockfile (§11), evaluation (§12), the command line
(§13), output (§14), diagnostics (§15) and exit codes (§16).

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
  Unicode version of the implementation's runtime.

A conforming implementation MUST NOT perform network access and MUST NOT invoke a version-control
program.

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

**Binding**: the declaration in the Configuration file that a Dependent rests on the files its
patterns select.

**Dependent**: a file that has a Binding.

**Covered file**: a file selected by a Dependent's Binding (§8.5).

**Review**: the act, outside docsync, of checking a Dependent against its covered files.

**Write**: recording a Dependent's current Cover Hash in the Lockfile with `docsync --write`,
asserting that a Review happened.

**Configuration file**: the file `docsync.yaml` at Root. Written by people.

**Lockfile**: the file `docsync.lock` at Root. Written only by `docsync --write`.

## 5 Records

### 5.1 Binding

| Field | Type | Meaning |
|---|---|---|
| `[[Dependent]]` | RepoPath | |
| `[[Covers]]` | List of String | the patterns, verbatim, in declaration order |

### 5.2 Config

| Field | Type | Default |
|---|---|---|
| `[[Ignore]]` | List of String (ignore rule lines, §7.3) | « » |
| `[[UseGitignore]]` | Boolean | true |
| `[[Bindings]]` | List of Binding, in path order of `[[Dependent]]` | (required) |

### 5.3 Lock

| Field | Type |
|---|---|
| `[[Entries]]` | Map from RepoPath (a Dependent) to LockEntry |

A *LockEntry* is { `[[Covers]]`: List of String, `[[Hash]]`: Hash }: the Binding's `[[Covers]]`
and its Cover Hash (§10.4) at the last Write.

### 5.4 Result

| Field | Type | Meaning |
|---|---|---|
| `[[Dependent]]` | RepoPath | |
| `[[Covers]]` | List of String | the Binding's `[[Covers]]` |
| `[[State]]` | `ok`, `stale` or `invalid` | §12.1 |
| `[[Reasons]]` | List of Reason | non-empty iff `[[State]]` is `stale` |
| `[[Covered]]` | List of RepoPath, path order | empty iff `[[State]]` is `invalid` |
| `[[Current]]` | Hash or empty | empty iff `[[State]]` is `invalid` |
| `[[Diagnostics]]` | List of Diagnostic, §5.5 order | non-empty iff `[[State]]` is `invalid` |

A *Reason* is `unrecorded`, `binding-changed` or `content-changed`. When several apply they are
listed in that order.

NOTE: A Result does not say which covered files changed. The Lockfile keeps one Hash per
Dependent, so a Binding over thousands of files costs one entry. §13.5 gives the reviewer's
recipe for finding the change.

### 5.5 Diagnostic

| Field | Type | Meaning |
|---|---|---|
| `[[Code]]` | String | a code of §15 |
| `[[Severity]]` | `error` or `warning` | fixed per code (§15) |
| `[[Dependent]]` | RepoPath or empty | the Dependent it concerns |
| `[[Subject]]` | String or empty | the pattern, path, key or argument it concerns |
| `[[Message]]` | String | informative; see below |

A Diagnostic with a non-empty `[[Dependent]]` is *attached* to that Dependent; any other is
*global*.

*Diagnostic order*: by `[[Dependent]]` in path order (empty first), then `[[Code]]` in path order,
then `[[Subject]]` in path order. Every List of Diagnostics that is output is in this order, with
duplicates (all fields equal) removed.

`[[Message]]` is one sentence naming the problem and its fix. It MUST NOT contain operating system
error text, parser error text, or absolute paths; it MAY contain an error code name such as
`EACCES`.

## 6 Root

`DetermineRoot(cwd, rootOption)`:

1. If *rootOption* is present:
   1. Let *dir* be *rootOption* resolved lexically against *cwd* (§13.4).
   2. If *dir* is not an existing directory, raise `E_ROOT`.
   3. Return *dir*.
2. Let *dir* be *cwd*.
3. Repeat:
   1. If *dir* contains an entry named `docsync.yaml`, return *dir*.
   2. If *dir* is the filesystem root, raise `E_CONFIG_MISSING`.
   3. Set *dir* to the parent of *dir*.

## 7 Universe

The *Universe* is the List, in path order, of RepoPaths of the files that may be covered.

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
      4. If `IsIgnored(q, kind of e, rules, config)` (§7.3), skip *e*.
      5. If *e* is a *directory*: if it contains an entry named `.git`, skip *e* (a nested
         repository); otherwise call `WalkDirectory(e, q)`.
      6. If *e* is a *file* or *link*, add *q* to the Universe.
   4. Remove the rules scoped to *p* from *rules* before returning.
3. Remove `docsync.yaml` and `docsync.lock` from the Universe.
4. Apply §7.4 and §7.5, collecting their Diagnostics.
5. If *errors* is not empty, raise it. Otherwise return the Universe in path order.

NOTE: Step 3 means a Write can never make any Dependent stale.

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

`ResolveCovers(binding, universe)`:

1. Let *problems* be an empty List.
2. Let *candidates* be *universe* without `binding.[[Dependent]]`.
3. For each *pattern* of `binding.[[Covers]]`: if no *path* of *candidates* satisfies
   `PatternMatches(pattern, path)`, collect `E_EMPTY_PATTERN` into *problems*, with
   `[[Subject]]` *pattern*.
4. Let *covered* be `Select(binding.[[Covers]], candidates)`.
5. If *covered* is empty, collect `E_EMPTY_COVERS` into *problems*.
6. If *problems* is not empty, raise *problems*. Otherwise return *covered*.

NOTE: A Dependent is never one of its own covered files (step 2), so editing a Dependent never
makes it stale. Every pattern, negated or not, must match something (Principle 6): a negation
that removes nothing is a stale or mistyped rule.

## 9 Configuration File

### 9.1 Example

```yaml
version: 1
dependents:
  CLAUDE.md:
    covers:
      - src/**
      - "!src/**/*.test.ts"
      - package.json
  tests/fixtures/user.json:
    covers:
      - schemas/user.schema.json
```

Patterns starting with `!` or `*` must be quoted in YAML.

### 9.2 YAML Profile

The Configuration file and the Lockfile are read as YAML 1.2 with the Core schema, restricted as
follows. A violation raises `E_CONFIG` (Configuration file) or `E_LOCK` (Lockfile).

- The file is UTF-8; a leading U+FEFF is ignored. It holds exactly one document.
- Anchors, aliases, tags, merge keys (`<<`) and complex keys are not allowed.
- Every mapping key is a plain or quoted scalar that resolves to a string. A plain scalar key
  such as `1`, `true` or `null` is an error, not a string.
- A mapping MUST NOT contain the same key twice.

### 9.3 Reading

`ReadConfig(root)` returns a Config and a List of attached Diagnostics, or raises:

1. Let *fatal* be an empty List. Let *attached* be an empty List.
2. If `docsync.yaml` is not an entry of kind *file* at Root, raise « `E_CONFIG_MISSING` ».
3. Parse it under §9.2. On failure, or if the document is not a mapping, raise « `E_CONFIG` ».
4. If the key `version` is absent, or its value is not the plain scalar `1`, raise
   « `E_CONFIG_VERSION` ».
5. For each key of the document other than `version`, `gitignore`, `ignore` and `dependents`,
   collect `E_UNKNOWN_KEY` into *fatal*, `[[Subject]]` the key.
6. If `gitignore` is present and not a boolean, or `ignore` is present and not a sequence of
   strings, collect `E_CONFIG` into *fatal*, `[[Subject]]` the key.
7. If `dependents` is absent, or not a mapping, collect `E_CONFIG` into *fatal*, `[[Subject]]`
   `dependents`.
8. Otherwise, for each (*key*, *value*) of `dependents`:
   1. If *key* is not a RepoPath, collect `E_CONFIG` into *fatal*, `[[Subject]]` *key*, and
      continue.
   2. If *value* is not a mapping, or has no key `covers`, or `covers` is not a non-empty sequence
      of strings, collect `E_CONFIG` into *fatal*, `[[Dependent]]` *key*, and continue.
   3. For each key of *value* other than `covers`, collect `E_UNKNOWN_KEY` into *fatal*,
      `[[Dependent]]` *key*, `[[Subject]]` that key.
   4. For each string *s* of `covers` that is not a valid Pattern (§8.1), collect `E_PATTERN` into
      *attached*, `[[Dependent]]` *key*, `[[Subject]]` *s*.
   5. Produce the Binding { `[[Dependent]]`: *key*, `[[Covers]]`: the strings of `covers` }.
9. If *fatal* is not empty, raise *fatal*.
10. Return the Config, with defaults (§5.2) for absent keys and the Bindings in path order, and
    *attached*.

NOTE: A bad pattern makes only its Dependent `invalid`; every other Dependent is still evaluated.
A structural error stops evaluation.

### 9.4 Dependent Files

A Dependent MUST be an entry of kind *file* whose name, in the listing of its parent directory,
is equal to the last segment of the Dependent's RepoPath after §7.4. A Dependent need not be in
the Universe; it may be an ignored file.

NOTE: The check uses the directory listing, not a lookup by path, so `claude.md` does not resolve
to `CLAUDE.md` on a case-insensitive file system. Renaming a Dependent without renaming its key
raises `E_DEPENDENT_MISSING`.

## 10 Hashing

### 10.1 Binary Content

A byte sequence is *binary* iff its first min(8192, length) bytes contain the byte 0x00.

### 10.2 Normalized Content

`NormalizedContent(path)`, for a RepoPath of the Universe:

1. If the entry is a *link*, return the bytes `link`, 0x00, and the UTF-8 encoding of its target
   String as stored, with every `\` replaced by `/`.
2. Read the file's bytes. If reading fails, raise « `E_UNREADABLE` » with `[[Subject]]` *path*.
3. If the bytes are binary, let *body* be the bytes. Otherwise let *body* be the bytes with every
   pair 0x0D 0x0A replaced by 0x0A.
4. Return the bytes `file`, 0x00, and *body*.

NOTE: Only CR LF pairs are normalized. A lone CR, a byte order mark, and UTF-16 text (binary by
§10.1) are hashed as they are. A link is never followed: its target string is hashed, so a link
to a file outside Root hashes the same on every host.

### 10.3 Hash

A *Hash* is the lowercase hexadecimal encoding of a SHA-256 digest: exactly 64 characters in
`[0-9a-f]`. `FileHash(path)` is the Hash of `? NormalizedContent(path)`.

### 10.4 Cover Hash

`CoverHash(covered)`, where *covered* is a List of RepoPaths in path order:

1. Let *problems* be an empty List and *input* the empty byte sequence.
2. For each *path* of *covered*: if `FileHash(path)` raises, add its Diagnostics to *problems*;
   otherwise append the UTF-8 encoding of *path*, the byte 0x00, the 64 ASCII bytes of the Hash,
   and the byte 0x0A.
3. If *problems* is not empty, raise *problems*. Otherwise return the Hash of *input*.

NOTE: The path is part of the input, so renaming or moving a covered file changes the Cover Hash
even when its content does not. An empty file contributes the Hash of the bytes `file`, 0x00.

NOTE: The result for files modified while docsync runs is undefined.

## 11 Lockfile

### 11.1 Reading

`ReadLock(root)` returns a Lock or raises:

1. If `docsync.lock` does not exist at Root, return a Lock with no entries.
2. Parse it under §9.2. On failure, or if the document is not a mapping, raise « `E_LOCK` ».
3. If the key `version` is absent, or its value is not the plain scalar `1`, raise
   « `E_LOCK_VERSION` ».
4. Raise « `E_LOCK` » unless all of these hold:
   1. The document's keys are exactly `version` and `dependents`.
   2. `dependents` is a mapping whose keys are RepoPaths.
   3. Each value has exactly the keys `covers`, a non-empty sequence of strings, and `hash`, a
      String of 64 characters in `[0-9a-f]`.
5. Return the Lock.

NOTE: Unresolved merge conflict markers fail step 2. The message for `E_LOCK` names the fix:
resolve the conflict by taking either side, then run `docsync`.

### 11.2 Canonical Form

`LockText(lock)` is this text, with LF line endings and a final LF:

```
version: 1
dependents:
  <Quote(dependent)>:
    covers:
      - <Quote(pattern)>
    hash: <hash>
```

- Keys always appear in this order: `version`, `dependents`; within an entry, `covers`, `hash`.
- One block per entry, in path order of the Dependent. With no entries, the second line is
  `dependents: {}`.
- `covers` lists the patterns in declaration order.
- Indentation is two spaces per level.

NOTE: Two branches that write the same Dependent conflict on its `hash` line, as two branches that
change one dependency conflict in a package-manager lockfile. Resolution: take either side, run
`docsync`, review what it reports stale, and write again.

### 11.3 Writing

`WriteLock(root, lock)`:

1. Let *text* be `LockText(lock)`.
2. If `docsync.lock` exists and its contents, with every 0x0D 0x0A replaced by 0x0A, equal the
   UTF-8 encoding of *text*, return without writing.
3. Replace `docsync.lock` atomically with the UTF-8 encoding of *text*: a concurrent reader sees
   either the old contents or the new.

NOTE: Step 2 tolerates a checkout that converted the Lockfile to CR LF. Repositories SHOULD
declare `docsync.lock text eol=lf` in `.gitattributes`.

## 12 Evaluation

### 12.1 Evaluate

`Evaluate(binding, universe, lock, attached)`, where *attached* is the List of Diagnostics from
§9.3 attached to `binding.[[Dependent]]`:

1. Let *r* be a Result with `[[Dependent]]` and `[[Covers]]` from *binding*, empty
   `[[Reasons]]`, `[[Covered]]` and `[[Diagnostics]]`, and empty `[[Current]]`.
2. Let *problems* be a copy of *attached*.
3. If `binding.[[Dependent]]` does not satisfy §9.4, collect `E_DEPENDENT_MISSING` into
   *problems*.
4. If *attached* is empty, let *covered* be `ResolveCovers(binding, universe)`; if it raises, add
   its Diagnostics to *problems*.
5. If *problems* is empty, let *current* be `CoverHash(covered)`; if it raises, add its
   Diagnostics to *problems*.
6. If *problems* is not empty, set *r*.`[[State]]` to `invalid` and *r*.`[[Diagnostics]]` to
   *problems*, each with `[[Dependent]]` set to `binding.[[Dependent]]`, and return *r*.
7. Set *r*.`[[Covered]]` to *covered* and *r*.`[[Current]]` to *current*.
8. Let *entry* be the LockEntry of `binding.[[Dependent]]` in *lock*, or *none*.
9. If *entry* is *none*, append `unrecorded`. Otherwise:
   1. If `entry.[[Covers]]` and `binding.[[Covers]]` are not equal element by element, append
      `binding-changed`.
   2. If `entry.[[Hash]]` is not equal to *current*, append `content-changed`.
10. Set *r*.`[[State]]` to `stale` if *r*.`[[Reasons]]` is non-empty, else `ok`. Return *r*.

NOTE: `content-changed` covers every change to the covered set: an edited file, a new file the
patterns select, a deleted file, a renamed or moved file.

### 12.2 EvaluateAll

`EvaluateAll(root, lockPolicy)` returns Results, the Lock, and a List of global Diagnostics, or
raises:

1. Let (*config*, *attached*) be `? ReadConfig(root)`.
2. Let *universe* be `? ComputeUniverse(root, config)`.
3. If *lockPolicy* is `discard-invalid` and `ReadLock(root)` raises, let *lock* be a Lock with no
   entries. Otherwise let *lock* be `? ReadLock(root)`.
4. Let *results* be `Evaluate(b, universe, lock, attached of b)` for each Binding *b* of
   `config.[[Bindings]]`, in path order.
5. Let *global* be a List holding, for each Dependent of *lock* with no Binding, a `W_ORPHAN` with
   `[[Subject]]` that Dependent.
6. Return *results*, *lock* and *global*.

NOTE: There is no propagation between Dependents. If C covers B and B covers code, a change in
the code makes B stale and leaves C ok. Writing B changes only the Lockfile, which is never in the
Universe (§7.2 step 3), so C stays ok. C becomes stale only when B's content changes.

## 13 Command Line

### 13.1 Synopsis

```
docsync [--files] [--json] [--root <dir>] [<file>...]
docsync --write [--json] [--root <dir>] (--all | <file>...)
docsync --version
docsync --help
```

Without `--write`, `--version` or `--help`, docsync *checks* (§13.5).

### 13.2 Parsing

The command line is parsed before anything else. The following raise « `E_USAGE` » with
`[[Subject]]` the offending argument, and exit 2:

- an unknown option, a missing value for `--root`, or an option given twice;
- `--version` or `--help` together with any other argument;
- `--files` together with `--write`; `--all` without `--write`;
- `--write` with neither `--all` nor a file argument, or with both.

`--root=<dir>` is equivalent to `--root <dir>`. After `--`, every argument is a file argument.
Options and file arguments may appear in any order.

`--version` prints the version and exits 0. `--help` prints usage and exits 0.

### 13.3 File Arguments

`SelectResults(args, cwd, root, results)` returns the selected Results and a List of global
Diagnostics:

1. If *args* is empty, return *results* and « ».
2. For each *arg*: let *path* be `ToRepoPath(arg, cwd, root)`. If that fails, or no Result has
   `[[Dependent]]` equal to *path*, collect `E_UNKNOWN_DEPENDENT` with `[[Subject]]` *arg*.
3. Return the Results whose `[[Dependent]]` was named, in path order without duplicates, and the
   collected Diagnostics.

### 13.4 Path Resolution

`ToRepoPath(arg, cwd, root)` is lexical: no symbolic link is resolved and no file system access
happens.

1. On Windows, replace every `\` in *arg* by `/`.
2. Join *arg* to *cwd* unless it is absolute, and remove `.` segments and resolve `..` segments
   textually.
3. If the result is not *root* followed by `/` and at least one segment, fail.
4. Return the remainder after *root* and `/`, converted to NFC. Fail if it is not a RepoPath.

No case folding is applied: the argument must equal the Dependent key.

### 13.5 Check

1. Let *root* be `? DetermineRoot(cwd, --root)`.
2. Let (*results*, *lock*, *global*) be `? EvaluateAll(root, strict)`.
3. Let (*selected*, *argErrors*) be `SelectResults(args, cwd, root, results)`. Append *argErrors*
   to *global*.
4. Output *selected* and *global* (§14).
5. Exit with:
   - 2 if *global* contains an error or any of *selected* is `invalid`;
   - else 1 if any of *selected* is `stale`;
   - else 0.

If a step raises, output the raised Diagnostics as global and exit 2.

NOTE: Reviewer's recipe for a stale Dependent. `docsync --files <file>` lists the covered files.
The reviewer compares them with the state at the last Write using its own tools, for example
`git diff <base> -- <files>`, where *base* is the commit the branch started from. docsync names
what to review; it does not compute the difference.

### 13.6 Write

1. Let *root* be `? DetermineRoot(cwd, --root)`.
2. Let *policy* be `discard-invalid` if `--all` is given, else `strict`.
3. Let (*results*, *lock*, *global*) be `? EvaluateAll(root, policy)`.
4. If `--all` is given, let *targets* be *results*. Otherwise let (*targets*, *argErrors*) be
   `SelectResults(args, cwd, root, results)` and append *argErrors* to *global*.
5. If *global* contains an error or any of *targets* is `invalid`: output *targets* and *global*
   as a check would (§14), write nothing, and exit 2.
6. For each *t* of *targets*, set the LockEntry of *t*.`[[Dependent]]` in *lock* to
   { `[[Covers]]`: *t*.`[[Covers]]`, `[[Hash]]`: *t*.`[[Current]]` }.
7. Let *removed* be the Dependents of *lock* that have no Binding, in path order. Remove their
   entries.
8. `WriteLock(root, lock)`.
9. Output the written Dependents and *removed* (§14). Exit 0.

If a step raises, output the raised Diagnostics as global and exit 2.

NOTE: A Write asserts that a Review happened; docsync cannot check that, and trusts its caller.
`--write` requires naming the files, or `--all` on purpose (first adoption, or recovery from an
unreadable Lockfile), so no file is marked reviewed by accident.

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

One block per selected Result that is not `ok`, in path order; with `--files`, one block per
selected Result.

```
STALE    <dependent>  (<reason>, <reason>)
  covers  <pattern>
  file    <covered file>
```

- The first line is `STALE`, `INVALID` or `OK`, padded with spaces to 9 characters, then the
  Dependent; for `stale`, two spaces and the Reasons in parentheses, separated by `, `.
- For `stale`: one `covers` line per pattern, in declaration order.
- With `--files`, for `stale` and `ok`: one `file` line per covered file, in path order.

Then one summary line:

```
<n> ok, <m> stale, <k> invalid
```

counting the selected Results. Then, if any selected Result is `stale`:

```
next: review each stale file against its covered files, then run: docsync --write <file> <file>
```

with the stale Dependents in path order, each written as in §14.2, followed by ` --root ` and
the `--root` value as given, if one was given.

Each Diagnostic, global and attached, in Diagnostic order, is written to standard error as:

```
<severity>: <code>[: <dependent>][: <subject>]: <message>
```

omitting the bracketed parts when empty.

### 14.4 Write, Text Mode

One line `written  <dependent>` per target, then one line `removed  <dependent>` per removed
entry, each group in path order. Diagnostics as in §14.3.

### 14.5 JSON Mode

The document is the output of ECMAScript `JSON.stringify(value, null, 2)` followed by LF, except
that every string is encoded with `Quote` (§3.4). Object members appear in the order listed here.

```json
{
  "version": 1,
  "mode": "check",
  "exitCode": 1,
  "summary": { "ok": 12, "stale": 1, "invalid": 0 },
  "dependents": [
    {
      "dependent": "CLAUDE.md",
      "state": "stale",
      "reasons": ["content-changed"],
      "covers": ["src/**", "!src/**/*.test.ts", "package.json"],
      "files": null,
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
```

- `mode` is `check` or `write`.
- `dependents` holds every selected Result (check) or every target (write), in path order,
  including `ok` ones.
- `files` is the List of covered files with `--files`, else `null`.
- With `--write`, each element of `dependents` adds `"written": true|false` after
  `diagnostics` (false only when step 5 of §13.6 refused), and the top level adds `"removed"`, a
  List of Dependents, after `diagnostics`.
- A Diagnostic is `{ "code", "severity", "dependent", "subject", "message" }`, with `null` for an
  empty `dependent` or `subject`. Diagnostic Lists are in Diagnostic order.
- When a step raises before Results exist, `summary` counts zeros and `dependents` is empty.
- Consumers MUST ignore unknown members. Within version 1, later revisions only add members.

## 15 Diagnostics

| Code | Severity | Raised by | Fix named by the message |
|---|---|---|---|
| `E_USAGE` | error | §13.2 | correct the command line |
| `E_ROOT` | error | §6 | pass an existing directory |
| `E_CONFIG_MISSING` | error | §6, §9.3 | create `docsync.yaml` (§9.1) |
| `E_CONFIG` | error | §9.2, §9.3 | fix the named key |
| `E_CONFIG_VERSION` | error | §9.3 | set `version: 1` |
| `E_UNKNOWN_KEY` | error | §9.3 | remove or correct the key |
| `E_PATTERN` | error | §9.3 | correct the pattern (§8.1) |
| `E_DEPENDENT_MISSING` | error | §12.1 | rename the key or restore the file |
| `E_EMPTY_PATTERN` | error | §8.5 | correct or remove the pattern |
| `E_EMPTY_COVERS` | error | §8.5 | correct the patterns |
| `E_UNREADABLE` | error | §7.2, §10.2 | fix permissions |
| `E_PATH_ENCODING` | error | §7.2 | rename the file to valid UTF-8 |
| `E_PATH_COLLISION` | error | §7.4, §7.5 | rename one of the files |
| `E_LOCK` | error | §9.2, §11.1 | resolve the conflict, or `docsync --write --all` after reviewing every Dependent |
| `E_LOCK_VERSION` | error | §11.1 | as `E_LOCK` |
| `E_UNKNOWN_DEPENDENT` | error | §13.3 | name a Dependent from `docsync.yaml` |
| `W_ORPHAN` | warning | §12.2 | run `docsync --write` on any Dependent to remove it |

## 16 Exit Codes

| Code | Meaning |
|---|---|
| 0 | check: every selected Dependent is `ok`; write: the Lockfile was written or already current |
| 1 | check only: a selected Dependent is `stale`, none is `invalid`, no global error |
| 2 | an error Diagnostic, an `invalid` Dependent, or a usage error |
| 70 | an unexpected internal failure, reported on standard error |

Warnings never affect the exit code.
