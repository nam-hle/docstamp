# docsync Specification

Version 1 (draft). This document defines the observable behavior of docsync. It does not define
implementation structure. Where code or tests refer to behavior, they cite clause numbers of this
document (for example `§8.3`).

## 1 Scope

docsync tracks hidden dependencies between files: a file (the *Dependent*) whose correctness
rests on the content of other files (its *covered files*). The primary case is documentation that
describes code, but any file may be a Dependent and any file in the Universe may be covered: a
fixture and the schema it mirrors, generated types and their source, a translation and its
original.

This specification defines:

- how a *Root* is determined (§6);
- the file universe docsync observes (§7);
- the pattern language used in Bindings (§8);
- the Configuration file, the single place Bindings are declared (§9);
- content hashing (§10);
- the Lockfile format (§11);
- the evaluation of a Dependent's state (§12);
- the command-line interface, its output, diagnostics and exit codes (§13 to §16).

## 2 Conformance

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in
RFC 2119.

A conforming implementation MUST produce, for the same Root contents and command line,
byte-identical standard output, byte-identical Lockfile contents, and the same exit code,
regardless of host operating system, locale, time zone, wall-clock time, environment variables
(other than those that determine the current working directory and §14.2 color), and
version-control history.

A conforming implementation MUST NOT perform network access and MUST NOT invoke a version-control
program.

## 3 Notational Conventions

### 3.1 Algorithm Conventions

Behavior is specified as algorithms of numbered steps. Steps are performed in order. Substeps are
indented and numbered within their parent step.

An *abstract operation* is a named algorithm, written `OperationName(arg1, arg2)`. It either
returns a value or *raises* a Diagnostic (§5.5).

The prefix `?` before an abstract operation call means: if the call raises, the calling algorithm
raises the same Diagnostic and performs no further steps.

To *collect* a Diagnostic means: append it to the current Diagnostic List and continue. Collected
Diagnostics are reported together; collecting never stops an algorithm.

### 3.2 Data Conventions

A *List* is an ordered sequence, written « a, b ». A *Map* is a set of key-value pairs with unique
keys; a Map is enumerated in path order (§3.3) of its keys.

A *Record* is an aggregate of named fields, written `[[FieldName]]`.

A *String* is a sequence of Unicode code points. Strings are compared by code point, exactly; no
normalization, case folding or trimming is applied unless a step says so.

### 3.3 Ordering

*Path order* is ascending lexicographic order of Strings compared by UTF-16 code unit. It is the
only ordering used by this specification. Locale-aware collation MUST NOT be used.

## 4 Terms

**Root**: the directory against which every RepoPath is resolved (§6).

**RepoPath**: a String naming a file relative to Root. A RepoPath uses `/` as separator, has no
leading `/`, no trailing `/`, no empty segment, and no segment equal to `.` or `..`.

**Binding**: the declaration that a Dependent rests on the files its patterns select.

**Dependent**: a file that has a Binding.

**Covered file**: a file selected by a Dependent's Binding (§8.4).

**Review**: the act, outside docsync, of checking a Dependent's content against its covered files.

**Stamp**: recording the current Cover Hash of a Dependent in the Lockfile, asserting that a
Review happened.

**Configuration file**: the file `docsync.yaml` at Root. Written by people.

**Lockfile**: the file `docsync.lock` at Root. Written only by `docsync stamp`.

## 5 Records

### 5.1 Binding Record

| Field | Type | Meaning |
|---|---|---|
| `[[Dependent]]` | RepoPath | the Dependent |
| `[[Covers]]` | List of String | the patterns, verbatim, in declaration order |

### 5.2 Config Record

| Field | Type | Default |
|---|---|---|
| `[[Ignore]]` | List of String (gitignore lines) | « » |
| `[[UseGitignore]]` | Boolean | true |
| `[[Bindings]]` | List of Binding, path order of `[[Dependent]]` | (required) |

### 5.3 Lock Record

| Field | Type |
|---|---|
| `[[Version]]` | the integer 1 |
| `[[Entries]]` | Map from RepoPath (Dependent) to LockEntry |

A *LockEntry* is a Record { `[[Covers]]`: List of String, `[[Hash]]`: Hash }, holding the
Binding's `[[Covers]]` and its Cover Hash (§10.4) at stamp time.

### 5.4 DependentResult Record

| Field | Type | Meaning |
|---|---|---|
| `[[Dependent]]` | RepoPath | |
| `[[Covers]]` | List of String | the Binding's `[[Covers]]` |
| `[[State]]` | `ok`, `stale` or `invalid` | §12 |
| `[[Reasons]]` | List of Reason | non-empty iff `[[State]]` is `stale` |
| `[[Current]]` | Hash or empty | the Cover Hash now; empty iff `[[State]]` is `invalid` |
| `[[Diagnostics]]` | List of Diagnostic | non-empty iff `[[State]]` is `invalid` |

A *Reason* is one of, and when several apply they are listed in this order: `unstamped`,
`binding-changed`, `content-changed`.

NOTE: A result does not list which covered files changed. The Lockfile keeps one Hash per
Dependent, so a Binding covering thousands of files costs one entry. The reviewer finds the change
with its own tools, scoped by `[[Covers]]`; `docsync ls` lists the covered files (§13.6).

### 5.5 Diagnostic Record

| Field | Type | Meaning |
|---|---|---|
| `[[Code]]` | String | one of the codes of §15 |
| `[[Severity]]` | `error` or `warning` | |
| `[[Dependent]]` | RepoPath or empty | the Dependent it concerns, if any |
| `[[Message]]` | String | one sentence naming what is wrong and the fix |

A Diagnostic with a non-empty `[[Dependent]]` is *attached* to that Dependent. Every other
Diagnostic is *global*.

## 6 Root

`DetermineRoot(cwd, rootOption)`:

1. If *rootOption* is present:
   1. Let *dir* be *rootOption* resolved against *cwd*.
   2. If *dir* is not an existing directory, raise `E_ROOT`.
   3. Return *dir*.
2. Let *dir* be *cwd*.
3. Repeat:
   1. If *dir* contains a file named `docsync.yaml`, return *dir*.
   2. If *dir* is the filesystem root, raise `E_CONFIG_MISSING`.
   3. Set *dir* to the parent of *dir*.

## 7 Universe

The *Universe* is the List, in path order, of RepoPaths of the files that may be covered.

`ComputeUniverse(root, config)`:

1. Let *ignore* be an empty rule set with the semantics of gitignore pattern lines.
2. Add the rule `.git/` to *ignore*.
3. If `config.[[UseGitignore]]` is true, then for every file named `.gitignore` in a directory
   *d* reached by step 5, add its lines to *ignore*, scoped to *d*, with the precedence gitignore
   defines for nested files.
4. Add every line of `config.[[Ignore]]` to *ignore*, scoped to Root, with precedence over step 3.
5. Walk Root. Do not descend into a directory that *ignore* matches. Do not follow a symbolic link
   to a directory.
6. Let *files* be every regular file, and every symbolic link not to a directory, that was reached
   and that *ignore* does not match.
7. Remove `docsync.yaml` and `docsync.lock` from *files*.
8. Return the RepoPaths of *files* in path order.

NOTE: A symbolic link whose target does not exist is kept by step 6; hashing it raises
`E_UNREADABLE` (§10.2). The contents of `.git` are never read.

NOTE: Step 7 means a Stamp can never make any Dependent stale.

## 8 Patterns

### 8.1 Syntax

```
Pattern     ::= Negation? Glob
Negation    ::= "!"
Glob        ::= Segment ( "/" Segment )*
Segment     ::= "**" | Part+
Part        ::= Literal | "*" | "?" | Class | Alternation
Class       ::= "[" "!"? ClassItem+ "]"
ClassItem   ::= ClassChar | ClassChar "-" ClassChar
Alternation ::= "{" Glob ( "," Glob )+ "}"
Literal     ::= any code point except * ? [ ] { } , / \  |  "\" any code point
ClassChar   ::= any code point except ] / \  |  "\" any code point
```

A Pattern is *invalid* if it is empty, is `!` alone, starts with `/` after the optional Negation,
ends with `/`, contains a segment `.` or `..`, or does not match the grammar.

### 8.2 Glob Matching

`GlobMatches(glob, path)` is true iff *path* is in the language of *glob*, where:

- a Literal matches itself; `\c` matches the code point *c*;
- `*` matches any sequence of zero or more code points not containing `/`;
- `?` matches exactly one code point other than `/`;
- a Class matches one code point other than `/` that is (or, with `!`, is not) listed or within a
  listed inclusive range;
- an Alternation matches what any one of its Globs matches;
- a Segment `**` matches zero or more whole segments;
- matching is case-sensitive and anchored at both ends; a leading `.` in a segment has no special
  meaning.

### 8.3 Pattern Matching

`PatternMatches(pattern, path)`:

1. Let *glob* be *pattern* without its Negation.
2. If `GlobMatches(glob, path)` is true, return true.
3. For each proper prefix *dir* of *path* that ends immediately before a `/`: if
   `GlobMatches(glob, dir)` is true, return true.
4. Return false.

NOTE: Step 3 gives directory semantics: `src/cli` selects every file under `src/cli/`, and so does
`src/*`, which matches the directory `src/cli`. This is how gitignore treats a pattern that
matches a directory.

### 8.4 Selection

`Select(patterns, candidates)`:

1. Let *result* be an empty List.
2. For each *path* of *candidates*, in path order:
   1. Let *selected* be false.
   2. For each *pattern* of *patterns*, in order: if `PatternMatches(pattern, path)` is true, set
      *selected* to true if *pattern* has no Negation, else to false.
   3. If *selected* is true, append *path* to *result*.
3. Return *result*.

NOTE: The last matching pattern wins, as in gitignore. A Negation only removes what an earlier
pattern selected.

`ResolveCovers(binding, universe)`:

1. Let *candidates* be *universe* without `binding.[[Dependent]]`.
2. For each *pattern* of `binding.[[Covers]]` without Negation: if no *path* of *candidates*
   satisfies `PatternMatches(pattern, path)`, collect `E_EMPTY_PATTERN` naming *pattern*.
3. If step 2 collected any Diagnostic, raise the last one collected.
4. Let *covered* be `Select(binding.[[Covers]], candidates)`.
5. If *covered* is empty, raise `E_EMPTY_COVERS`.
6. Return *covered*.

NOTE: A Dependent is never one of its own covered files (step 1), so editing a Dependent never
makes that Dependent stale. Pattern validity is checked when the Configuration file is read
(§9.2).

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

### 9.2 Reading

`ReadConfig(root)`:

1. Parse `docsync.yaml` as YAML 1.2. If parsing fails, or the result is not a mapping, or a
   mapping contains a duplicate key, raise `E_CONFIG`.
2. If `version` is absent or not the integer 1, raise `E_CONFIG_VERSION`.
3. Validate the document against §9.3, collecting every violation; then, if any was collected,
   raise the first.
4. For each (*dep*, *value*) of `dependents`: produce the Binding { `[[Dependent]]`: *dep*,
   `[[Covers]]`: the strings of `value.covers`, in order }.
5. Return the Config Record built from the document and the Bindings, with defaults (§5.2) for
   absent keys.

### 9.3 Schema

| Key | Type | Field |
|---|---|---|
| `version` | the integer 1 | (required) |
| `gitignore` | boolean | `[[UseGitignore]]` |
| `ignore` | sequence of strings | `[[Ignore]]` |
| `dependents` | mapping from RepoPath to a Dependent mapping | `[[Bindings]]` (required) |

A *Dependent mapping* has exactly one key, `covers`, whose value is a non-empty sequence of valid
Pattern strings (§8.1).

| Violation | Code |
|---|---|
| unknown key, at any level | `E_UNKNOWN_KEY` |
| value of the wrong type, missing `dependents` or `covers`, empty `covers` | `E_CONFIG` |
| a `dependents` key that is not a valid RepoPath | `E_CONFIG` |
| a `covers` string that is not a valid Pattern | `E_PATTERN`, attached to that Dependent |

### 9.4 Dependent Files

A Dependent MUST be a regular file, or a symbolic link to one, at its RepoPath under Root. If it is
not, `E_DEPENDENT_MISSING` is attached to it (§12.2). A Dependent need not be in the Universe; it
may be an ignored file.

NOTE: When a Dependent is renamed, its key in `dependents` must be renamed too. The old key then
raises `E_DEPENDENT_MISSING`, so a forgotten rename fails loudly.

## 10 Hashing

### 10.1 Binary Content

A byte sequence is *binary* iff its first min(8192, length) bytes contain the byte 0x00.

### 10.2 Normalized Content

`NormalizedContent(path)`:

1. Read the bytes of the file at *path*, following a symbolic link. If reading fails, raise
   `E_UNREADABLE`.
2. If the bytes are binary, return them.
3. Return the bytes with every pair 0x0D 0x0A replaced by 0x0A.

### 10.3 Hash

A *Hash* is the lowercase hexadecimal encoding of a SHA-256 digest: a String of exactly 64
characters in `[0-9a-f]`.

`FileHash(path)` is the Hash of `NormalizedContent(path)`.

### 10.4 Cover Hash

`CoverHash(covered)`, where *covered* is a List of RepoPaths in path order:

1. Let *input* be the empty byte sequence.
2. For each *path* of *covered*, append the UTF-8 encoding of *path*, the byte 0x00, the ASCII
   encoding of `? FileHash(path)`, and the byte 0x0A.
3. Return the Hash of *input*.

NOTE: The path is part of the input, so renaming or moving a covered file changes the Cover Hash
even when its content does not. A Dependent that names that path must be reviewed.

## 11 Lockfile

### 11.1 Reading

`ReadLock(root)`:

1. If `docsync.lock` does not exist, return { `[[Version]]`: 1, `[[Entries]]`: empty }.
2. Parse it as YAML 1.2. If parsing fails, raise `E_LOCK`.
3. If `version` is not the integer 1, raise `E_LOCK_VERSION`.
4. If the document does not have the shape of §11.2, including any unknown key, raise `E_LOCK`.
5. Return the Lock Record.

### 11.2 Canonical Form

`WriteLock(lock)` produces this text exactly, with LF line endings and a final LF:

```
version: 1
dependents:
  "<dependent>":
    covers:
      - "<pattern>"
    hash: <hash>
```

- One block follows `dependents:` per entry, in path order of the Dependent. If there are no
  entries, the line is `dependents: {}`.
- `covers` lists the patterns in declaration order.
- Indentation is two spaces per level.
- `<dependent>` and `<pattern>` are written as YAML double-quoted scalars, with the escapes
  ECMAScript `JSON.stringify` produces. `<hash>` is written plain.

Writing the Lockfile MUST be atomic: a reader observes either the previous contents or the new
contents. If the new text equals the existing contents byte for byte, the file MUST NOT be
written.

## 12 Evaluation

### 12.1 Evaluate

`Evaluate(binding, universe, lock, attached)`, where *attached* is the List of Diagnostics already
attached to `binding.[[Dependent]]`:

1. Let *r* be a DependentResult with `[[Dependent]]` and `[[Covers]]` from *binding*, and empty
   `[[Reasons]]`, `[[Current]]` and `[[Diagnostics]]`.
2. Let *problems* be a copy of *attached*.
3. If `binding.[[Dependent]]` is not a file under Root (§9.4), append `E_DEPENDENT_MISSING` to
   *problems*.
4. Let *covered* be `ResolveCovers(binding, universe)`; on raise, append every raised and
   collected Diagnostic to *problems*.
5. If *problems* is empty, let *current* be `CoverHash(covered)`; on raise, append the Diagnostic
   to *problems*.
6. If *problems* is not empty, set *r*.`[[State]]` to `invalid`, *r*.`[[Diagnostics]]` to
   *problems*, and return *r*.
7. Set *r*.`[[Current]]` to *current*.
8. Let *entry* be `lock.[[Entries]]`[`binding.[[Dependent]]`], or *none*.
9. If *entry* is *none*, append `unstamped`. Otherwise:
   1. If `entry.[[Covers]]` is not equal, element by element, to `binding.[[Covers]]`, append
      `binding-changed`.
   2. If `entry.[[Hash]]` is not equal to *current*, append `content-changed`.
10. Set *r*.`[[State]]` to `stale` if *r*.`[[Reasons]]` is non-empty, else `ok`. Return *r*.

NOTE: `content-changed` covers every change to the covered set: an edited file, a new file the
patterns select, a deleted file, a renamed or moved file.

### 12.2 EvaluateAll

`EvaluateAll(root, options)`:

1. Let *config* be `? ReadConfig(root)`; let *attached* be the `E_PATTERN` Diagnostics collected
   while reading it.
2. Let *universe* be `ComputeUniverse(root, config)`.
3. Let *lock* be an empty Lock if `options.rebuild` is true, else `? ReadLock(root)`.
4. Let *results* be `Evaluate(b, universe, lock, attached of b)` for every *b* of
   `config.[[Bindings]]`, in path order.
5. For each Dependent in `lock.[[Entries]]` that has no Binding, collect the global warning
   `W_ORPHAN` naming it.
6. Return *results*, *lock*, and the global Diagnostics.

NOTE: There is no propagation between Dependents. If C covers B and B covers code, a change in the
code makes B stale and leaves C ok. Stamping B writes only the Lockfile, which is never in the
Universe (§7 step 7), so C stays ok. C becomes stale only when B's content changes.

## 13 Command-Line Interface

### 13.1 Synopsis

```
docsync check  [--json] [--root <dir>] [<file>...]
docsync status [--json] [--root <dir>] [<file>...]
docsync stamp  [--json] [--root <dir>] [--rebuild] [<file>...]
docsync ls     [--json] [--root <dir>] [<file>...]
docsync --version
docsync --help
```

An unknown command, unknown option, or missing option value raises `E_USAGE`. Every command first
performs `DetermineRoot(cwd, --root)`.

### 13.2 File Arguments

`SelectResults(args, cwd, root, results)`:

1. If *args* is empty, return *results*.
2. For each *arg*: resolve it against *cwd* and express it relative to Root as a RepoPath. If that
   is impossible, or no result has it as `[[Dependent]]`, collect the global error
   `E_UNKNOWN_DEPENDENT` naming *arg*.
3. Return the results whose `[[Dependent]]` was named, in path order, without duplicates.

### 13.3 check

1. Let (*results*, *lock*, *global*) be `EvaluateAll(root, { rebuild: false })`. If it raises,
   report the Diagnostic and exit 2.
2. Let *selected* be `SelectResults(...)`.
3. Report *selected* and *global* (§14). Exit with `ExitCode(selected, global)`.

`ExitCode(selected, global)` is 2 if any of *selected* is `invalid` or *global* contains an error;
else 1 if any of *selected* is `stale`; else 0. Warnings never affect the exit code.

### 13.4 status

As `check`, except that a `stale` result does not affect the exit code: it is 2 when `check` would
exit 2, else 0.

### 13.5 stamp

1. Let (*results*, *lock*, *global*) be `EvaluateAll(root, { rebuild: --rebuild })`. If it
   raises, report the Diagnostic and exit 2.
2. Let *targets* be `SelectResults(...)` if file arguments are given; otherwise, with `--rebuild`,
   every result; otherwise every result whose `[[State]]` is not `ok`.
3. If any of *targets* is `invalid`, or *global* contains an error, report them, write nothing, and
   exit 2.
4. For each *t* of *targets*, set `lock.[[Entries]]`[*t*.`[[Dependent]]`] to { `[[Covers]]`:
   *t*.`[[Covers]]`, `[[Hash]]`: *t*.`[[Current]]` }.
5. Remove from *lock* every entry whose Dependent has no Binding.
6. Write *lock* (§11.2).
7. Report each Dependent stamped and each entry removed. Exit 0.

NOTE: `stamp` does not check that a Review happened; it trusts its caller. Without arguments it
stamps only Dependents that are not `ok`, so it never re-stamps one nobody needed to review.

### 13.6 ls

1. Let *config* be `? ReadConfig(root)` and *universe* be `ComputeUniverse(root, config)`.
2. For each Binding selected as in §13.2, report its Dependent and the result of
   `ResolveCovers(binding, universe)`, or its Diagnostics.
3. Exit 2 if any error Diagnostic was reported, else 0.

## 14 Output

### 14.1 Streams

In text mode, results go to standard output and Diagnostics to standard error. In JSON mode, one
JSON document goes to standard output and nothing to standard error, unless the JSON document
itself cannot be produced.

### 14.2 Text Mode

For `check` and `status`, one block per selected result, in path order:

```
<STATE>  <dependent>  (<reason>, <reason>)
  covers  <pattern>
```

`<STATE>` is `ok`, `STALE` or `INVALID`. The parenthesized reasons and the `covers` lines (one per
pattern, in declaration order) appear only for `stale`. When any result is `stale`, the last line
is:

```
next: review each stale file against the files its patterns cover, then run `docsync stamp <file>...`
```

with the stale Dependents in path order in place of `<file>...`.

For `stamp`: one line `stamped  <dependent>` per target, then one line `removed  <dependent>` per
removed entry, each group in path order.

For `ls`: per selected Binding, the line `<dependent>` followed by one line per covered file,
indented two spaces, in path order.

A Diagnostic is written as `<severity>: <code>: <dependent>: <message>`, omitting `<dependent>: `
when empty.

Text mode MAY use color only when standard output is a terminal and the environment variable
`NO_COLOR` is unset or empty. Colored and uncolored output differ only in escape sequences.

### 14.3 JSON Mode

```json
{
  "version": 1,
  "command": "check",
  "exitCode": 1,
  "dependents": [
    {
      "dependent": "CLAUDE.md",
      "state": "stale",
      "reasons": ["content-changed"],
      "covers": ["src/**", "!src/**/*.test.ts", "package.json"],
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
```

- Fields appear in the order shown. Arrays follow the orders of §5.4 and §14.2.
- A Diagnostic is `{ "code", "severity", "dependent", "message" }`; `dependent` is `null` when
  empty.
- For `stamp`, each element of `dependents` adds `"stamped": true`, and the top level adds
  `"removed": [<dependent>...]`.
- For `ls`, each element of `dependents` has `"dependent"`, `"covers"`, `"files"` and
  `"diagnostics"`.
- Consumers MUST ignore unknown fields. Within version 1, later revisions only add fields.

## 15 Diagnostics

| Code | Severity | Raised by |
|---|---|---|
| `E_USAGE` | error | §13.1 |
| `E_ROOT` | error | §6 |
| `E_CONFIG_MISSING` | error | §6 |
| `E_CONFIG` | error | §9.2, §9.3 |
| `E_CONFIG_VERSION` | error | §9.2 |
| `E_UNKNOWN_KEY` | error | §9.3 |
| `E_PATTERN` | error | §9.3 |
| `E_DEPENDENT_MISSING` | error | §9.4, §12.1 |
| `E_EMPTY_PATTERN` | error | §8.4 |
| `E_EMPTY_COVERS` | error | §8.4 |
| `E_UNREADABLE` | error | §10.2 |
| `E_LOCK` | error | §11.1 |
| `E_LOCK_VERSION` | error | §11.1 |
| `E_UNKNOWN_DEPENDENT` | error | §13.2 |
| `W_ORPHAN` | warning | §12.2 |

Every `[[Message]]` MUST name the fix. For `E_LOCK` and `E_LOCK_VERSION` the fix is
`docsync stamp --rebuild` after reviewing every Dependent; for `W_ORPHAN` it is `docsync stamp`;
for `E_CONFIG_MISSING` it is creating `docsync.yaml` (§9.1).

## 16 Exit Codes

| Code | Meaning |
|---|---|
| 0 | success; for `check`, every selected Dependent is `ok` |
| 1 | `check` only: at least one selected Dependent is `stale`, none `invalid` |
| 2 | an error Diagnostic, an `invalid` Dependent, or a usage error |
| 70 | an unexpected internal failure, written to standard error |
