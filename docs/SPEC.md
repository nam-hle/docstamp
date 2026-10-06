# docsync Specification

Version 1 (draft). This document defines the observable behavior of docsync. It does not define
implementation structure. Where code or tests refer to behavior, they cite clause numbers of this
document (for example `§8.3`).

## 1 Scope

This specification defines:

- how a *Root* is determined (§6);
- the file universe docsync observes (§7);
- the syntax and semantics of bindings declared in Markdown frontmatter and in the configuration
  file (§9, §10);
- the pattern language used in bindings (§8);
- content hashing (§11);
- the lockfile format (§12);
- the evaluation of a doc's state (§13);
- the command-line interface, its output and its exit codes (§14, §15, §16).

## 2 Conformance

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in
RFC 2119.

A conforming implementation MUST produce, for the same Root contents, configuration, lockfile and
command line, byte-identical standard output, byte-identical lockfile contents, and the same exit
code, regardless of host operating system, locale, time zone, wall-clock time, environment
variables (other than those that determine the current working directory), and version-control
history.

A conforming implementation MUST NOT perform network access and MUST NOT invoke a version-control
program.

## 3 Notational Conventions

### 3.1 Algorithm Conventions

Behavior is specified as algorithms of numbered steps. Steps are performed in order. Substeps are
indented and numbered within their parent step.

An *abstract operation* is a named algorithm, written `OperationName(arg1, arg2)`. It either
returns a value or *raises* a Diagnostic (§5.6).

The prefix `?` before an abstract operation call means: if the call raises, the calling algorithm
raises the same Diagnostic and performs no further steps. The prefix `!` asserts that the call
cannot raise.

The phrase *collect* a Diagnostic means: append it to the current Diagnostic List and continue.
Collected Diagnostics are reported together; they never stop the algorithm.

### 3.2 Data Conventions

A *List* is an ordered sequence. A *Map* is a set of key-value pairs with unique keys; when a Map
is enumerated it is enumerated in ascending key order under §3.3 unless stated otherwise.

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

**Doc**: a file that has a Binding.

**Covered file**: a file selected by a Doc's Binding (§8.4).

**Review**: the act, outside docsync, of checking a Doc's content against its covered files.

**Stamp**: recording the current hashes of a Doc's covered files in the lockfile, asserting that a
Review happened.

**Configuration file**: the file `docsync.yaml` at Root.

**Lockfile**: the file `docsync.lock` at Root.

## 5 Records

### 5.1 Binding Record

| Field | Type | Meaning |
|---|---|---|
| `[[Doc]]` | RepoPath | the Doc |
| `[[Covers]]` | List of String | the patterns, verbatim, in declaration order |
| `[[Source]]` | `frontmatter` or `config` | where the Binding was declared |

### 5.2 Config Record

| Field | Type | Default |
|---|---|---|
| `[[Include]]` | List of String (patterns) | « `**/*.md` » |
| `[[Exclude]]` | List of String (patterns) | « » |
| `[[Ignore]]` | List of String (gitignore lines) | « » |
| `[[UseGitignore]]` | Boolean | true |
| `[[Docs]]` | Map from RepoPath to List of String | empty |

### 5.3 LockEntry Record

| Field | Type | Meaning |
|---|---|---|
| `[[Covers]]` | List of String | the Binding's `[[Covers]]` at stamp time |
| `[[Files]]` | Map from RepoPath to Hash | covered files and their hashes at stamp time |

### 5.4 Lock Record

| Field | Type |
|---|---|
| `[[Version]]` | the integer 1 |
| `[[Entries]]` | Map from RepoPath (Doc) to LockEntry |

### 5.5 DocResult Record

| Field | Type | Meaning |
|---|---|---|
| `[[Doc]]` | RepoPath | |
| `[[State]]` | `ok`, `stale` or `invalid` | §13 |
| `[[Reasons]]` | List of Reason | non-empty iff `[[State]]` is `stale` |
| `[[Modified]]` | List of RepoPath, path order | |
| `[[Added]]` | List of RepoPath, path order | |
| `[[Removed]]` | List of RepoPath, path order | |
| `[[Diagnostics]]` | List of Diagnostic | non-empty iff `[[State]]` is `invalid` |

A *Reason* is one of, and when several apply they are listed in this order: `unstamped`,
`binding-changed`, `modified`, `added`, `removed`.

### 5.6 Diagnostic Record

| Field | Type | Meaning |
|---|---|---|
| `[[Code]]` | String | one of the codes of §16 |
| `[[Severity]]` | `error` or `warning` | |
| `[[File]]` | RepoPath or empty | the file the problem is in |
| `[[Message]]` | String | one sentence, naming what is wrong and the fix |

A Diagnostic whose `[[File]]` is a Doc, or which concerns a Doc's Binding, is *attached* to that
Doc. Every other Diagnostic is *global*.

## 6 Root

`DetermineRoot(cwd, rootOption)`:

1. If `rootOption` is present:
   1. Let *dir* be `rootOption` resolved against *cwd*.
   2. If *dir* is not an existing directory, raise `E_ROOT`.
   3. Return *dir*.
2. Let *dir* be *cwd*.
3. Repeat:
   1. If *dir* contains a file named `docsync.yaml`, return *dir*.
   2. If *dir* contains an entry named `.git` (file or directory), return *dir*.
   3. If *dir* is the filesystem root, return *cwd*.
   4. Set *dir* to the parent of *dir*.

NOTE: `.git` is only a marker for where a repository starts; its contents are never read.

## 7 Universe

The *Universe* is the List, in path order, of RepoPaths of the files docsync observes.

`ComputeUniverse(root, config)`:

1. Let *ignore* be an empty ignore rule set using the semantics of gitignore pattern lines.
2. Add the rule `.git/` to *ignore*.
3. If `config.[[UseGitignore]]` is true, then for every file named `.gitignore` in a directory
   *d* that is not itself ignored, add its lines to *ignore*, scoped to *d*, with the precedence
   gitignore defines for nested files.
4. Add every line of `config.[[Ignore]]` to *ignore*, scoped to Root, with precedence over step 3.
5. Walk Root. Do not descend into a directory that *ignore* matches. Do not follow a symbolic link
   to a directory.
6. Let *files* be every regular file, and every symbolic link to a regular file, that was reached
   and that *ignore* does not match.
7. Remove `docsync.yaml` and `docsync.lock` from *files*.
8. Return the RepoPaths of *files* in path order.

A symbolic link whose target does not exist is reached in step 5 and kept in step 6; reading it
raises `E_UNREADABLE` (§11).

## 8 Patterns

### 8.1 Syntax

```
Pattern   ::= Negation? Glob
Negation  ::= "!"
Glob      ::= Segment ( "/" Segment )*
Segment   ::= "**" | Part+
Part      ::= Literal | "*" | "?" | Class | Alternation
Class     ::= "[" "!"? ClassItem+ "]"
ClassItem ::= Char | Char "-" Char
Alternation ::= "{" Glob ( "," Glob )+ "}"
Literal   ::= any code point except * ? [ { } , / \  |  "\" any code point
```

A Pattern is *invalid* (raise `E_PATTERN`) if it is empty, is `!` alone, starts with `/` after the
optional Negation, contains a segment `.` or `..`, ends with `/`, or does not match the grammar.

### 8.2 Glob Matching

`GlobMatches(glob, path)` is true iff *path* is in the language of *glob*, where:

- a Literal matches itself; `\c` matches the code point *c*;
- `*` matches any sequence of zero or more code points not containing `/`;
- `?` matches exactly one code point other than `/`;
- a Class matches one code point other than `/` that is (or, with `!`, is not) listed or in a
  listed inclusive range;
- an Alternation matches what any one of its Globs matches;
- a Segment `**` matches zero or more whole segments;
- matching is case-sensitive and anchored at both ends; a leading `.` in a segment has no special
  meaning.

### 8.3 Pattern Matching

`PatternMatches(pattern, path)`:

1. Let *glob* be *pattern* without its Negation.
2. If `GlobMatches(glob, path)` is true, return true.
3. For each proper prefix *dir* of *path* that ends just before a `/`: if
   `GlobMatches(glob, dir)` is true, return true.
4. Return false.

NOTE: Step 3 gives directory semantics: `src/cli` selects every file under `src/cli/`, as does
`src/*`, which matches the directory `src/cli`. This matches how gitignore treats a pattern that
matches a directory.

### 8.4 Selection

`Select(patterns, candidates)` returns the covered subset of *candidates*:

1. Let *result* be an empty List.
2. For each *path* of *candidates*, in path order:
   1. Let *selected* be false.
   2. For each *pattern* of *patterns*, in order: if `PatternMatches(pattern, path)` is true, set
      *selected* to true if *pattern* has no Negation, else false.
   3. If *selected* is true, append *path* to *result*.
3. Return *result*.

NOTE: The last matching pattern wins, as in gitignore. A Negation only removes what an earlier
pattern added.

`ResolveCovers(binding, universe)`:

1. For each *pattern* of `binding.[[Covers]]`, raise `E_PATTERN` if it is invalid (§8.1).
2. Let *candidates* be *universe* without `binding.[[Doc]]`.
3. For each *pattern* of `binding.[[Covers]]` without Negation: if no *path* of *candidates*
   satisfies `PatternMatches(pattern, path)`, collect `E_EMPTY_PATTERN` naming *pattern*.
4. If any Diagnostic was collected in step 3, raise the first of them after collecting the rest.
5. Let *covered* be `Select(binding.[[Covers]], candidates)`.
6. If *covered* is empty, raise `E_EMPTY_COVERS`.
7. Return *covered*.

NOTE: A Doc is never one of its own covered files (step 2), so editing a Doc never makes that
Doc stale.

## 9 Frontmatter Bindings

### 9.1 Frontmatter Block

`FrontmatterOf(text)`, where *text* has had every CR LF pair replaced by LF:

1. If *text* does not start with the line `---` followed by LF, return *none*.
2. Let *end* be the first subsequent line that is exactly `---` or `...`.
3. If there is no such line, return *none*.
4. Return the Record { `[[Yaml]]`: the lines strictly between, `[[Body]]`: everything after the
   *end* line and its LF }.

A file has *no frontmatter* if `FrontmatterOf` returns *none*.

### 9.2 Discovery

`DiscoverBindings(universe, config)`:

1. Let *candidates* be `Select(config.[[Include]] ++ « "!" + p for p of config.[[Exclude]] »,
   universe)`.
2. Let *bindings* be an empty List.
3. For each *path* of *candidates*:
   1. Read the file. If it is binary (§11.1), skip it.
   2. Let *fm* be `FrontmatterOf(text)`. If *fm* is *none*, skip it.
   3. Parse `fm.[[Yaml]]` as YAML 1.2. If parsing fails: if the text contains a line starting
      with `docsync:`, collect `E_FRONTMATTER` attached to *path*; skip it.
   4. If the result is not a mapping, or has no key `docsync`, skip it.
   5. Let *b* be `? ParseBindingValue(result.docsync, path)`, collecting on raise.
   6. Append the Binding { `[[Doc]]`: *path*, `[[Covers]]`: *b*, `[[Source]]`: `frontmatter` }.
4. Return *bindings*.

`ParseBindingValue(value, doc)`:

1. If *value* is not a mapping, raise `E_FRONTMATTER`.
2. If *value* has a key other than `covers`, raise `E_UNKNOWN_KEY`.
3. If *value* has no key `covers`, or `covers` is not a non-empty sequence of strings, raise
   `E_FRONTMATTER`.
4. Return the strings of `covers`, in order.

## 10 Configuration File

`ReadConfig(root)` returns the Config Record defined by §10.1 and §10.2, or raises.

### 10.1 Presence

If the Configuration file does not exist, the Config Record has every default of §5.2. Its
absence is not an error.

### 10.2 Schema

The Configuration file MUST parse as a YAML 1.2 mapping (else raise `E_CONFIG`). Its keys:

| Key | Type | Field |
|---|---|---|
| `version` | the integer 1 | (required) |
| `include` | non-empty sequence of Pattern strings | `[[Include]]` |
| `exclude` | sequence of Pattern strings without Negation | `[[Exclude]]` |
| `ignore` | sequence of strings | `[[Ignore]]` |
| `gitignore` | boolean | `[[UseGitignore]]` |
| `docs` | mapping from RepoPath to a mapping with exactly the key `covers` | `[[Docs]]` |

- A missing or different `version` raises `E_CONFIG_VERSION`.
- An unknown key at any level raises `E_UNKNOWN_KEY`.
- A value of the wrong type raises `E_CONFIG`.
- A `docs` key that is not a valid RepoPath raises `E_CONFIG`.
- Each `covers` value follows `ParseBindingValue` (§9.2).

### 10.3 Config Bindings

`ConfigBindings(config, root)`:

1. For each (*doc*, *covers*) of `config.[[Docs]]`:
   1. If no regular file exists at *doc* under Root, collect `E_DOC_MISSING` attached to *doc*.
   2. Otherwise produce the Binding { `[[Doc]]`: *doc*, `[[Covers]]`: *covers*, `[[Source]]`:
      `config` }.
2. Return the produced Bindings.

NOTE: A config-declared Doc need not be in the Universe; it may be an ignored file.

### 10.4 All Bindings

`AllBindings(root, config, universe)`:

1. Let *a* be `DiscoverBindings(universe, config)` and *b* be `ConfigBindings(config, root)`.
2. For each Doc that appears in both *a* and *b*, collect `E_DUPLICATE_BINDING` attached to it,
   and remove it from both.
3. Return *a* ++ *b* in path order of `[[Doc]]`.

## 11 Hashing

### 11.1 Binary Content

A byte sequence is *binary* iff its first min(8192, length) bytes contain the byte 0x00.

### 11.2 Normalized Content

`NormalizedContent(path, bindings)`:

1. Read the bytes of *path* (following a symbolic link). If reading fails, raise `E_UNREADABLE`.
2. If the bytes are binary, return them.
3. Replace every byte pair 0x0D 0x0A with 0x0A. Let *text* be the result decoded as UTF-8, with
   each invalid sequence replaced by U+FFFD.
4. If *path* is the `[[Doc]]` of a Binding whose `[[Source]]` is `frontmatter`:
   1. Let *fm* be `FrontmatterOf(text)`; parse `fm.[[Yaml]]`; remove the key `docsync`.
   2. If the remaining mapping is empty, set *text* to `fm.[[Body]]`.
   3. Otherwise set *text* to `CanonicalJson(remaining)` ++ LF ++ `fm.[[Body]]`.
5. Return the UTF-8 encoding of *text*.

`CanonicalJson(value)` is the JSON text of *value* with mapping keys in path order, no
insignificant whitespace, and strings escaped as ECMAScript `JSON.stringify` escapes them.

NOTE: Step 4 means editing a Doc's `docsync` block, or reformatting its frontmatter, never makes
another Doc that covers it stale. Editing its prose does.

### 11.3 Hash

`Hash(path, bindings)` is the lowercase hexadecimal encoding of the first 8 bytes of the SHA-256
digest of `NormalizedContent(path, bindings)`: a String of exactly 16 characters `[0-9a-f]`.

## 12 Lockfile

### 12.1 Reading

`ReadLock(root)`:

1. If the Lockfile does not exist, return { `[[Version]]`: 1, `[[Entries]]`: empty }.
2. Parse it as YAML 1.2. If parsing fails, raise `E_LOCK`.
3. If `version` is not the integer 1, raise `E_LOCK_VERSION`.
4. Validate against §12.2; on any violation, including an unknown key, raise `E_LOCK`.
5. Return the Lock Record.

### 12.2 Canonical Form

`WriteLock(lock)` produces this text exactly, with LF line endings and a final LF:

```
version: 1
docs:
  <doc>:
    covers:
      - <pattern>
    files:
      <file>: <hash>
```

- `docs:` is followed by one block per entry, Docs in path order. If there are no entries, the
  line is `docs: {}`.
- `covers` lists the patterns in declaration order.
- `files` lists covered files in path order.
- Indentation is two spaces per level.
- Every `<doc>`, `<pattern>` and `<file>` is written as a YAML double-quoted scalar, escaped as
  `CanonicalJson` escapes a string. `<hash>` is written plain.

Writing the Lockfile MUST be atomic: a reader observes either the previous contents or the new
contents. If the new text equals the existing contents byte for byte, the file MUST NOT be
written.

## 13 Evaluation

`Evaluate(binding, universe, lock, bindings)` returns a DocResult:

1. Let *r* be a DocResult with `[[Doc]]` = `binding.[[Doc]]` and empty Lists.
2. Let *covered* be `ResolveCovers(binding, universe)`. If it raises, set *r*.`[[State]]` to
   `invalid`, attach every raised and collected Diagnostic, and return *r*.
3. Let *current* be a Map from each *f* of *covered* to `Hash(f, bindings)`. If any call raises,
   handle as in step 2.
4. Let *entry* be `lock.[[Entries]]`[`binding.[[Doc]]`], or *none*.
5. If *entry* is *none*:
   1. Append `unstamped` to *r*.`[[Reasons]]`; set *r*.`[[Added]]` to the keys of *current*.
   2. Set *r*.`[[State]]` to `stale` and return *r*.
6. If `entry.[[Covers]]` is not equal, element by element, to `binding.[[Covers]]`, append
   `binding-changed`.
7. Set *r*.`[[Modified]]` to the keys present in both *current* and `entry.[[Files]]` whose values
   differ; *r*.`[[Added]]` to the keys only in *current*; *r*.`[[Removed]]` to the keys only in
   `entry.[[Files]]`.
8. For each of `modified`, `added`, `removed` whose List is non-empty, append it to
   *r*.`[[Reasons]]`.
9. Set *r*.`[[State]]` to `stale` if *r*.`[[Reasons]]` is non-empty, else `ok`. Return *r*.

`EvaluateAll(root, cwd, options)`:

1. Let *config* be `? ReadConfig(root)`. Let *universe* be `ComputeUniverse(root, config)`.
2. Let *bindings* be `AllBindings(root, config, universe)`.
3. Let *lock* be `? ReadLock(root)`.
4. Let *results* be `Evaluate(b, universe, lock, bindings)` for every *b* of *bindings*, plus, for
   every Doc to which a collected Diagnostic is attached but which has no Binding, a DocResult in
   state `invalid` carrying those Diagnostics. Order *results* by `[[Doc]]` in path order.
5. For every Doc in `lock.[[Entries]]` that has no Binding and no DocResult, collect the global
   warning `W_ORPHAN` naming it.
6. Return *results* and the global Diagnostics.

NOTE: There is no propagation between Docs. If Doc C covers Doc B and B covers code, a change in
the code makes B stale and leaves C ok; stamping B writes only the Lockfile, which is never in the
Universe (§7 step 7), so C stays ok. C becomes stale only when B's normalized content changes.

## 14 Command-Line Interface

### 14.1 Synopsis

```
docsync check  [--json] [--root <dir>] [<doc>...]
docsync status [--json] [--root <dir>] [<doc>...]
docsync stamp  [--json] [--root <dir>] [--rebuild] [<doc>...]
docsync ls     [--json] [--root <dir>] [<doc>...]
docsync --version
docsync --help
```

An unknown command, unknown option, or missing option value raises `E_USAGE`.

### 14.2 Doc Arguments

`SelectDocs(args, cwd, root, results)`:

1. If *args* is empty, return every DocResult of *results*.
2. For each *arg*: resolve it against *cwd*; express it relative to Root as a RepoPath. If that is
   impossible, or no DocResult has it as `[[Doc]]`, collect `E_UNKNOWN_DOC` naming *arg*.
3. Return the matching DocResults, in path order, without duplicates.

### 14.3 check

1. Let (*results*, *global*) be `EvaluateAll`. If it raises, report the Diagnostic and exit 2.
2. Let *selected* be `SelectDocs(...)`.
3. Report *selected* and every global Diagnostic (§15).
4. Exit with `ExitCode(selected, global)`.

`ExitCode(selected, global)`: 2 if any of *selected* is `invalid` or any error Diagnostic is
global or attached to *selected*; else 1 if any of *selected* is `stale`; else 0. Warnings never
affect the exit code.

### 14.4 status

As `check`, but the exit code is 0 unless step 1 raises or `E_USAGE`/`E_UNKNOWN_DOC` is raised,
in which case it is 2.

### 14.5 stamp

1. If `--rebuild` is given, the Lockfile is treated as absent in `EvaluateAll` (so `E_LOCK` and
   `E_LOCK_VERSION` do not apply). Otherwise, if `EvaluateAll` raises, report and exit 2.
2. Let *targets* be `SelectDocs(...)` if Doc arguments are given; otherwise every DocResult whose
   state is not `ok`, or, with `--rebuild`, every DocResult.
3. If any of *targets* is `invalid`, or any error Diagnostic is global, report them, write
   nothing, and exit 2.
4. Let *lock* be the Lock read in step 1 (empty with `--rebuild`).
5. For each *t* of *targets*, set `lock.[[Entries]]`[*t*.`[[Doc]]`] to { `[[Covers]]`: the
   Binding's `[[Covers]]`, `[[Files]]`: the *current* Map of §13 step 3 }.
6. Remove from *lock* every entry whose Doc has no Binding.
7. Write *lock* (§12.2).
8. Report each Doc stamped and each entry removed. Exit 0.

NOTE: `stamp` does not check that a Review happened; it trusts its caller. Without arguments it
stamps only Docs that are not `ok`, so it never re-stamps a Doc nobody needed to review.

### 14.6 ls

1. Let *config*, *universe* and *bindings* be as in `EvaluateAll` steps 1 and 2.
2. For each selected Binding (§14.2), report its Doc, `[[Source]]`, and the result of
   `ResolveCovers`, or its Diagnostics.
3. Exit 2 if any error Diagnostic was reported, else 0.

## 15 Output

### 15.1 Streams

In text mode, results go to standard output and Diagnostics to standard error. In JSON mode, a
single JSON document goes to standard output and nothing is written to standard error, except
when the JSON document itself cannot be produced.

### 15.2 Text Mode

For `check` and `status`, one block per selected DocResult, in path order:

```
<STATE>  <doc>  (<reason>, <reason>)
  modified  <file>
  added     <file>
  removed   <file>
```

`<STATE>` is `ok`, `STALE` or `INVALID`. The parenthesized part and the file lines appear only
for `stale`. Files are listed modified, then added, then removed, each in path order. When any
DocResult is `stale`, the last line is:

```
next: review the docs above against the listed files, then run `docsync stamp <doc>...`
```

with the stale Docs in path order.

A Diagnostic is written as `<severity>: <code>: <file>: <message>`, omitting `<file>: ` when
empty. Text mode MAY use color only when standard output is a terminal and the environment does
not set `NO_COLOR`; colored and uncolored output differ only in escape sequences.

### 15.3 JSON Mode

```json
{
  "version": 1,
  "command": "check",
  "exitCode": 1,
  "docs": [
    {
      "doc": "CLAUDE.md",
      "state": "stale",
      "reasons": ["modified", "added"],
      "modified": ["src/cli/check.ts"],
      "added": ["src/cli/stamp.ts"],
      "removed": [],
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
```

- Fields appear in the order shown. Arrays follow the orders of §5.5 and §15.2.
- A Diagnostic is `{ "code", "severity", "file", "message" }`; `file` is `null` when empty.
- For `stamp`, each doc object has the additional field `"stamped": true|false`, and the top
  level has `"removed": [<doc>...]`.
- For `ls`, each doc object has `"source"` and `"files"` instead of the state fields.
- Consumers MUST ignore unknown fields. Future versions of this specification only add fields
  within version 1.

## 16 Diagnostics

| Code | Severity | Raised by |
|---|---|---|
| `E_USAGE` | error | §14.1 |
| `E_ROOT` | error | §6 |
| `E_CONFIG` | error | §10.2 |
| `E_CONFIG_VERSION` | error | §10.2 |
| `E_UNKNOWN_KEY` | error | §9.2, §10.2 |
| `E_FRONTMATTER` | error | §9.2 |
| `E_DOC_MISSING` | error | §10.3 |
| `E_DUPLICATE_BINDING` | error | §10.4 |
| `E_PATTERN` | error | §8.1 |
| `E_EMPTY_PATTERN` | error | §8.4 |
| `E_EMPTY_COVERS` | error | §8.4 |
| `E_UNREADABLE` | error | §11.2 |
| `E_LOCK` | error | §12.1 |
| `E_LOCK_VERSION` | error | §12.1 |
| `E_UNKNOWN_DOC` | error | §14.2 |
| `W_ORPHAN` | warning | §13 |

Every `[[Message]]` MUST name the fix. For `E_LOCK` and `E_LOCK_VERSION` the fix is
`docsync stamp --rebuild` after reviewing every Doc; for `W_ORPHAN` it is `docsync stamp`.

## 17 Exit Codes

| Code | Meaning |
|---|---|
| 0 | every selected Doc is `ok` (or the command succeeded) |
| 1 | at least one selected Doc is `stale`, none `invalid` (`check` only) |
| 2 | an error Diagnostic, an `invalid` Doc, or a usage error |

An unexpected internal failure exits 70 and writes the failure to standard error.
