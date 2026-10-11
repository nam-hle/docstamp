---
title: Reference
---

# Reference

The reference is the CLI's own help, built from `docstamp help` when this site is built, so it is
always the text of the release it describes. The same pages work offline: `docstamp help` lists
them.

## Commands

| Command | What it does |
| --- | --- |
| [`docstamp [check]`](/reference/commands/check) | The verdict. A bare `docstamp` is `check`. |
| [`docstamp update`](/reference/commands/update) | Record that you reviewed the named files. The only command that writes the lock. |
| [`docstamp list-dependencies`](/reference/commands/list-dependencies) | A file's patterns and the files they select. |
| [`docstamp list-dependents`](/reference/commands/list-dependents) | The files that depend on a file. |
| [`docstamp stats`](/reference/commands/stats) | How often each file's list would have made it stale. |
| [`docstamp suggest`](/reference/commands/suggest) | Propose dependencies from the paths a doc mentions. |

Every command except `help` and `version` takes `--json` and `--cwd <dir>`.

## Topics

The topic pages are in the sidebar. The ones to know first: [exit codes](/reference/topics/exit-codes),
[states](/reference/topics/states) and [diagnostics](/reference/topics/diagnostics), which explains
every error and how to fix it.

## The specification

The pages above summarize; the [specification](/spec) decides. It is split into one page per
section, and every page keeps the clause numbers that the code and tests cite.
