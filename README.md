# docstamp

A deterministic snapshot gate between files and the files that depend on them, built first for docs and the code they describe. Each doc declares the code it covers; `docstamp` fails CI when that code changed since the doc was last reviewed, with no LLM call. The verdict never depends on git. See [docs/VISION.md](docs/VISION.md) for the motivation.

## Install

```sh
pnpm add -D docstamp
```

Requires Node.js 24 or newer.

## Configure

Bind each Dependent to the files it covers in `docstamp.yaml` at the repository root ([SPEC §9](docs/SPEC.md#9-configuration-file)):

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

1. CI runs `pnpm exec docstamp`. It exits 1 when a Dependent's covered files changed since its last review.
2. A person or an agent reviews each stale Dependent against its covered files and edits it if needed.
3. Run `pnpm exec docstamp update <file>` to record the review in `docstamp-lock.yaml`, and commit the lock.

The first run has no lock; `pnpm exec docstamp update --all` records the initial state once the docs have been reviewed.

Upgrading from a version 1 lock (`docsync.lock`): delete it, review every Dependent, then run `pnpm exec docstamp update --all` ([SPEC §11.1](docs/SPEC.md#111-reading)).

## Reviewing a stale doc

A stale doc lists the covered files that changed since its last review, as `modified`, `added` or `deleted` ([SPEC §12.3](docs/SPEC.md#123-changedsince)). `--json` carries the same list as `changes`. The list comes from read-only `git` calls and never affects the verdict or exit code.

When git history cannot answer (no git, not a work tree, a shallow clone, or an `update` not yet committed), docstamp prints the `covers` patterns and `changes` is `null`. Then list the covered files and diff them yourself:

```sh
pnpm exec docstamp list-dependents <file>
git diff <base> -- <files>
```

## Commands

- `docstamp [check]`: the verdict; exit 0 when every Dependent is ok, 1 when one is stale, 2 on an error. A bare `docstamp` is `check`.
- `docstamp update (--all | <file>...)`: record that you reviewed the named files.
- `docstamp list-dependents [<file>...]`: each Dependent with its patterns and covered files. It does not read the lock.
- `docstamp help` and `docstamp version`.

Every command except `help` and `version` takes `--json` and `--root <dir>`. The options `--write` and `--files` were replaced by `update` and `list-dependents`.

Command line and exit codes: [SPEC §13](docs/SPEC.md#13-command-line) and [SPEC §16](docs/SPEC.md#16-exit-codes).

## Lock conflicts

Two branches that write the same Dependent conflict on its `hash` line. Resolution is in [SPEC §11.2](docs/SPEC.md#112-canonical-form).

## Specification

[docs/SPEC.md](docs/SPEC.md) is the contract for all observable behavior.
