## 12 Evaluation

### 12.1 Evaluate

`Evaluate(declaration, universe, lock, attached, plugins)`, where *attached* is the List of
Diagnostics from §9.3, §9.6 and §12.2 attached to `declaration.[[File]]`, and *plugins* the Plugins
of §9.5 (« » when the Configuration file is not a script Carrier):

1. Let *r* be a Result with `[[File]]`, `[[Use]]` and `[[Dependencies]]` from *declaration*, the
   latter being its effective patterns (§8.6) and `[[Origins]]` their origins (none for each, when
   *declaration* uses no Preset), empty `[[Reasons]]`, `[[Resolved]]` and `[[Diagnostics]]`, and
   empty `[[Current]]`.
2. Let *problems* be a copy of *attached*, and *warnings* an empty List.
3. If `declaration.[[File]]` does not satisfy §9.4, collect `E_FILE_MISSING` into
   *problems*. (An inline file always satisfies it.)
4. If *attached* is empty, let *resolved* and *warnings* be the result of
   `ResolveDependencies(declaration, universe)`; if it raises, add its Diagnostics, warnings
   included, to *problems*. Also, for each Selected Dependency of `declaration.[[Selected]]`, collect
   `E_EMPTY_PATTERN` per §8.7 NOTE into *problems*. Let *all* be the union of *resolved* and the
   `[[Path]]` of the Selected Dependencies, in path order.
5. If *problems* is empty, let *current* be `DependencyHash(resolved, declaration.[[Selected]],
   plugins)` including its Fragments (§10.4 step 3); if it raises, add its Diagnostics, warnings
   included, to *problems*; otherwise add the warnings it returns to *warnings*.
6. If *problems* is not empty, set *r*.`[[State]]` to `invalid` and *r*.`[[Diagnostics]]` to
   *problems*, each with `[[File]]` set to `declaration.[[File]]`, and return *r*.
7. Set *r*.`[[Resolved]]` to *all*, *r*.`[[Current]]` to *current* and *r*.`[[Diagnostics]]`
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

1. Let (*config*, *attached*, *present*) be `? ReadConfig(root)`, and *plugins* the Plugins that
   `LoadScript` (§9.5) returned for the Configuration file, « » for any other Carrier or none.
2. Let *universe* be `? ComputeUniverse(root, config)`.
3. Let (*inline*, *more*, *marked*) be `? ReadInline(root, universe, config)`. Let *attached* be
   *attached* and *more*.
4. If *present* is false and *marked* is empty, raise « `E_CONFIG_MISSING` ».
5. Let *declarations* be `config.[[Declarations]]` and the Declarations of *inline*, in path order
   of `[[File]]`. For each file declared by both a configured and an inline Declaration, drop the
   inline Declaration and the Diagnostics of *attached* for that file that came from *inline*, and
   collect `E_DUPLICATE_DECLARATION` into *attached*, `[[File]]` that file. Then, for each remaining
   Declaration *d* that uses a Preset, call
   `ExpandPresets(d, config.[[Presets]], config.[[DefaultPresets]], present)` (§8.6): when it returns, the effective patterns and their origins are those of *d* from here on;
   when it raises, collect its Diagnostics into *attached*, `[[File]]` the file of *d*. Then, for
   each Selected Dependency of each remaining Declaration, collect `ValidateSelect` (§8.7) into
   *attached*.
6. If *lockPolicy* is `discard-invalid` and `ReadLock(root)` raises, let *lock* be a Lock with no
   entries. Otherwise let *lock* be `? ReadLock(root)`.
7. Let *results* be `Evaluate(b, universe, lock, attached of b, plugins)` for each *b* of *declarations*,
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

`ChangedSince(root, result, entry)` returns a List of Change, the commit *C* below, and the
`[[Edited]]`, `[[Selection]]` and `[[Fragments]]` of step 9, or *unknown*. It is
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
      not parse (for example a version 1, 2 or 3 file); that is never an error.
   3. Let *C* be the first commit in which the file's LockEntry equals *entry* and its
      parent's does not. If there is none, return *unknown*.
   4. Let *edited* be true iff the Declaration's *own list* as of *C* is known and differs from its
      own list now. The own list is the pair (the patterns of `result.[[Dependencies]]` whose
      `[[Origins]]` element is none, in order; `result.[[Use]]`, where none differs from « »).
      As of *C* it is read from `docstamp.yaml` there for a configured file (the `dependencies`
      and `use` of the key `result.[[File]]` under `files`, parsed by §9.2), and from the inline
      block of the file there for an inline file (§9.6.2 with *defaults* true, its `dependencies`
      and `use`). It is unknown when that file is absent at *C*, does not parse, or does not declare `result.[[File]]` with a non-empty
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
   file is no longer a dependency. For `added` and `modified` the path must also be selected by
   `result.[[Dependencies]]`, so a path that only a Selected Dependency names is not a Change
   (step 11 reports its Fragment).
5. If the Changes are empty, *edited* is false and the *fragments* of step 11 are empty, return
   *unknown*.
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
9. Return the Changes in path order, *C*, which is `[[Base]]` of the Result, the carrier if
   *edited* is true, else none, which is its `[[Edited]]`, the selection of step 10, which is
   its `[[Selection]]`, and, when the Declaration has Selected Dependencies, the *fragments* of
   step 11, which are its `[[Fragments]]`.
10. If *edited* is false, the selection is none. Otherwise let *old* be the effective patterns
    (§8.6) of the own list as of *C*, its `use` expanded with the Presets of the Configuration now
    (with `config.[[DefaultPresets]]` now when that list has no `use`);
    if a name of that `use` is not a Preset now, or a pattern of *old* does not parse (§8.1), the
    selection is none. Otherwise let *before* be `Select(old, U)` and *after* be
    `result.[[Resolved]]`, where *U* is the Universe now (§7) without `result.[[File]]`. The
    selection is, in path order, a SelectionChange `added` for each path of *after* that is not in
    *before*, and `removed` for each path of *before* that is not in *after*.
11. Let *fragments* be empty, and, for each Selected Dependency *e* of `result.[[Selected]]` in the
    order of §10.4 step 3, add a FragmentChange { `e.[[Path]]`, `e.[[Select]]`, *status*,
    `[[Parts]]` as §5.4 defines it from the Parts of *now* } as follows. Let *now* be the Fragment
    of `Fragments(e, text)` (§8.7) on the file in the work tree, read as §10.4 step 3 reads it. Let
    *old* be the output of `git show <C>:./<path>` run in Root as step 1 does, with CR LF read as
    LF. Let *then* be the Fragment of `Fragments(e, old)` (§8.7) with the Plugins of now, its warnings
    ignored, or none if that `git`
    command fails, *old* holds a NUL in its first 8192 bytes, or `Fragments` raises. *status* is
    `new` if *then* is none; `changed` if *then* is not equal to *now* (the same number of Parts,
    and the same `[[Content]]` in the same order; `[[Focus]]` and `[[Lines]]` are never compared);
    otherwise nothing is added.

NOTE: Step 10 resolves the old list against the Universe of now, not of *C*: a file deleted since
*C* cannot be resolved, so it is never in the selection (it is a `deleted` Change when the edited
list still selects it, step 4), and a file added since *C* that both lists select is in neither
side. The selection reads no history beyond the own list at *C* and no file content: it answers
"which files does this list edit add or drop today", which an `added` or `deleted` Change does not,
since a file that entered the selection unchanged is no Change. A path can be both a Change and a
SelectionChange.

NOTE: Step 11 runs a Plugin (user code, §8.7 NOTE) on the old text, in the host, as the verdict
does on the new. It lists what a reviewer must look at, and never changes a state or a Hash. Its
limits: the old text is the stored one, so the `hash:` line of an inline file (§10.2 step 4) is not
removed from it; and step 1.4 reads String patterns only, so a Selected Dependency added to the own
list since *C* is `new` only when its file or its part did not exist at *C*, and is otherwise
absent from `[[Fragments]]`.

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
   For each *g* of *globs*, let its *scope* be its segments before the first one that holds `*`,
   `?`, `[` or `{`, joined with `/` (the empty String for `**/src/**`), and *sel*(*g*) be
   `Select(« g », U)`; its *exclusions* are, in this order, those of `!`*s*`**/*.test.*`,
   `!`*s*`**/*.spec.*`, `!`*s*`**/__test__` and `!`*s*`**/__tests__` that match a file of
   *sel*(*g*), *s* being the scope followed by `/`, or nothing when the scope is empty; and none if
   some segment of *g* is one of the names above, or if every file of *sel*(*g*) is matched by one of
   them (a glob that selects only test files).
10. *Subsumption.* Let *cuts* be the exclusions of every member of *dirs* and of *globs*, ordered
   by the path order of the directory or scope they come from and, for one, in the order of step 9,
   without duplicates, and without `!`*s*`/`*t* for a non-empty *s* when `!`*t* is also one of
   them, *t* being one of `**/*.test.*`, `**/*.spec.*`, `**/__test__` and `**/__tests__`:
   `!**/*.test.*` already matches every file that `!packages/**/*.test.*` matches. Let *reincluded* be the members of *files* that a member of *cuts* matches
   (with step 9, the files below a member of *dirs* that remain), and *base* the other members of
   *files*, *dirs* and *globs*. Let
   *sel*(*p*) be `Select(« p », U)`. Remove from *base* every *p* for which another member *q* of
   *base* has *sel*(*p*) ⊆ *sel*(*q*), and either *sel*(*q*) ⊄ *sel*(*p*) or *q* precedes *p* in
   path order; every *p* is tested against *base* as it was before this step.
11. *Order.* The Suggestions are, first, the members *p* of *base* in path order, each with
   `[[Files]]` `Select(« p » followed by cuts, U)`; then
   one Suggestion for each of *cuts* in order, with `[[Files]]` the files of *U* that it matches;
   then the members *p* of *reincluded* in path order, each with `[[Files]]` « *p* ».

NOTE: A proposal is the list one would write by hand from what the doc says, and it is a proposal
only: nothing is read from the repository history, no pattern is judged too broad, and the doc is
not evaluated. Every non-excluding Suggestion selects a file of *U*, so the list passes §8.5 step 3
as written, and an exclusion matches a file of *U*, so it raises no `W_EMPTY_EXCLUSION`; the only
inclusions after an exclusion are literal paths of single files, so it raises no
`W_SHADOWED_EXCLUSION` either (§8.5 step 7). Under the
last-match-wins rule of §8.4, an exclusion written before an inclusion that selects the same file
would be cancelled by it; steps 10 and 11 write every exclusion after every inclusion, so the
written list selects exactly the `[[Files]]` of its inclusions. The only patterns after the
exclusions are the files of *reincluded*: a file the doc names that an exclusion matches, such as a
test file it mentions, is named alone and selects only itself. Step 10 drops an inclusion that
another one covers, such as `packages/*` under `packages`, so the list has no redundant pattern;
of two that select the same files, the first in path order is kept. A Suggestion
for an exclusion has no files of its own: its `[[Files]]` are the files it matches. A mention in a
fenced block, in the inline block or of an ignored path is never proposed. A glob keeps a generic
file it happens to select. A glob that selects test files gets the exclusions of step 9 for its
scope, its literal leading segments: `packages/*/src` gets `!packages/**/*.test.*`, and `**/src/**`,
which has none, gets `!**/*.test.*`. Since every exclusion follows every inclusion, such an
exclusion also trims the test files of the other inclusions; a test file the doc names is still
listed after it. The notion of a test file is the one of step 9: a name with `.test.` or `.spec.`,
or a path through `__test__` or `__tests__`; a file under a `test` or `tests` directory with
neither is not excluded. A literal path whose name has a `,`, `]` or `}` is not a valid Pattern
as written and is dropped.

### 12.7 Renamed Path

`RenamedTo(root, path, universe)`, for a literal path *path* (§8.5 NOTE) that is not in *universe*,
returns the RepoPath of a file of *universe* that git shows *path* was renamed to, or *none*. It is
used only to word the `[[Message]]` of `E_EMPTY_PATTERN` (§8.5 NOTE).

1. Run `git` in Root as §12.3 step 1 does. If `git` is unavailable, Root is not inside a git work
   tree, the repository is shallow (`git rev-parse --is-shallow-repository` prints anything but
   `false`), or a command fails, return *none*. Every command that names *path* is run with
   `--literal-pathspecs` before the subcommand.
2. If `git ls-tree -z HEAD -- <path>` lists *path* with mode `100644` or `100755`, let *base* be
   `HEAD` and *object* its object name: the rename is not committed yet.
3. Otherwise let *C* be the output of `git log -1 --format=%H -- <path>` without its line end, the
   last commit that changed *path*, which deleted it; if it is empty, return *none*. Let *base* be
   `<C>^` and *object* the object name of *path* in `git ls-tree -z <C>^ -- <path>`, of mode
   `100644` or `100755`; if there is none, return *none*.
4. Let *tracked* be the paths of `git ls-tree -r -z <base>`, and *candidates* the files of
   *universe* of kind *file*, in path order, that are not *path*, not in *tracked* and hold no LF.
   If there is none, return *none*.
5. Let *after* be the object names that `git hash-object --stdin-paths` prints for *candidates*,
   given as in §12.3 step 8. Return the first of *candidates* whose object name is *object*, or
   *none*.

NOTE: As in §12.3 step 8, a file is renamed only when its content at the new path is exactly the
content git stored at the old one, so the answer reads no similarity score and no git
configuration of rename detection and is the same on every host with the same history and work
tree. A renamed file that was also edited is not traced, nor one whose new path is ignored. The
answer never changes the selection, a Diagnostic code, the Diagnostic order, a verdict or an exit
code, and any failure is *none*, silently.
