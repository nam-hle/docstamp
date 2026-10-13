---
title: Review a stale doc
---

# Review a stale doc

`docstamp` exits 1 when a doc's dependencies changed since its last review. The report names the doc,
the changed files and the command that resolves it. The review itself is not docstamp's job: a
person or an agent reads the changed files against the doc, fixes what is no longer true, and only
then records the review.

1. Read the changed files the report lists (the `review:` line is a read-only `git diff` for them).
2. Fix every claim in the doc that is no longer true.
3. Run `docstamp update <doc>`, and commit the lock (or the doc, for an inline declaration). It
   first prints `changed since last review:` and the changed files, so the review input is on
   screen when the review is recorded, or a note when no dependency differs
   ([SPEC §13.6](/spec/command-line#136-update)).

::: warning Never skip the re-check
`docstamp update` writes the lock: it records that a review happened, and nothing can verify that.
Never run it without the re-check, and never use `--all` to make the check pass.
:::

## Reading the report

- **`review:`** is a read-only git command showing the change since the last `update`: the work tree
  against that commit, so uncommitted edits count, and `-M` shows renames. Over 10 changed files it
  gives a pathspec of the patterns instead.
- **Untracked files** need `git add -N` to appear in a diff, so the report adds an
  `untracked: git add -N -- <path>` line. docstamp never runs it, since it changes the index.
- **`(whitespace only)`** is git's judgement, to help you skim. It never changes the verdict.
- **Renames** are one `renamed  <old> -> <new>` line, and long lists are summarised
  ([SPEC §14.3.1](/spec/output#1431-change-lines)).
- **An edited list.** When the doc's own list was edited since the review, an `edited` line names the
  file holding it, and `(selection)` lines show files the edit added or removed. A script
  configuration (`docstamp.config.ts`) is never run at an old commit, so its list is not compared:
  the `edited` line then names the script as `(configuration, may concern other files)` when it
  differs from the review commit, and the `review:` line includes it.
- **No history.** Without usable git (no work tree, a shallow clone), the report prints the
  `depends` patterns instead. Diff the files of `docstamp list-dependencies <doc>` yourself.

The states and reasons are in the [states topic](/reference/topics/states). `--json` gives the same
content as data ([json topic](/reference/topics/json)).

## Commit the lock separately from the edits

The changed-file list is the difference from the commit that introduced the lock entry. An edit
committed in the same commit as `docstamp update` makes the doc stale but is not listed. Two branches
that update the same doc conflict on that doc's line in the lock: take either side, run `docstamp`,
review what it reports stale, and update again ([SPEC §11.2](/spec/lockfile#112-canonical-form)).

## With AI agents

An agent is usually the one that reads the failure and does the review. The stale report ends with a
line that points at `docstamp help agents`, which prints the workflow ([agents topic](/reference/topics/agents)).
Put this paragraph in your `CLAUDE.md` or `AGENTS.md`:

```md
## Docs

`docstamp` fails when a doc's dependencies changed since it was last reviewed. When it fails, for each stale doc: read the changed files it lists (`git diff` if more context is needed), compare them with what the doc claims, and fix every claim that is no longer true. Only then run `docstamp update <doc>`. Never run `docstamp update` without that re-check, and never use `--all` to make the check pass.
```

Before changing code, `docstamp list-dependents <file>` shows which docs the change affects, so the
agent can update them in the same change:

```console
$ docstamp list-dependents src/cli/run.ts
src/cli/run.ts
  CLAUDE.md   via src
  README.md   via src/cli
```

`docstamp list-dependencies <doc>` shows what a doc depends on and which files the patterns select,
without reading the lock:

```console
$ docstamp list-dependencies docs/architecture.md
docs/architecture.md
  depends   src/core
  depends   !src/core/generated
  resolved  src/core/hash.ts
```

File arguments resolve against the working directory: the current one, or `--cwd <dir>`, which runs a
command as if from that directory ([commands](/reference/commands/check)).
