---
title: Tune a dependency list
---

# Tune a dependency list

A broad list is easy to write and is the one people stop reading. Two commands help you write a
better one. Both only report: neither writes the lock.

## Propose a list

`docstamp suggest <file>...` reads the docs you name and proposes their `dependencies` from the
repository paths they mention (paths in backticks, links, globs). It shows how many files each
pattern selects and the share of the last 30 days' commits that would have made the doc stale:

```console
$ docstamp suggest docs/architecture.md
suggest docs/architecture.md
  pattern                           files   stale
  config/*.yaml                         2  0.1111
  src/server/handlers                   4  0.2222
  src/server/router.ts                  1  0.2222
  src/server/schemas                    2  0.0000
  src/store/index.ts                    1  0.0000
  !src/server/handlers/**/*.test.*     -1
  ignored  dist/server.js
```

`--write` records the proposal as an inline block without a `hash`, so the doc stays `unrecorded`
until someone reviews it. Read the proposal before you keep it: a directory mention can select
hundreds of files, and a mention may be an illustration
([suggest](/reference/commands/suggest), [SPEC §12.6](/spec/evaluation#126-proposal)).

## Find paths a doc mentions but does not declare

A doc can describe a file that none of its patterns covers, so changing that file flags nothing.
`docstamp suggest --all` runs the proposal for every declared file, configured or inline, and prints
only the new ones, grouped by doc; it prints nothing when there is no gap. To fail CI on the same
gap, run `docstamp --undeclared`: it exits 1 and names the doc and the path when a doc mentions the
path of an existing file that none of its patterns covers. Directories and globs are not judged, so
a broad proposal does not fail every run. A mention of another doc that has its own declaration is a
cross-reference, so `--undeclared` skips it, and `suggest --all` still lists it. To skip more paths,
list patterns under `undeclared.ignore` in the configuration file:

```yaml
version: 2
undeclared:
  ignore:
    - LICENSE
    - docs/generated/**
files: {}
```

Both print the first 10 findings and say how many are left: fix those, then run again, or pass
`--limit <n>` for another page size (`--limit 0` prints all). `--json` is never cut
([check](/reference/commands/check), [SPEC §13.5](/spec/command-line#135-check)).

## Measure how noisy a list is

`docstamp stats` takes the files each doc resolves to today, replays the commits of a window against
them, and counts the commits that would have made the doc stale. It reads history, writes nothing
and needs no lock:

```console
$ docstamp stats --from v0.3.1
file          patterns  files  commits  days   stale   sweep
README.md            2      5        5     1  0.7143  0.0000
CLAUDE.md            8     49        4     1  0.5714  0.0000
docs/SPEC.md         1     33        3     1  0.4286  0.0000
window: 7 commits in v0.3.1..HEAD, 1 make no file stale
legend: patterns declared, files they select, commits and distinct days that would make the file stale; stale = commits / window commits; sweep = share of those commits that touch over 200 paths
```

`stale` is commits divided by the commits of the window. A selected dependency (`path:selector`)
counts as a pattern, and a commit touches it only when the selected part changed, so narrowing to a
selector shows up as a lower `stale`. A `sweep` near 1 means the noise is a few
repository-wide commits, not the list. To see which dependency drives a doc's commits, name the doc
(`docstamp stats docs/guide.md`): under the table, each of its dependencies is listed with the
commits that touch it and `only`, the commits no other dependency of the doc touches. The window is `--since <n>d` (default `30d`) or
`--from <rev>`. It needs full history: a shallow clone is `E_HISTORY`
([stats](/reference/commands/stats), [SPEC §13.9](/spec/command-line#139-stats)).
