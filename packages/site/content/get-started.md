---
title: Get started
---

# Get started

docstamp needs Node.js 24 or newer.

```sh
pnpm add -D docstamp      # or run it with npx docstamp
npx docstamp help start   # the same walk-through, offline
```

## 1. Declare what each doc depends on

Write `docstamp.yaml` at the repository root. A directory selects every file under it, and `!`
removes files again (here, generated ones):

```yaml
# yaml-language-server: $schema=https://unpkg.com/docstamp/schema.json
version: 2
files:
  CLAUDE.md:
    dependencies:
      - src
      - package.json
  README.md:
    dependencies:
      - src/cli
  docs/architecture.md:
    dependencies:
      - src/core
      - "!src/core/generated"
```

::: tip No configuration file
A Markdown doc can declare its own dependencies in its frontmatter instead, with no configuration
file and no lock. See [Declare dependencies](/guide/declare#in-the-doc-itself).
:::

## 2. Record a baseline

The first run has no lock, so every doc is stale. Read each doc against its dependencies once, then
record the baseline and commit `docstamp-lock.yaml`:

```console
$ docstamp
STALE    CLAUDE.md  (unrecorded)
  depends   src
  depends   package.json
STALE    README.md  (unrecorded)
  depends   src/cli
STALE    docs/architecture.md  (unrecorded)
  depends   src/core
  depends   !src/core/generated
0 ok, 3 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md README.md docs/architecture.md
  run update only after the review, never --all just to pass; see docstamp help agents
$ docstamp update --all
written  CLAUDE.md
written  README.md
written  docs/architecture.md
$ docstamp
3 ok, 0 stale, 0 invalid
```

## 3. Let it catch drift

Later, a commit changes `src/cli/run.ts` and `src/core/generated/types.ts`, and reformats
`src/index.ts`. `docs/architecture.md` stays `ok`: the only core file that changed is excluded.

```console
$ docstamp
STALE    CLAUDE.md  (content-changed)
  modified  src/cli/run.ts
  modified  src/core/generated/types.ts
  modified  src/index.ts (whitespace only)
  review: git diff -M 260bd0a3cbed145f3afa9ec3db9c02f1d30f0360 -- src/cli/run.ts src/core/generated/types.ts src/index.ts
STALE    README.md  (content-changed)
  modified  src/cli/run.ts
  review: git diff -M 260bd0a3cbed145f3afa9ec3db9c02f1d30f0360 -- src/cli/run.ts
1 ok, 2 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md README.md
  run update only after the review, never --all just to pass; see docstamp help agents
```

Review each stale doc against the listed files, fix what is no longer true, then run
`docstamp update CLAUDE.md README.md` and commit the lock. Exit codes: 0 ok, 1 stale, 2 error.

## Next

- [Review a stale doc](/guide/review): reading the report, and the rule that keeps the gate honest.
- [Run it in CI](/guide/ci): the GitHub Action, or a plain workflow.
- [Declare dependencies](/guide/declare): narrow lists, presets, parts of JSON and YAML files.
