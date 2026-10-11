---
layout: home
title: docstamp
hero:
  name: docstamp
  text: Docs that know when they went stale
  tagline: docstamp fails CI when code a doc depends on changed since the doc was last reviewed, and names the doc and the changed files, deterministically.
  actions:
    - theme: brand
      text: Get started
      link: /get-started
    - theme: alt
      text: How it works
      link: /guide/review
features:
  - title: Deterministic
    details: Content hashes, no LLM and no network. Rebases and squashes never change a verdict.
  - title: Tells the reviewer what to read
    details: The failure lists the changed files and a git diff command. Whitespace-only edits and renames are flagged.
  - title: Works for AI agents
    details: The failure ends with an agent rule, and docstamp help agents is the whole review workflow.
  - title: Measurable
    details: docstamp stats shows how noisy a dependency list is before you adopt it, and docstamp suggest drafts the list.
  - title: Documents itself
    details: docstamp help works offline, with every command, topic and diagnostic.
  - title: CI-ready
    details: Exit codes, --json and a GitHub Action. One runtime dependency, yaml.
---

## The idea

A doc (`README.md`, `CLAUDE.md`, `AGENTS.md`, an ADR, a runbook) makes claims about code. When the
code changes, nobody notices that the claims are now wrong. docstamp turns "someone should re-read
that doc" into a build failure that says which doc to re-read, and against which changes.

1. Declare what `docs/auth.md` depends on, in its own frontmatter:

   ```md
   ---
   docstamp:
     dependencies: [src/auth]
   ---
   ```

2. Someone changes `src/auth/session.ts`.
3. CI runs `docstamp` and fails:

   ```console
   $ docstamp
   STALE    docs/auth.md  (content-changed)
     modified  src/auth/session.ts
     review: git diff -M d3765b5b11478412d3da6c714ed3586d6d9d6c12 -- src/auth/session.ts
   0 ok, 1 stale, 0 invalid
   next: review each stale file against its dependencies, then run: docstamp update docs/auth.md
     run update only after the review, never --all just to pass; see docstamp help agents
   ```

A person or an agent re-reads the doc, fixes it, runs `docstamp update docs/auth.md`, and CI passes.

## Where to go

- New here: [Get started](/get-started).
- Writing the dependency lists: [Declare dependencies](/guide/declare).
- A check failed: [Review a stale doc](/guide/review).
- Wiring it into a repository: [Run it in CI](/guide/ci).
- Looking something up: the [Reference](/reference/) and the [Specification](/spec).
