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

`stale` is commits divided by the commits of the window. A `sweep` near 1 means the noise is a few
repository-wide commits, not the list. The window is `--since <n>d` (default `30d`) or
`--from <rev>`. It needs full history: a shallow clone is `E_HISTORY`
([stats](/reference/commands/stats), [SPEC §13.9](/spec/command-line#139-stats)).
