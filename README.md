# docstamp

A deterministic snapshot gate between files and the files that depend on them, built first for docs and the code they describe. Each doc declares the code it depends on; `docstamp` fails CI when that code changed since the doc was last reviewed, with no LLM call. The verdict never depends on git. See [docs/VISION.md](docs/VISION.md) for the motivation.

## Install

```sh
pnpm add -D docstamp
```

Requires Node.js 24 or newer.

## Configure

Declare the dependencies of each file in one configuration file at the repository root ([SPEC §9](docs/SPEC.md#9-configuration-file)). Start with `docstamp.yaml`:

```yaml
version: 2
files:
  CLAUDE.md:
    dependencies:
      - src/**
      - "!src/**/*.test.ts"
      - package.json
  tests/fixtures/user.json:
    dependencies:
      - schemas/user.schema.json
```

For editor completion and validation, point the YAML language server at the schema:

```yaml
# yaml-language-server: $schema=./node_modules/docstamp/schema.json
```

### TypeScript or JavaScript

The same configuration can be a script instead: `docstamp.config.ts`, `.mts`, `.js` or `.mjs` ([SPEC §9.1](docs/SPEC.md#91-carriers)). Keep exactly one configuration file; two raise `E_CONFIG_AMBIGUOUS`.

```ts
import { defineConfig } from 'docstamp';

export default defineConfig({
  version: 2,
  files: {
    'CLAUDE.md': { dependencies: ['src/**', '!src/**/*.test.ts', 'package.json'] },
  },
});
```

The file must export plain data only ([SPEC §9.5](docs/SPEC.md#95-script-carriers)). TypeScript runs through Node's type stripping, so only erasable syntax works (no `enum`, no value `namespace`). TypeScript and JavaScript configurations were verified on Node.js 24.18.1. Evaluating the file may import other files; docstamp does not track them, so import only `docstamp`.

Pattern syntax is in [SPEC §8](docs/SPEC.md#8-patterns).

## Workflow

The three steps are defined in [SPEC §1](docs/SPEC.md#1-scope):

1. CI runs `pnpm exec docstamp`. It exits 1 when a file's dependencies changed since its last review.
2. A person or an agent reviews each stale file against its dependencies and edits it if needed.
3. Run `pnpm exec docstamp update <file>` to record the review in `docstamp-lock.yaml`, and commit the lock.

The first run has no lock; `pnpm exec docstamp update --all` records the initial state once the docs have been reviewed.

Upgrading from a version 1 lock (`docsync.lock`): delete it, review every file, then run `pnpm exec docstamp update --all` ([SPEC §11.1](docs/SPEC.md#111-reading)).

Upgrading from a version 1 configuration (`dependents` and `covers`): rename `dependents` to `files` and `covers` to `dependencies`, and set `version: 2`. Then run `pnpm exec docstamp update --all` to rewrite the version 2 lock as version 3; the hashes do not change, so first review the files with the previous docstamp version or `git diff`, because the version 2 lock stops `docstamp check` (E_LOCK_VERSION) and it reports nothing stale.

## What counts as a change

A file's content is hashed as it is, except that CR LF becomes LF in text files ([SPEC §10.2](docs/SPEC.md#102-normalized-content)). Nothing else is normalized: a changed license header, whitespace, a final newline, a lone CR, a byte order mark, UTF-16 text and every binary file all count as changes, byte for byte. Renaming or moving a dependency counts too. A `docstamp.yaml`, `docstamp.config.*` or `docstamp-lock.yaml` below the root is an ordinary file; only the root's own are excluded ([SPEC §7.2](docs/SPEC.md#72-walk)).

## Reviewing a stale doc

A stale doc lists the dependencies that changed since its last review, as `modified`, `added` or `deleted` ([SPEC §12.3](docs/SPEC.md#123-changedsince)). `--json` carries the same list as `changes`. The list comes from read-only `git` calls and never affects the verdict or exit code.

When git history cannot answer (no git, not a work tree, a shallow clone, or an `update` not yet committed), docstamp prints the dependency patterns (`depends` lines) and `changes` is `null`. Then list the dependencies and diff them yourself:

```sh
pnpm exec docstamp list-dependencies <file>
git diff <base> -- <files>
```

## Commands

- `docstamp [check]`: the verdict; exit 0 when every file is ok, 1 when one is stale, 2 on an error. A bare `docstamp` is `check`.
- `docstamp update (--all | <file>...)`: record that you reviewed the named files. In `--json`, a written file reports `state: "ok"` and `written: true`.
- `docstamp list-dependencies [<file>...]`: each file with its dependency patterns and the files they select. It does not read the lock.
- `docstamp list-dependents <file>...`: the reverse query. For each named file (any file in the repository), the dependents (files that depend on it) and the patterns that select it. Direct only, no lock.
- `docstamp help` and `docstamp version`.

Every command except `help` and `version` takes `--json` and `--root <dir>`; `--root` needs a directory and never takes another option as its value. A file argument that is unknown or outside the root fails the whole command with only its diagnostics, never a partial report. The options `--write` and `--files` were replaced by `update` and `list-dependencies`.

Command line and exit codes: [SPEC §13](docs/SPEC.md#13-command-line) and [SPEC §16](docs/SPEC.md#16-exit-codes).

## Lock conflicts

Two branches that write the same file conflict on its `hash` line. Resolution is in [SPEC §11.2](docs/SPEC.md#112-canonical-form).

## Specification

[docs/SPEC.md](docs/SPEC.md) is the contract for all observable behavior.
