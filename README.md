# docstamp

[![npm version](https://img.shields.io/npm/v/docstamp)](https://www.npmjs.com/package/docstamp)
[![CI](https://github.com/nam-hle/docstamp/actions/workflows/ci.yml/badge.svg)](https://github.com/nam-hle/docstamp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/docstamp)](LICENSE)

A deterministic snapshot gate for hidden links between files. Some files quietly depend on others: a `CLAUDE.md` or `AGENTS.md` that describes your source tree, a README that documents a CLI, a fixture that mirrors a schema. When the dependencies change, nothing tells you the file is out of date. With `docstamp`, each file declares the files it depends on, and CI fails when those changed since a person or an agent last reviewed it. There is no LLM and no network access: the verdict is a content hash comparison and never depends on git. See [docs/VISION.md](docs/VISION.md) for the motivation.

## Quick start

Install it (requires Node.js 24 or newer), or run it with `npx docstamp`:

```sh
pnpm add -D docstamp
```

Declare the dependencies of each file in `docstamp.yaml` at the repository root:

```yaml
# yaml-language-server: $schema=https://unpkg.com/docstamp/schema.json
version: 2
files:
  CLAUDE.md:
    dependencies:
      - src/**
      - package.json
```

Or write the same thing as `docstamp.config.ts` (keep exactly one configuration file):

```ts
import { defineConfig } from 'docstamp';

export default defineConfig({
  version: 2,
  files: {
    'CLAUDE.md': { dependencies: ['src/**', 'package.json'] },
  },
});
```

The first run has no lock, so the file is stale. Review it against its dependencies, then record the review and commit `docstamp-lock.yaml`:

```console
$ docstamp
STALE    CLAUDE.md  (unrecorded)
  depends   src/**
  depends   package.json
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md
$ docstamp update CLAUDE.md
written  CLAUDE.md
$ docstamp
1 ok, 0 stale, 0 invalid
```

Run `docstamp` in CI. After `src/main.ts` changes (shown outside a git work tree; inside one, the lines under `STALE` list the changed dependencies as `modified`, `added` or `deleted`):

```console
$ docstamp
STALE    CLAUDE.md  (content-changed)
  depends   src/**
  depends   package.json
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md
```

## How it works

1. A configuration file maps each file to the patterns that select its dependencies ([SPEC §8](docs/SPEC.md#8-patterns)).
2. `docstamp update <file>` hashes the normalized content of the file's dependencies and records the digest in `docstamp-lock.yaml`.
3. `docstamp` recomputes the digest of every file's dependencies and compares it with the lock.
4. A file is `ok` when the digests match and `stale` when they differ or were never recorded.
5. Only `docstamp update` writes the lock, so a lock entry means a review happened. Nothing else changes it.

## Commands

| Command | What it does |
|---|---|
| `docstamp [check]` | The verdict. A bare `docstamp` is `check`. |
| `docstamp update (--all \| <file>...)` | Record that you reviewed the named files. It prints `written` for a file whose recorded hash changed and `unchanged` for one already recorded. In `--json`, both report `state: "ok"`, with `written` true or false. A refused update prints only the findings, never a `next:` line. |
| `docstamp list-dependencies [<file>...]` | Each file with its dependency patterns and the files they select. It does not read the lock. |
| `docstamp list-dependents <file>...` | The reverse query: for each named file (any file in the repository), the files that depend on it and the patterns that select it. Direct only, no lock. |
| `docstamp help` | Usage. |
| `docstamp version` | The installed version. |

Every command except `help` and `version` takes `--json` and `--root <dir>`; `--root` needs a directory and never takes another option as its value. A command that fails before anything is evaluated (bad configuration, lock, root or file argument) prints only its diagnostics: no summary line, and `--json` omits `summary`. A file argument that is unknown or outside the root fails the whole command with only its diagnostics, never a partial report. The options `--write` and `--files` were replaced by `update` and `list-dependencies`. Command line: [SPEC §13](docs/SPEC.md#13-command-line).

```console
$ docstamp list-dependents src/main.ts
src/main.ts
  CLAUDE.md   via src/**
$ docstamp list-dependencies CLAUDE.md
CLAUDE.md
  depends   src/**
  depends   package.json
  resolved  package.json
  resolved  src/main.ts
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | `check`: every selected file is `ok`. `update`, `list-*`, `help`, `version`: success. |
| 1 | `check` only: a selected file is `stale`. |
| 2 | An error, an `invalid` file, or a usage error. |
| 70 | An unexpected internal failure. |

Warnings never affect the exit code. Full table: [SPEC §16](docs/SPEC.md#16-exit-codes).

## Configuration

Declare the dependencies of each file in one configuration file at the repository root ([SPEC §9](docs/SPEC.md#9-configuration-file)). The example under Quick start is the whole shape; a longer one:

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

For editor completion and validation, point the YAML language server at the schema, which the package ships as `schema.json`:

```yaml
# yaml-language-server: $schema=https://unpkg.com/docstamp/schema.json
```

Offline, use `# yaml-language-server: $schema=./node_modules/docstamp/schema.json`.

### TypeScript or JavaScript

The configuration can be a script instead: `docstamp.config.ts`, `.mts`, `.js` or `.mjs` ([SPEC §9.1](docs/SPEC.md#91-carriers)). Two configuration files raise `E_CONFIG_AMBIGUOUS`.

The file must export plain data only ([SPEC §9.5](docs/SPEC.md#95-script-carriers)). TypeScript runs through Node's type stripping, so only erasable syntax works (no `enum`, no value `namespace`). TypeScript and JavaScript configurations were verified on Node.js 24.18.1. Evaluating the file may import other files; docstamp does not track them, so import only `docstamp`.

Pattern syntax is in [SPEC §8](docs/SPEC.md#8-patterns).

## GitHub Actions

Fetch full history so the changed-file report can read it ([SPEC §12.3](docs/SPEC.md#123-changedsince)); the verdict itself does not need it.

```yaml
name: Docs
on:
  pull_request:
jobs:
  docstamp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec docstamp
```

`pnpm/action-setup` installs the pnpm version named by `packageManager` in your `package.json`. The job fails when `docstamp` exits 1 (a stale file) or 2 (an error). With npm, drop the `pnpm/action-setup` step and `cache: pnpm`, then run `npm ci` and `npx docstamp`. Pin the actions to commit SHAs if your policy requires it.

## Workflow

The three steps are defined in [SPEC §1](docs/SPEC.md#1-scope):

1. CI runs `pnpm exec docstamp`. It exits 1 when a file's dependencies changed since its last review.
2. A person or an agent reviews each stale file against its dependencies and edits it if needed.
3. Run `pnpm exec docstamp update <file>` to record the review in `docstamp-lock.yaml`, and commit the lock.

The first run has no lock; `pnpm exec docstamp update --all` records the initial state once the docs have been reviewed.

Upgrading from a version 1 lock (`docsync.lock`): delete it, review every file, then run `pnpm exec docstamp update --all` ([SPEC §11.1](docs/SPEC.md#111-reading)).

Upgrading from a version 1 configuration (`dependents` and `covers`): rename `dependents` to `files` and `covers` to `dependencies`, and set `version: 2`. Then run `pnpm exec docstamp update --all` to rewrite the version 2 lock as version 3; the hashes do not change, so first review the files with the previous docstamp version or `git diff`, because the version 2 lock stops `docstamp check` (E_LOCK_VERSION) and it reports nothing stale.

### Reviewing a stale doc

A stale doc lists the dependencies that changed since its last review, as `modified`, `added` or `deleted` ([SPEC §12.3](docs/SPEC.md#123-changedsince)). `--json` carries the same list as `changes`. The list comes from read-only `git` calls and never affects the verdict or exit code.

Known limit: the list is the difference from the commit that introduced the lock entry. An edit committed in the same commit as `docstamp update` makes the doc stale but is not listed, because docstamp stores one hash and no commit id ([SPEC §12.3](docs/SPEC.md#123-changedsince)). Commit the lock separately from the edits it covers.

When git history cannot answer (no git, not a work tree, a shallow clone, or an `update` not yet committed), docstamp prints the dependency patterns (`depends` lines) and `changes` is `null`. Then list the dependencies and diff them yourself:

```sh
pnpm exec docstamp list-dependencies <file>
git diff <base> -- <files>
```

### Lock conflicts

Two branches that write the same file conflict on its `hash` line. Resolution is in [SPEC §11.2](docs/SPEC.md#112-canonical-form).

## What counts as a change

A file's content is hashed as it is, except that CR LF becomes LF in text files ([SPEC §10.2](docs/SPEC.md#102-normalized-content)). Nothing else is normalized: a changed license header, whitespace, a final newline, a lone CR, a byte order mark, UTF-16 text and every binary file all count as changes, byte for byte. Renaming or moving a dependency counts too. A `docstamp.yaml`, `docstamp.config.*` or `docstamp-lock.yaml` below the root is an ordinary file; only the root's own are excluded ([SPEC §7.2](docs/SPEC.md#72-walk)).

## Compatibility

Your committed lock and your CI are what docstamp protects:

- Within a lock version, the hash of a given input never changes. A change to hash inputs or to which files a pattern selects always comes with a new lock version.
- A release that does not support your lock version refuses it with `E_LOCK_VERSION` and names the migration. It never recomputes or accepts a hash that now means something else. Today a release supports one lock version.
- Breaking changes (hashes, selection, file formats, verdicts, exit codes, error codes, `--json`, the Node.js floor) raise the minor version before 1.0 and the major version after.
- Each breaking change carries a migration note, shown as "BREAKING CHANGES" in the [release notes](https://github.com/nam-hle/docstamp/releases).

Full policy: [SPEC §17](docs/SPEC.md#17-compatibility).

## Documentation

- [docs/SPEC.md](docs/SPEC.md): the contract for all observable behavior.
- [docs/PRINCIPLES.md](docs/PRINCIPLES.md): the principles every change is held to.
- [docs/VISION.md](docs/VISION.md): why docstamp exists.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
