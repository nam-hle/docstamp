## 4 Terms

**Root**: the directory against which every RepoPath is resolved (§6).

**RepoPath**: a String naming an entry relative to Root. It uses `/` as separator, has no leading
or trailing `/`, no empty segment, no segment `.` or `..`, no U+0000, and is in Unicode
Normalization Form C (NFC).

**Declaration**: what gives a file its dependencies, as a List of patterns and Selected Dependencies: an entry of `files` in
the Configuration file (a *configured* Declaration), or the `docstamp` block in the frontmatter of
the file itself (an *inline* Declaration, §5.6).

**Selected Dependency**: an element of `dependencies` that names one file and a selector, handled
by a Plugin, instead of a Pattern (§8.7).

**Plugin**: an object registered in a script Carrier under `plugins` (§9.5), or one of the Builtin
Plugins (§8.8), that extracts Fragments from the files it claims (§8.7).

**Part**: one piece of a file that a selector selects, as a Plugin returns it: its content, and
optionally a description in words and the lines it occupies (§8.7).

**Fragment**: the non-empty List of Parts that a Plugin returns for a Selected Dependency (§8.7).

**File** (stamped file): a file that has a Declaration, and so rests on other files, its
dependencies. The Configuration file, the Lockfile and the JSON output name it `file`, and the
Configuration file's key for all of them `files`.

**Inline file**: a file with an inline Declaration. **Inline block**: its `docstamp` block (§5.6).

**Include**: the List of patterns (§9.3) that selects the files of the Universe searched for inline
blocks. Its default is « `**/*.md` ».

**Preset**: a named non-empty List of patterns that the Configuration file defines under
`presets` (§9.3) and a Declaration names under `use` (§8.6), so that a list shared by many files is
written once. A file's *effective patterns* are its own patterns followed by those of its presets
(§8.6). The *default Presets* are those the Configuration file names under its key
`default-presets` (§9.3): a Declaration without a `use` of its own uses them (§8.6).

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
