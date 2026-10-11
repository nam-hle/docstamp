# docstamp

[![npm version](https://img.shields.io/npm/v/docstamp)](https://www.npmjs.com/package/docstamp)
[![CI](https://github.com/nam-hle/docstamp/actions/workflows/ci.yml/badge.svg)](https://github.com/nam-hle/docstamp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/docstamp)](LICENSE)

Stop docs from silently going stale: docstamp fails CI when code a doc depends on changed since the doc was last reviewed, and names the doc and the changed files, deterministically.

**Documentation: [nam-hle.github.io/docstamp](https://nam-hle.github.io/docstamp/)**

A doc (`README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/*.md`, an ADR, a runbook) makes claims about code. When the code changes, nobody notices that the claims are now wrong. docstamp turns "someone should re-read that doc" into a build failure that says exactly which doc to re-read and against which changes.

1. Declare what `docs/auth.md` depends on, here in its own frontmatter:

   ```md
   ---
   docstamp:
     dependencies: [src/auth]
   ---
   ```

2. Someone changes `src/auth/session.ts`.
3. CI runs `docstamp` and fails (exit 1):

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

- **Deterministic.** Content hashes; no LLM, no network. Rebases and squashes never change a verdict.
- **Tells the reviewer what to read.** The changed files and a `git diff` command; whitespace-only edits and renames are flagged.
- **Works for AI agents.** The failure ends with an agent rule, `docstamp help agents` is the workflow, and `list-dependents` shows affected docs before code changes.
- **Measurable.** `stats` shows how noisy a dependency list is before you adopt it; `suggest` drafts the list.
- **The CLI documents itself.** `docstamp help` works offline; no README needed.
- **CI-ready, one dependency.** Exit codes, `--json`, a [GitHub Action](https://nam-hle.github.io/docstamp/guide/ci); `yaml` is its only runtime dependency.

## Install

Requires Node.js 24 or newer:

```sh
pnpm add -D docstamp      # or run it with npx docstamp
npx docstamp help start   # from nothing to a first passing check
```

## Quick start

Declare the dependencies of each doc in `docstamp.yaml` at the repository root. A directory selects every file under it, `!` removes files again (here, generated ones):

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

The first run has no lock, so every doc is stale. Read each doc against its dependencies once, then record the baseline and commit `docstamp-lock.yaml`:

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

From then on, a doc turns stale when a file it selects changes. Review it against the listed files, fix what is no longer true, run `docstamp update <doc>`, and commit the lock. Run `docstamp` in CI.

## Commands

| Command | What it does |
| --- | --- |
| `docstamp [check]` | The verdict: checks that each file's dependencies are unchanged since its last review. A bare `docstamp` is `check`. |
| `docstamp update <file>...` or `--all` | Records that you reviewed the named files. The only command that writes the lock. |
| `docstamp list-dependencies [<file>...]` | Lists each file with its dependency patterns and the files they select. |
| `docstamp list-dependents <file>...` | Lists the files that depend on each named file, and the patterns that select it. |
| `docstamp stats` | Reports how often each file's dependencies would have made it stale. |
| `docstamp suggest <file>...` | Proposes dependencies from the paths each file mentions. |

Every command except `help` and `version` takes `--json` and `--cwd <dir>` (act as if run from `<dir>`). `docstamp help <command>` shows a command with its options and examples. Exit codes: 0 ok, 1 stale (`check` only), 2 error or invalid.

## Configuration

`docstamp.yaml` at the repository root, or the same value as a script, `docstamp.config.ts`, with `defineConfig` from `docstamp`. Without one, only [inline declarations](https://nam-hle.github.io/docstamp/guide/declare#in-the-doc-itself) exist.

| Key | |
| --- | --- |
| `version` | Required, exactly `2`. |
| `files` | Required, even when empty (`files: {}`). Maps each file, by its path from the root, to its `dependencies` (a non-empty list of patterns, or `path:selector`, e.g. `package.json:scripts.build`, [SPEC §8.7](packages/docstamp/docs/spec/08-patterns.md#87-selected-dependencies)) and optionally `use` (preset names). |
| `presets`, `default-presets` | Named pattern lists, and the ones every file without its own `use` gets. |
| `include` | The files searched for inline `docstamp` blocks (default `**/*.md`). |
| `gitignore`, `ignore` | Read the `.gitignore` files (default `true`), and more ignore rules. Ignored files cannot be dependencies. |

Any other key is an error (`E_UNKNOWN_KEY`). Every key, with an example, is in the [config reference](https://nam-hle.github.io/docstamp/reference/topics/config); the patterns are in the [pattern reference](https://nam-hle.github.io/docstamp/reference/topics/patterns).

## Learn more

| | |
|---|---|
| [Get started](https://nam-hle.github.io/docstamp/get-started) | The first check, step by step. |
| [Declare dependencies](https://nam-hle.github.io/docstamp/guide/declare) | Narrow lists, presets, inline declarations, one value of a JSON or YAML file. |
| [Review a stale doc](https://nam-hle.github.io/docstamp/guide/review) | Reading the report, the lock, working with AI agents. |
| [Run it in CI](https://nam-hle.github.io/docstamp/guide/ci) | The GitHub Action, or a plain workflow. |
| [Tune a dependency list](https://nam-hle.github.io/docstamp/guide/tune) | `suggest` and `stats`. |
| [Depend on part of a file](https://nam-hle.github.io/docstamp/guide/plugins) | Plugins, and the [Markdown](packages/docstamp-plugin-markdown#readme) and [JavaScript](packages/docstamp-plugin-js#readme) ones (not published yet). |
| [Reference](https://nam-hle.github.io/docstamp/reference/) | Every command, option, state, exit code and diagnostic; the same text as `docstamp help`. |
| [Specification](packages/docstamp/docs/SPEC.md) | The contract for all observable behavior. |

Why docstamp is built this way: [docs/PRINCIPLES.md](docs/PRINCIPLES.md) and [docs/VISION.md](docs/VISION.md).

## Compatibility

Your committed lock and your CI are what docstamp protects. Within a lock version, the hash of a given input never changes; a change to hash inputs or to which files a pattern selects always comes with a new lock version, and a release that does not support yours refuses it with `E_LOCK_VERSION` and names the migration. Breaking changes (hashes, selection, file formats, verdicts, exit codes, error codes, `--json`, the Node.js floor) raise the minor version before 1.0 and the major version after, and each carries a migration note under "BREAKING CHANGES" in the [release notes](https://github.com/nam-hle/docstamp/releases). Full policy: [SPEC §17](packages/docstamp/docs/spec/17-compatibility.md#17-compatibility).

## Why not just ...

- **Timestamps or `git blame`?** A rebase, squash or merge rewrites them. docstamp compares content hashes, so history never changes a verdict. git is only read, for the advisory list of changed files.
- **A header in each doc?** Declarations can live in one central file, so they also work for files that cannot carry a header (JSON, generated files, binaries). A Markdown doc may also carry its own declaration in its frontmatter.
- **An LLM judge?** It costs tokens on every run, answers differently from run to run, and its false alarms teach people to ignore it. A hash comparison is free and reproducible. The review itself still needs a reader; docstamp only decides when one is due.

## Beyond docs

The mechanism does not care that the dependent file is a doc. Any hidden link between two files can be declared the same way: a schema and the fixtures that mirror it, a migration and its seed data, generated code and the template it comes from. Any file in the repository can have dependencies, and any file can be one ([SPEC §1](packages/docstamp/docs/spec/01-scope.md#1-scope)).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
