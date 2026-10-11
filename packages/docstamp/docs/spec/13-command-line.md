## 13 Command Line

### 13.1 Synopsis

```
docstamp [check] [--json] [--only-stale] [--quiet] [--cwd <dir>] [<file>...]
docstamp update [--json] [--cwd <dir>] (--all | <file>...)
docstamp list-dependencies [--json] [--cwd <dir>] [<file>...]
docstamp list-dependents [--json] [--transitive] [--cwd <dir>] <file>...
docstamp stats [--json] [--cwd <dir>] [--since <n>d | --from <rev>] [<file>...]
docstamp suggest [--json] [--cwd <dir>] [--write] <file>...
docstamp help [<command> | <topic> | diagnostics <code>]
docstamp <command> --help
docstamp version
docstamp --help
docstamp --version
```

The commands are `check` (§13.5), `update` (§13.6), `list-dependencies` (§13.7),
`list-dependents` (§13.8), `stats` (§13.9), `suggest` (§13.10), `help` (§13.11) and `version`.
`--help` is the same command as `help`, and `--version` the same as `version`. `-h` is the same
option as `--help`, wherever `--help` is written.

### 13.2 Parsing

The command line is parsed before anything else.

1. The options are `--json`, `--all`, `--transitive`, `--only-stale`, `--quiet`, `--write`, `--help` (also written `-h`: below, `--help` stands for both), `--version`, and the options with a value, each
   written `--name <value>` or `--name=<value>`: `--cwd`, `--since` and `--from`. Before any `--`, an argument starting with `-` other than a lone `-` is an
   option; an option with a value consumes the next argument as its value, unless that argument is
   `--` or another recognised option (including itself), which is a missing value. After `--`, every argument is a file argument.
2. The *first non-option argument* before any `--` is the command name if it is `check`, `update`,
   `list-dependencies`, `list-dependents`, `stats`, `suggest`, `help` or `version`; it is then not a file argument. Otherwise, if it
   is not an existing entry (any kind, not followed) at the path it resolves to against the
   current directory of the process (parsing comes before `--cwd` applies), and a command name is at edit distance 1 or 2 from it (the
   distance of the §9.3 NOTE), it is a *mistyped command*: raise « `E_USAGE` », `[[Subject]]` that
   argument, whose message names the first such command name at the smallest distance, in the
   order above, and says that a file of that name is reached after `--` (`Unknown command "updte";
   did you mean "update"? ...`). Otherwise, and when there is none, the command is `check` and that
   argument stays a file argument. A command word in any later position, or after `--`, is a file
   argument. Options and file arguments may appear in any order.
3. `--help` before any `--`, or the command `help`, selects `help`; `--version` or the command
   `version` selects `version`. `help` wins over `version`. The *help names* are the file
   arguments when the command is `help`; else, when step 2 found a command word, that word alone
   (so `docstamp update --help` names `update`); else none. Both ignore every other argument,
   options included, and raise no `E_USAGE` here; `help` checks its names itself (§13.11). A
   mistyped command (step 2) is raised before this step, so `docstamp updte --help` and
   `docstamp updte --version` are `E_USAGE` too, never the index.

Otherwise the following raise « `E_USAGE` » with `[[Subject]]` the offending argument, and exit 2.
Each message states the problem:

- an unknown option, a missing value for an option with a value (none, empty, `--`, or a
  recognised option, so `--cwd --json` is an error), or an option given twice;
- `--write` with any command but `suggest`, `--files` and `--root`, which were removed: the message
  names the replacement, `docstamp update` for `--write`, `docstamp list-dependencies` for
  `--files` and `--cwd` for `--root`, which also resolves file arguments (§13.4);
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

`help` prints help (§13.11) and `version` prints the version; both exit 0 (§14.1), except a
`help` name that is not known (§13.11). A file named like a command is reached as
`docstamp check -- check`, `docstamp -- check` or `docstamp --json -- check`, and a file named
like a mistyped command that does not exist yet as `docstamp -- updte`.

NOTE: The mistyped command of step 2 is the one place where parsing reads the file system: one
`lstat` of the first non-option argument, made only when that argument is near a command name. An
existing path keeps meaning a file, so `docstamp stat` checks a stamped file named `stat` as
before; only an argument that names nothing on disk, which `check` could only refuse with
`E_UNKNOWN_FILE` or `E_USAGE` (§13.3), is read as a command typed wrong. The rule does not
apply after `--`, nor to a command word in a later position.

### 13.3 File Arguments

`SelectResults(args, cwd, root, results)` returns the selected Results or raises:

1. If *args* is empty, return *results*.
2. Let *problems* be an empty List. For each *arg*: let *path* be `ToRepoPath(arg, cwd, root)`.
   If that fails, collect `E_USAGE` with `[[Subject]]` *arg* into *problems*, its `[[Message]]`
   saying how *arg* was resolved, as §13.8 step 3 does. Otherwise, if no Result has `[[File]]`
   equal to *path*, collect `E_UNKNOWN_FILE` with `[[Subject]]` *arg* into *problems*.
3. If *problems* is not empty, raise *problems*.
4. Return the Results whose `[[File]]` was named, in path order without duplicates.

NOTE: A bad file argument raises, as a usage error does: nothing is reported for the good
arguments. A command line that cannot be answered in full is answered with its Diagnostics only.

### 13.4 Path Resolution

The *working directory* of a command is `ResolveCwd(processCwd, --cwd)`, the directory the command
acts as if it ran in. In §13.3 and §13.5 to §13.10, *cwd* is that directory, computed before
anything else of the command, so its `E_CWD` comes first; §6 searches from it and file arguments
resolve against it.

1. If `--cwd` is absent, return *processCwd*.
2. Let *dir* be the value joined to *processCwd* unless it is absolute, with `.` segments removed
   and `..` segments resolved textually, as in `ToRepoPath` step 2.
3. If *dir* is not an existing directory, raise `E_CWD`.
4. Return *dir*.

`ToRepoPath(arg, cwd, root)` is lexical: no symbolic link is resolved and no file system access
happens.

1. On Windows, replace every `\` in *arg* by `/`.
2. Join *arg* to *cwd* unless it is absolute, and remove `.` segments and resolve `..` segments
   textually.
3. If the result is not *root* followed by `/` and at least one segment, fail.
4. Return the remainder after *root* and `/`, converted to NFC. Fail if it is not a RepoPath.

No case folding is applied: the argument must equal the key under `files`, or the RepoPath of an
inline file.

When `ToRepoPath` fails, the argument is wrong for this working directory and Root, whatever
file it names: every command raises `E_USAGE` for it (§13.3 step 2, §13.8 step 3, §13.10 step 2).
`E_UNKNOWN_FILE` is only for an argument that resolves inside Root to a file that is neither
declared nor carries an inline block.

### 13.5 Check

1. Let *root* be `? DetermineRoot(cwd)`.
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

1. Let *root* be `? DetermineRoot(cwd)`.
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

1. Let *root* be `? DetermineRoot(cwd)`.
2. Let (*config*, *attached*, *present*) be `? ReadConfig(root)`, *universe* be
   `? ComputeUniverse(root, config)`, and (*declarations*, *attached*, *marked*) be the Declarations
   and attached Diagnostics of steps 3 to 5 of §12.2.
3. Let *results* be `Evaluate(b, universe, « », attached of b, « »)` for each Declaration *b* of
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

1. Let *root* be `? DetermineRoot(cwd)`.
2. Let (*config*, *attached*, *present*) be `? ReadConfig(root)`, *universe* be
   `? ComputeUniverse(root, config)`, and (*declarations*, *attached*, *marked*) be the Declarations
   and attached Diagnostics of steps 3 to 5 of §12.2.
3. If `ToRepoPath(arg, cwd, root)` fails for any file argument *arg*, raise « `E_USAGE` with
   `[[Subject]]` *arg* » for each such *arg*; no entry is output. Its `[[Message]]` says how *arg*
   was resolved: against the working directory *cwd*, to which absolute path (step 2 of §13.4),
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

Text mode (§14.7) prints instead `DirectFirstTree(path)`, the same walk with the direct dependents
reserved for the first level: *expanded* starts as the Set of the files of *found(path)*, a node
of the first level is always built by step 3 (its file is already in *expanded*), and a repeated
node (step 2) whose file is one of *found(path)* also has `[[Below]]` true when the first-level
node of that file is not yet built, that is, when it comes later in the order of *found(path)*;
every other node has `[[Below]]` false. JSON (§14.5) outputs `DependentTree(path)`, unchanged.

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
or the Lockfile is not unknown: it has no dependents and no warning.

NOTE: `--transitive` only reports the chains: it changes no verdict, Hash or exit code, and a
change in a file still makes only its direct dependents `stale` (§12.2 NOTE); the chains show which
files become stale in later rounds, one Review at a time. A *cycle* is a node whose file is on its
own chain, the argument included: it is listed once, marked, and not followed. A file reached again
by another chain that is not a cycle (*repeated*) is listed, marked, and not followed again, so the
output is finite and its size at most the number of stamped files per argument. The order is the
path order of §13.8 step 4.2 at each level, depth first, so it is deterministic. There is no depth
option.

NOTE: `DirectFirstTree` exists so that a text tree read top-down never hides a direct dependent:
with A depending on the argument, B on A, and C on both the argument and B, `DependentTree` expands
C below B and marks C repeated at the first level, which reads as if C did not depend on the
argument directly. Text mode shows C in full at the first level and marks the deeper C below B as
listed below. The JSON nodes keep their shape and values (§17.3).

### 13.9 Stats

Reports how often the dependencies of each file would have made it stale over the recent history,
so that a list can be judged before it is committed to. The window is `--since <n>d`, the last *n*
days, or `--from <rev>`, the commits of `<rev>..HEAD`; without either it is `--since 30d`. The
command only reports: it exits 0 whatever the numbers are. Nothing is written and no Lockfile is
read.

1. Let *root* be `? DetermineRoot(cwd)`.
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

1. Let *root* be `? DetermineRoot(cwd)`, *config* be the Config of `? ReadConfig(root)`
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
   Let its *declared* be the `dependencies` of its configured Declaration (`[[Declarations]]` of
   *config*) if it has one; otherwise, if *path* is a candidate (§9.6.1) and `ScanFrontmatter` of
   its text is not *none*, the `[[Dependencies]]` of the Declaration that `ParseBlock` (§9.6.2)
   returns, even when it raises (so « » when they are not a List of Strings); otherwise *none*.
   *declared* is read from the text before step 7 writes, never expands Presets (§8.6), and
   raises nothing. When *declared* is not *none*, let *selected* be `Select(P, U)` (§8.4), *P*
   being the elements of *declared* that are valid Patterns (§8.1) in order and *U* the Universe
   without *path*, and give each Suggestion a *status*: `declared` if its pattern is in *declared*
   (String equality, §3.2); otherwise `covered` if its pattern has no Negation, its `[[Files]]` is
   not empty and every one of them is in *selected*; otherwise `new`. When *declared* is *none*,
   no Suggestion has a *status*.
5. Let *window* be `Replay(root, days 30, now)` (§12.4), *now* being the wall-clock time; if it
   raises, or the Window has no Commit, let *window* be *none*: no Diagnostic is output for it.
6. For each Suggestion of each file whose pattern has no Negation, let its *staleRate* be the
   `[[StaleRate]]` that `Statistics` (§12.5) gives it for the Result with `[[Resolved]]` its
   `[[Files]]`, or *none* if *window* is *none*. The *staleRate* of every other Suggestion is *none*.
7. If `--write` is given, then for each *path* whose *suggestions* is not empty, let *patterns* be:
   the patterns of *suggestions* in order when *declared* is *none*; otherwise the elements of
   *declared*, then the patterns of the Suggestions whose *status* is `new`, in order, without:
   1. a Suggestion with a Negation that matches (§8.3) a file of `Select(P, U)`: written after
      *declared*, it would deselect a file *declared* selects;
   2. a Suggestion without a Negation whose pattern *p* is not a literal path (§8.5 NOTE) of a
      file of *U*, when an
      exclusion of *P* matches a file of `Select(« p » followed by the patterns with a Negation
      that item 1 keeps, U)`: written after that exclusion, it would select that file again;
   3. then, if every pattern so added has a Negation, all of them: an exclusion is proposed only
      with the inclusions it trims.

   Let *new* be `? WriteBlock(text, patterns)` (§9.6.5).
   Only if no step has raised, replace each *path* whose *new* differs from its text atomically, as
   §9.6.4 step 3 does; it is then *written*, and every other file is not.
8. Output the Suggestions, *ignored*, *declared* and, with `--write`, which files were *written*
   (§14.9, §14.5), and exit 0.

If a step raises, output the raised Diagnostics as global and exit 2; with `--write` nothing was
written then, except that a failure to replace a file (`E_UNREADABLE`) in step 7 leaves the files
replaced before it replaced.

NOTE: A block that records a `hash` is never overwritten by this command, nor is a configured
Declaration: both are the result of a decision, and the message says to edit them by hand. A block
without a `hash` keeps every pattern it declares, in its order, and only gains `new` ones after
them (§9.6.5 steps 2.4 and 2.5): `--write` never drops a declared pattern, never adds one whose
files *declared* already selects (`covered`), and leaves out an addition that would change what
the declared patterns select: an exclusion that would deselect one of their files, or a pattern
other than a literal path that would select again a file a declared exclusion cuts (step 7.2), so
the written list raises no new `W_SHADOWED_EXCLUSION` (§8.5 step 7). Such a Suggestion keeps its
*status* `new` in the output; the block is the place to add it by hand. `suggest --write` twice
gives the same bytes: after the first write every Suggestion is `declared`, `covered` or left out
again (§12.6 step 1 never reads the block). A file with no Suggestion is not written: a block
needs a dependency. The
`staleRate` follows §12.5 with the caveat of its NOTE: dependencies are the ones of `HEAD`, and a
proposal that names a file the window deleted cannot see it. A file literally named `suggest` is
reached as `docstamp -- suggest` (§13.2).

NOTE: *declared* makes a proposal for a file that already has a declaration read as a difference:
a Suggestion whose pattern is in *declared* (String equality, §3.2) is already declared, one whose
files the declared patterns already select is covered, any other is new, and a pattern of
*declared* that no Suggestion has is only declared: the doc no longer mentions it, or mentions it in
another form. Patterns are compared as written for `declared`, so `src` and `src/**` differ; `covered`
compares the files they select, so a proposed `src/a.ts` is covered by a declared `src/**/*.ts`.
An exclusion is never `covered`.

### 13.11 Help

Everything needed to use docstamp is reachable from the command line, without the repository or
a network. `help` reads no file and no Root; it prints to standard output and exits 0:

1. With no help name (§13.2 step 3): the *index*: what docstamp is for, each command with its
   synopsis and one line, each *topic* with one line, and how to ask for a page.
2. With one name that is a command of §13.1: the *command page*: its synopsis, every option the
   command accepts (§13.2), what it reads and writes, examples, its exit codes and related
   commands.
3. With one name that is a topic: the *topic page*. The topics are `start` (from nothing to a
   first passing check, with a configuration file or inline), `config`, `inline`, `patterns`,
   `presets`, `states` (states and Reasons, §5.4, §12.1), `exit-codes` (§16), `json` (§14.5),
   `diagnostics` (every code of §15, its meaning and its fix), `agents` (the review workflow of
   §1, ready to paste into an agent's instructions), `schema` (the JSON Schemas the package ships)
   and `spec` (where this document is, and its sections).
4. With the two names `diagnostics` and a code of §15 in any letter case (`e_usage` names
   `E_USAGE`): the entry of that code alone, which names the code as §15 writes it.

Any other help names raise « `E_USAGE` », `[[Subject]]` the first name that is not known, whose
message lists the names that are; it is written as §14.3 writes a Diagnostic, and the exit code is
2. The text is informative (§2), but it is pinned by tests: every command has a page that names
every option it accepts, every code of §15 has an entry in `diagnostics` and no other code does,
and an example that shows output shows what the command prints on a fixed tree.

Help is plain text: LF line endings, no color, no line longer than 100 characters, no absolute
path. The package ships this document as `docs/SPEC.md`, so `help spec` can name it offline.
