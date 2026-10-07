# docstamp

[![npm version](https://img.shields.io/npm/v/docstamp)](https://www.npmjs.com/package/docstamp)
[![CI](https://github.com/nam-hle/docstamp/actions/workflows/ci.yml/badge.svg)](https://github.com/nam-hle/docstamp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/docstamp)](LICENSE)

Documentation (`README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/*.md`, ADRs, runbooks) describes code, and it silently goes stale when that code changes. docstamp is a CI gate for that: you declare which files a doc depends on, and the build fails when any of them changed since a person or an AI agent last reviewed the doc. It is deterministic: content hashes, no LLM, no network, and git is only read, for an advisory list of changed files.

1. Declare what each doc depends on, in `docstamp.yaml` or in the doc's own frontmatter ([Inline declarations](#inline-declarations)).
2. Someone changes the code.
3. CI runs `docstamp`. It fails, naming the doc and the changed files.
4. A person or an agent re-reads the doc, fixes it if needed, and runs `docstamp update <doc>`. CI passes.

## Why not just ...

- **Timestamps or `git blame`?** A rebase, squash or merge rewrites them. docstamp compares content hashes, so history never changes a verdict.
- **A header in each doc?** Declarations can live in one central file, so they also work for files that cannot carry a header (JSON, generated files, binaries). A Markdown doc may also carry its own declaration in its frontmatter ([Inline declarations](#inline-declarations)).
- **An LLM judge?** It costs tokens on every run, answers differently from run to run, and its false alarms teach people to ignore it. A hash comparison is free and reproducible. The review itself still needs a reader; docstamp only decides when one is due.

## Quick start

Requires Node.js 24 or newer. Install it, or run it with `npx docstamp`:

```sh
pnpm add -D docstamp
```

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

Or write the same thing as `docstamp.config.ts` (keep exactly one configuration file):

```ts
import { defineConfig } from 'docstamp';

export default defineConfig({
  version: 2,
  files: {
    'CLAUDE.md': { dependencies: ['src', 'package.json'] },
    'README.md': { dependencies: ['src/cli'] },
    'docs/architecture.md': { dependencies: ['src/core', '!src/core/generated'] },
  },
});
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
$ docstamp update --all
written  CLAUDE.md
written  README.md
written  docs/architecture.md
$ docstamp
3 ok, 0 stale, 0 invalid
```

Later, a commit changes `src/cli/run.ts` and `src/core/generated/types.ts`. CI fails and names the docs and the files that changed (`docs/architecture.md` stays `ok`: the only core file that changed is excluded):

```console
$ docstamp
STALE    CLAUDE.md  (content-changed)
  modified  src/cli/run.ts
  modified  src/core/generated/types.ts
STALE    README.md  (content-changed)
  modified  src/cli/run.ts
1 ok, 2 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md README.md
```

Review each stale doc against the listed files, fix what is no longer true, then record the review and commit the lock:

```console
$ docstamp update CLAUDE.md README.md
written  CLAUDE.md
written  README.md
$ docstamp
3 ok, 0 stale, 0 invalid
```

Run `docstamp` in CI; see [GitHub Actions](#github-actions).

## Inline declarations

A Markdown doc can declare its own dependencies in its frontmatter, with no configuration file and no lock. The block is the key `docstamp` in column 0; `dependencies` takes the same patterns as the configuration file, and `hash` is written by `docstamp update`:

```md
---
title: README
docstamp:
  dependencies: [src/cli, docs/architecture.md]
  hash: 0126db6f752905a5b5a6c6e2c453b1911365df00c703128665aba9dbd56ed98f
---
```

In a repository with a `.git` and no configuration file, add a block without `hash` to each doc and run `docstamp`. The root is the nearest directory with a configuration file, else the nearest with a `.git` (a directory or a file, so linked work trees work). `docs/architecture.md` has a block too, with `src/core` and `!src/core/generated`:

```console
$ docstamp
STALE    README.md  (unrecorded)
  depends   src/cli
  depends   docs/architecture.md
STALE    docs/architecture.md  (unrecorded)
  depends   src/core
  depends   !src/core/generated
0 ok, 2 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update README.md docs/architecture.md
$ docstamp update --all
written  README.md
written  docs/architecture.md
$ docstamp
2 ok, 0 stale, 0 invalid
```

`update` rewrites only the `hash:` line, or appends `hash: <64 hex>` as the last key of the block when there is none. Every other byte stays: comments, quoting, the byte order mark and the line endings (CR LF files stay CR LF). No `docstamp-lock.yaml` is created. Commit the docs. Later, a dependency changes (and a file under `src/core/generated`, which is excluded):

```console
$ docstamp
STALE    docs/architecture.md  (content-changed)
  modified  src/core/hash.ts
1 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update docs/architecture.md
$ docstamp update docs/architecture.md
written  docs/architecture.md
$ docstamp
2 ok, 0 stale, 0 invalid
```

Things to know:

- **Which files.** Files of the repository that the config key `include` selects (default `**/*.md`) and whose frontmatter has a `docstamp:` line in column 0. Only those frontmatters are parsed, strictly ([SPEC §9.2](docs/SPEC.md#92-yaml-profile)): other frontmatter can use anchors or any other YAML and is never read. A malformed block (a flow mapping, an unknown key, a bad `hash`) makes only that file `invalid`, with `E_BLOCK` or the code of the problem; the other files still run. Ignored files are not searched.
- **With a configuration file.** Both kinds of file live side by side: `update --all` covers both, and the lock holds only the files of `files`. A file declared both ways is `E_DUPLICATE_DECLARATION`; nothing is merged. Every command, `--json` included, treats an inline doc like any other.
- **A doc that depends on another inline doc.** When `docs/architecture.md` is re-stamped, `README.md` (which depends on it) stays `ok`: the `hash:` line of a doc is not part of its content when another doc hashes it. Its prose, its other frontmatter and its `dependencies` list still count, so editing any of them makes `README.md` stale ([SPEC §10.2](docs/SPEC.md#102-normalized-content)).
- **Moving a doc.** Rename or move it freely: its declaration and hash travel with it. Dependencies that point at its old path need the new path.
- **Formatters.** A formatter that reflows or re-quotes the frontmatter of a doc changes that doc's content, so every doc that depends on it becomes stale; one that rewrites the `hash:` line (quotes or wraps it) makes the doc `invalid`. Exclude the `docstamp` block from formatters, or run `docstamp update` after formatting.
- **Changed files.** The list of changed dependencies comes from git history of the doc's own `hash:` line, like the lock's history ([SPEC §12.3](docs/SPEC.md#123-changedsince)); a doc that was renamed since the review prints `depends` lines instead.

## Working with AI agents

An agent is usually the one that reads the failure and does the review. Put this paragraph in your `CLAUDE.md` or `AGENTS.md`:

```md
## Docs

`docstamp` fails when a doc's dependencies changed since it was last reviewed. When it fails, for each stale doc: read the changed files it lists (`git diff` if more context is needed), compare them with what the doc claims, and fix every claim that is no longer true. Only then run `docstamp update <doc>`. Never run `docstamp update` without that re-check, and never use `--all` to make the check pass.
```

Two commands help an agent before and during the work. `docstamp list-dependents <file>` shows which docs a code change affects, so the agent can update them in the same change, before CI complains:

```console
$ docstamp list-dependents src/cli/run.ts
src/cli/run.ts
  CLAUDE.md   via src
  README.md   via src/cli
```

`docstamp list-dependencies <doc>` shows what a doc depends on and which files the patterns select. It does not read the lock:

```console
$ docstamp list-dependencies docs/architecture.md
docs/architecture.md
  depends   src/core
  depends   !src/core/generated
  resolved  src/core/hash.ts
```

Every command except `help` and `version` takes `--json`, so an agent can read the verdict as data ([JSON output](#json-output)).

## Writing good dependencies

- **Bind to the narrowest files that make the doc true.** A doc that depends on all of `src` goes stale on every commit, and people then stop reading the reports. `docs/architecture.md` should depend on `src/core`, not on the repository. Measure it with `docstamp stats` ([below](#measuring-how-noisy-a-list-is)).
- **Use directories and globs.** `src/cli` selects everything under it; `src/**/*.ts` selects by shape. Patterns are in [SPEC §8](docs/SPEC.md#8-patterns).
- **Exclude generated or noisy files with `!`.** The last matching pattern wins, so put exclusions after the pattern they cut from. A pattern without `!` must select at least one file, or it is an error (`E_EMPTY_PATTERN`). An exclusion that matches no file is only a warning (`W_EMPTY_EXCLUSION`), so a standard block such as `!src/core/**/__test__/**` can be copied into every doc before any test folder exists, and survives the deletion of the last test. The warning never changes the exit code or the verdict:

  ```
  $ docstamp
  1 ok, 0 stale, 0 invalid
  warning: W_EMPTY_EXCLUSION: docs/architecture.md: !src/core/**/__test__/**: The exclusion matches no file, so it excludes nothing; remove it, or keep it for later.
  ```

  A doc whose patterns together select nothing is still an error (`E_EMPTY_DEPENDENCIES`).
- **Depend on the source of generated output, not on the output.** Files that `.gitignore` or the `ignore` list excludes are not in the universe, so they cannot be dependencies, whether or not they exist on disk. When a pattern names such a path, the error says so instead of suggesting a typo:

  ```
  $ docstamp
  INVALID  docs/output.md
  0 ok, 0 stale, 1 invalid
  error: E_EMPTY_DEPENDENCIES: docs/output.md: Correct the patterns in "dependencies"; together they select no file.
  error: E_EMPTY_PATTERN: docs/output.md: build/output/index.js: Correct or remove the pattern; it matches no file: it exists but is ignored by .gitignore or the ignore list; depend on its source, or remove that rule (gitignore: false skips .gitignore files).
  ```

  Name the files that produce `build/output/index.js` instead. `gitignore: false` ends the exclusion for every `.gitignore` in the repository, not for one path. Only a literal path (no `*`, `?`, `[`, `{`) gets this hint, and the selection never changes. docstamp does not trace a renamed file, because that needs git history ([SPEC §8.5](docs/SPEC.md#85-resolution)).
- **Do not depend on the lock, the configuration or the doc itself.** The root configuration and lock are not selectable, and a file is never one of its own dependencies ([SPEC §8.5](docs/SPEC.md#85-resolution)), so editing a doc never makes it stale.
- **Know what counts as a change.** A file is hashed as it is, except that CR LF becomes LF in text files ([SPEC §10.2](docs/SPEC.md#102-normalized-content)). Nothing else is normalized: a changed license header, whitespace, a final newline, a byte order mark and every binary file all count, byte for byte. Renaming or moving a dependency counts too.
- **Commit the lock separately from the edits.** Known limit: the changed-file list is the difference from the commit that introduced the lock entry. An edit committed in the same commit as `docstamp update` makes the doc stale but is not listed, because docstamp stores one hash and no commit id ([SPEC §12.3](docs/SPEC.md#123-changedsince)). Commit the lock separately from the dependency edits it covers.
- **Lock conflicts.** Two branches that update the same doc conflict on that doc's line in the lock. Resolution is in [SPEC §11.2](docs/SPEC.md#112-canonical-form); take either side, run `docstamp`, review what it reports stale, and write again.

When git history cannot answer (no git, not a work tree, a shallow clone, or an `update` not yet committed), the report prints the `depends` patterns instead of changed files, and `changes` in `--json` is `null`. Then list the dependencies and diff them yourself:

```sh
docstamp list-dependencies <doc>
git diff <base> -- <files>
```

## Measuring how noisy a list is

A broad list is the easy one to write and the one people stop reading: it goes stale on most commits. `docstamp stats` tells you before you commit to a list. It takes the files each doc resolves to today, replays the commits of a window against them, and counts the commits that would have made the doc stale. It only reads history: nothing is written, no lock is needed, and `check` is unaffected. This is docstamp's own history since the start of July, with a gate at 0.5:

```console
$ docstamp stats --since 2026-07-01 --max-fire-ratio 0.5
file          patterns  files  commits  days   ratio   sweep
CLAUDE.md            8     49       40     2  0.6667  0.0250
docs/SPEC.md         1     33       30     2  0.5000  0.0333
README.md            2      5       24     2  0.4000  0.0417
window: 60 commits since 2026-07-01 (date), 14 fire nothing
over --max-fire-ratio 0.5: CLAUDE.md
$ echo $?
1
```

One row per doc, the noisiest first. `patterns` and `files` are the declared patterns and the files they resolve to. `commits` is how many commits of the window touched at least one of those files, `days` on how many distinct days (UTC, by commit date), and `ratio` is `commits` over the commits in the window, to 4 decimals. `sweep` is the share of those commits that touched more than `--sweep-threshold` files (default 200): a share near 1 means the noise is a few repository-wide commits, not the list. The last lines count the commits in the window and the ones that would have made no doc stale. With `--max-fire-ratio`, the command exits 1 when a ratio is greater than the given one and names the docs; use it in CI to keep a list narrow.

- **The window.** `--since` is a commit, a date or a duration, and defaults to `90.days`. A value that names a commit (a tag, a branch, a hash) is the window `<value>..HEAD`; anything else must be a date (`2026-07-01`, midnight UTC, or `2026-07-01T12:00:00Z`) or a duration (`90.days`, `2 weeks ago`) and is given to git as `--since`. A tag named like a date wins; write the time to mean the date. A value of neither kind is `E_HISTORY`, so a typo never silently measures the wrong window. Merge commits are left out, and a rename counts as touching both paths.
- **Resolved at HEAD.** The dependencies are the ones the lists select today, so a file that was deleted or renamed inside the window is not seen, and a window that crosses a reorganization understates the noise.
- **Warnings.** Dependencies resolve exactly as in `list-dependencies`, so the same warnings (for example `W_EMPTY_EXCLUSION`) appear on stderr, or in the `diagnostics` of the file in `--json`. They never change the exit code.
- **Needs full history.** A shallow clone, a directory that is not a git work tree and a repository with no commit are `E_HISTORY` (exit 2): fetch the history first (`fetch-depth: 0` in [GitHub Actions](#github-actions)).
- **Named docs.** `docstamp stats docs/architecture.md` measures only that doc, and the last line then counts the commits that would have made none of the named docs stale. `--json` has the same numbers (`ratio` and `sweepShare` as numbers):

```json
{
  "file": "CLAUDE.md",
  "patterns": 8,
  "resolvedCount": 49,
  "commits": 40,
  "days": 2,
  "ratio": 0.6667,
  "sweepCommits": 1,
  "sweepShare": 0.025,
  "diagnostics": []
}
```

That is one entry of `files`; the report also has `version`, `mode`, `exitCode`, `window` (`since`, `kind`, `commits`, `firingNothing`), `sweepThreshold`, `maxFireRatio`, `exceeding` and top-level `diagnostics` ([SPEC §14.5](docs/SPEC.md#145-json-mode), [§13.9](docs/SPEC.md#139-stats)).

## Reference

### Commands

| Command | What it does |
|---|---|
| `docstamp [check]` | The verdict. A bare `docstamp` is `check`. |
| `docstamp update (--all \| <file>...)` | Record that you reviewed the named files, in the lock or, for an inline doc, in its own `hash:` line. It prints `written` for a file whose recorded hash changed and `unchanged` for one already recorded. In `--json`, both report `state: "ok"`, with `written` true or false. A refused update prints only the findings, never a `next:` line. |
| `docstamp list-dependencies [<file>...]` | Each file with its dependency patterns and the files they select. It does not read the lock. |
| `docstamp list-dependents <file>...` | The reverse query: for each named file (any file in the repository), the files that depend on it and the patterns that select it. Direct only, no lock. |
| `docstamp stats [--since <value>] [--sweep-threshold <n>] [--max-fire-ratio <r>] [<file>...]` | Replay recent history against each file's dependencies: how often the list would have made it stale ([Measuring how noisy a list is](#measuring-how-noisy-a-list-is)). Reads git history, never the lock. |
| `docstamp help` | Usage. |
| `docstamp version` | The installed version. |

Every command except `help` and `version` takes `--json` and `--root <dir>`; `--root` needs a directory and never takes another option as its value. A command that fails before anything is evaluated (bad configuration, lock, root or file argument) prints only its diagnostics: no summary line, and `--json` omits `summary`. A file argument that is unknown or outside the root fails the whole command with only its diagnostics, never a partial report. The options `--write` and `--files` were replaced by `update` and `list-dependencies`. Command line: [SPEC §13](docs/SPEC.md#13-command-line).

### Exit codes

| Code | Meaning |
|---|---|
| 0 | `check`: every selected file is `ok`. `update`, `list-*`, `stats`, `help`, `version`: success. |
| 1 | `check`: a selected file is `stale`. `stats`: a ratio is above `--max-fire-ratio`. |
| 2 | An error, an `invalid` file, or a usage error. |
| 70 | An unexpected internal failure. |

Warnings never affect the exit code. Full table: [SPEC §16](docs/SPEC.md#16-exit-codes).

### Configuration

Declare the dependencies of each file in one configuration file at the repository root ([SPEC §9](docs/SPEC.md#9-configuration-file)). The Quick start shows the whole shape. The carrier is `docstamp.yaml`, or a script: `docstamp.config.ts`, `.mts`, `.js` or `.mjs` ([SPEC §9.1](docs/SPEC.md#91-carriers)). Two configuration files raise `E_CONFIG_AMBIGUOUS`. Besides `files`, the optional keys are `gitignore` (default `true`), `ignore` (extra ignore rules) and `include` (default `["**/*.md"]`): the patterns that select the files searched for [inline declarations](#inline-declarations). `files` stays required, so a configuration that only sets `ignore` or `include` writes `files: {}`. Without any configuration file the defaults apply and only inline declarations exist; a repository with neither fails with `E_CONFIG_MISSING`, so a gate that checks nothing never passes unnoticed.

For editor completion and validation in YAML, point the language server at the schema, which the package ships as `schema.json`:

```yaml
# yaml-language-server: $schema=https://unpkg.com/docstamp/schema.json
```

Offline, use `# yaml-language-server: $schema=./node_modules/docstamp/schema.json`.

A script must export plain data only ([SPEC §9.5](docs/SPEC.md#95-script-carriers)). TypeScript runs through Node's type stripping, so only erasable syntax works (no `enum`, no value `namespace`). TypeScript and JavaScript configurations were verified on Node.js 24.18.1. Evaluating the file may import other files; docstamp does not track them, so import only `docstamp`.

### JSON output

`--json` carries the same content as the text output, machine-formatted ([SPEC §14.5](docs/SPEC.md#145-json-mode)). Here is the stale `README.md` from the example above, with `changes` listing the changed dependencies (`null` when git history cannot answer):

```json
{
  "file": "README.md",
  "state": "stale",
  "reasons": ["content-changed"],
  "dependencies": ["src/cli"],
  "changes": [{ "status": "modified", "path": "src/cli/run.ts" }],
  "diagnostics": []
}
```

This is one entry of `files`; the report also has `version`, `mode`, `exitCode`, `summary` and top-level `diagnostics`.

### GitHub Actions

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

### Upgrading

From a version 1 lock (`docsync.lock`): delete it, review every file, then run `docstamp update --all` ([SPEC §11.1](docs/SPEC.md#111-reading)).

From a version 1 configuration (`dependents` and `covers`): rename `dependents` to `files` and `covers` to `dependencies`, and set `version: 2`. Then run `docstamp update --all` to rewrite the version 2 lock as version 3; the hashes do not change, so first review the files with the previous docstamp version or `git diff`, because the version 2 lock stops `docstamp check` (E_LOCK_VERSION) and it reports nothing stale.

## Compatibility

Your committed lock and your CI are what docstamp protects:

- Within a lock version, the hash of a given input never changes. A change to hash inputs or to which files a pattern selects always comes with a new lock version.
- A release that does not support your lock version refuses it with `E_LOCK_VERSION` and names the migration. It never recomputes or accepts a hash that now means something else. Today a release supports one lock version.
- An inline `hash:` is the plain hash the lock would hold and has no version of its own. A future change to the hash rules adds an explicit optional key to the block; an older release refuses the unknown key and never reinterprets the hash.
- Breaking changes (hashes, selection, file formats, verdicts, exit codes, error codes, `--json`, the Node.js floor) raise the minor version before 1.0 and the major version after.
- Each breaking change carries a migration note, shown as "BREAKING CHANGES" in the [release notes](https://github.com/nam-hle/docstamp/releases).

Full policy: [SPEC §17](docs/SPEC.md#17-compatibility).

## Beyond docs

The mechanism does not care that the dependent file is a doc. Any hidden link between two files can be declared the same way: a schema and the fixtures that mirror it, a migration and its seed data, generated code and the template it comes from. Any file in the repository can have dependencies, and any file can be one ([SPEC §1](docs/SPEC.md#1-scope)). See [docs/VISION.md](docs/VISION.md) for the motivation.

## Documentation

- [docs/SPEC.md](docs/SPEC.md): the contract for all observable behavior.
- [docs/PRINCIPLES.md](docs/PRINCIPLES.md): the principles every change is held to.
- [docs/VISION.md](docs/VISION.md): why docstamp exists.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
