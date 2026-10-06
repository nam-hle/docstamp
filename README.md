# docsync

A deterministic snapshot gate between files and the files that depend on them, built first for docs and the code they describe. Each doc declares the code it covers; `docsync` fails CI when that code changed since the doc was last reviewed, with no LLM call and no git invocation. See [docs/VISION.md](docs/VISION.md) for the motivation.

## Install

```sh
pnpm add -D docsync
```

Requires Node.js 24 or newer.

## Configure

Bind each Dependent to the files it covers in `docsync.yaml` at the repository root ([SPEC §9](docs/SPEC.md#9-configuration-file)):

```yaml
version: 1
dependents:
  CLAUDE.md:
    covers:
      - src/**
      - "!src/**/*.test.ts"
      - package.json
  tests/fixtures/user.json:
    covers:
      - schemas/user.schema.json
```

Pattern syntax is in [SPEC §8](docs/SPEC.md#8-patterns).

## Workflow

The three steps are defined in [SPEC §1](docs/SPEC.md#1-scope):

1. CI runs `pnpm exec docsync`. It exits 1 when a Dependent's covered files changed since its last review.
2. A person or an agent reviews each stale Dependent against its covered files and edits it if needed.
3. Run `pnpm exec docsync --write <file>` to record the review in `docsync.lock`, and commit the lock.

The first run has no lock; `pnpm exec docsync --write --all` records the initial state once the docs have been reviewed.

## Reviewing a stale doc

List what to look at, then diff only those files against the base branch:

```sh
pnpm exec docsync --files <file>
git diff <base> -- <files>
```

Command line and exit codes: [SPEC §13](docs/SPEC.md#13-command-line) and [SPEC §16](docs/SPEC.md#16-exit-codes).

## Lock conflicts

Two branches that write the same Dependent conflict on its `hash` line. Resolution is in [SPEC §11.2](docs/SPEC.md#112-canonical-form).

## Specification

[docs/SPEC.md](docs/SPEC.md) is the contract for all observable behavior.
