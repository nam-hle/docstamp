## 5 Records

### 5.1 Declaration

| Field | Type | Meaning |
|---|---|---|
| `[[File]]` | RepoPath | |
| `[[Dependencies]]` | List of String | the patterns, verbatim, in declaration order |
| `[[Selected]]` | List of Selected Dependency | the Selected Dependencies of the file, in order of appearance (§8.7), « » when none |
| `[[Use]]` | List of String, or none | the names in its own `use` key, in order; none when it has no `use` key (§8.6) |
| `[[Origin]]` | `config` or `inline` | where it is declared |
| `[[Recorded]]` | Hash, or none | inline only: the Hash recorded in the block (§5.6), none if it has no `hash` key |

### 5.2 Config

| Field | Type | Default |
|---|---|---|
| `[[Ignore]]` | List of String (ignore rule lines, §7.3) | « » |
| `[[UseGitignore]]` | Boolean | true |
| `[[Include]]` | non-empty List of String (patterns, §8.1) | « `**/*.md` » |
| `[[Presets]]` | Map from preset name (§9.3) to non-empty List of String (patterns, §8.1) | an empty Map |
| `[[DefaultPresets]]` | List of String (names of `[[Presets]]`, distinct): the default Presets (§8.6) | « » |
| `[[Declarations]]` | List of configured Declaration, in path order of `[[File]]` | (required) |

NOTE: A Config is built from the normalized value of the Configuration file (§9.3), whatever its
Carrier. When there is no Configuration file, every field has the default of this table, and
`[[Declarations]]` is « » (§9.3 step 2).

NOTE: Plugins (§8.7) are not part of the Config value. They come only from a script Carrier
(§9.5), and are passed as an argument to `Evaluate` (§12.1) and `DependencyHash` (§10.4).

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
| `[[Dependencies]]` | List of String | the Declaration's effective patterns (§8.6): its `[[Dependencies]]` when it uses no Preset |
| `[[Use]]` | List of String | the Declaration's `[[Use]]` |
| `[[Selected]]` | List of Selected Dependency | the Declaration's `[[Selected]]` |
| `[[Origins]]` | List of String or none | one element per element of `[[Dependencies]]`: the name of the Preset the pattern comes from, or none for the Declaration's own pattern |
| `[[State]]` | `ok`, `stale` or `invalid` | §12.1 |
| `[[Reasons]]` | List of Reason | non-empty iff `[[State]]` is `stale` |
| `[[Resolved]]` | List of RepoPath, path order | empty iff `[[State]]` is `invalid` |
| `[[Current]]` | Hash or empty | empty iff `[[State]]` is `invalid` |
| `[[Diagnostics]]` | List of Diagnostic, §5.5 order | holds an error iff `[[State]]` is `invalid`; any Result may also hold warnings (§8.5, §8.7) |
| `[[Changes]]` | List of Change in path order, or *unknown* | known only as defined in §12.3 |
| `[[Base]]` | a commit Id, or none | the commit *C* of §12.3 when `[[Changes]]` is known, else none |
| `[[Edited]]` | RepoPath, or none | the *carrier* of §12.3 step 1.4 when `[[Changes]]` is known and that step found the Declaration's own list edited since *C*, else none |
| `[[Selection]]` | List of SelectionChange in path order, or none | the files that entered or left the selection with that edit (§12.3 step 10), when `[[Edited]]` is not none and it is known, else none |
| `[[Fragments]]` | List of FragmentChange, or none | the Selected Dependencies whose Fragment changed since *C* (§12.3 step 11), when `[[Changes]]` is known and the Declaration has Selected Dependencies, else none |

A *Reason* is `unrecorded` or `content-changed`; exactly one applies to a `stale` Result.

NOTE: An edit of the Declaration's own list is not a Reason. The Lockfile and the `hash` of a block
record a Hash and no pattern, so only the history can tell such an edit apart from a change of a
dependency, and the Reasons must not depend on `git` (§2). `[[Edited]]` is part of the changed-file
report instead.

A *Change* is { `[[Status]]`: `modified`, `added` or `deleted`, `[[Path]]`: RepoPath, `[[Via]]`: a
non-empty List of String, `[[WhitespaceOnly]]`: Boolean, `[[Pair]]`: RepoPath or none }.
`[[Pair]]` links a `deleted` and an `added` Change with the same content (§12.3 step 8).

A *SelectionChange* is { `[[Status]]`: `added` or `removed`, `[[Path]]`: RepoPath }: a file that the
edited own list selects and the own list at *C* did not (`added`), or the reverse (`removed`).

A *FragmentChange* is { `[[Path]]`: RepoPath, `[[Select]]`: a plain value (§3.5), `[[Status]]`:
`changed` or `new`, `[[Parts]]`: List of PartInfo or none }: a Selected Dependency (§8.7) whose
Fragment differs from the one at *C* (`changed`), or that has none to compare with at *C* (`new`).
A *PartInfo* is { `[[Focus]]`: String or none, `[[Lines]]`: { `start`, `end` } or none }. `[[Parts]]` has one PartInfo for each Part of its Fragment now, and is none when no Part has
a Focus or Lines.

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
then `[[Subject]]` in path order, then `[[Message]]` in path order. Every List of Diagnostics that
is output is in this order, with duplicates (all fields equal) removed.

`[[Message]]` is one sentence naming the problem and its fix. It MUST NOT contain operating system
error text, parser error text, or absolute paths; it MAY contain an error code name such as
`EACCES`. The `[[Message]]` of an `E_SELECT` or `W_SELECT` that a Plugin reports (§8.7 step 4) is
the Plugin's own: docstamp passes it unchanged and does not check it for a sentence, so that rule
binds the author of the Plugin, which MUST NOT put operating system error text, parser error text or
an absolute path in it. The one exception is a file argument that does not resolve inside Root: the `E_USAGE` of
§13.3 step 2, §13.8 step 3 and §13.10 step 2 names the working directory, the resolved path and
Root, because that is what explains the failure.

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

`dependencies` is required: a non-empty List whose elements are patterns of the dialect of §8.1 or
Selected Dependencies (§8.7). `use` is optional:
a non-empty List of Preset names (§8.6), or the empty List when the Configuration file names default
Presets, to use none of them (§9.6.2). `hash` is optional:
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
them empty or a lone `!`, two invalid Patterns of §8.1), `use` (an
array of distinct Preset names; the schema cannot see the Configuration file, so it accepts the
empty array, which §9.6.2 accepts only when there are default Presets) and `hash` (64 lowercase hexadecimal digits), and no other
key; other frontmatter keys are free. It is generated from the same keys as §9.6.2 and is
informative: docstamp does not read it, and §9.6.2 decides.
