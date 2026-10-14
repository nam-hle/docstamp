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
committed in the same commit as `docstamp update` makes the doc stale but is not listed.

## Resolve a merge conflict in the lock

The lock has one line per doc, so branches that update different docs usually merge cleanly, and the
merged lock is then still honest: a doc whose dependencies changed on the other branch reports stale
after the merge. Git treats changes to neighbouring lines as a conflict, so two different docs next
to each other in path order can conflict too. A conflict on one line means the same doc was updated
on both sides. To resolve it:

1. Take either side of `docstamp-lock.yaml` (or the merge base), never a hand-picked mix, and never
   edit a hash: `git checkout --ours docstamp-lock.yaml`, then `git add docstamp-lock.yaml`.
2. Run `docstamp`. It reports exactly the docs whose dependencies changed since the hash that is now
   recorded. Until the file parses, it exits 2 with `E_LOCK`.
3. Review each stale doc as above, then run `docstamp update <doc>` for each by name. Never use
   `--all` to turn the check green.

Taking either side is safe because a doc's verdict compares the recorded hash with the hash of its
dependencies now ([SPEC §12.1](/spec/evaluation#121-evaluate)): a recorded hash that is not the
current one can only make the doc stale, never hide a change. The cost is a repeated review of a doc
whose line was dropped.

An inline declaration keeps its hash in the doc's own frontmatter, so the conflict is in the doc.
Resolve the text as usual, keep either `hash:` value, then run `docstamp` and review in the same way
([SPEC §11.2](/spec/lockfile#112-canonical-form)).

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
