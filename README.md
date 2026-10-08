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

Later, a commit changes `src/cli/run.ts` and `src/core/generated/types.ts`, and reformats `src/index.ts`. CI fails and names the docs and the files that changed (`docs/architecture.md` stays `ok`: the only core file that changed is excluded):

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
```

The `review:` line is a read-only git command that shows the change since the last `update` (the work tree against that commit, so uncommitted edits are in it; `-M` shows a moved file as a rename). Untracked files are not in a git diff until `git add -N`, so when the report lists one, an `untracked: git add -N -- <path>` line follows; after a plain `mv`, run it and the `review:` line shows the rename instead of only the deletion. docstamp never runs it, since it changes the index. `(whitespace only)` is git's judgement that a modified file differs only in white space and blank lines, to help you skim; it never changes the verdict. With more than 10 changed files the `review:` line gives a pathspec of the patterns instead of the paths.

When a directory moves, the report does not list every file twice. A file deleted at one path and added at another with exactly the same content is one `renamed  <old> -> <new>` line; five or more of them moved between the same two directories, or five or more `added` (or `deleted`) files directly in one directory, become one line. A moved file that was also edited stays an `added` and a `deleted` line. And a doc that became `invalid` keeps its errors right under its line on a terminal (each stream alone is unchanged: errors are still on standard error):

```console
$ git mv src/old src/new
$ docstamp docs/api.md docs/old.md
STALE    docs/api.md  (content-changed)
  changed   13 renamed
  renamed   src/old/ -> src/new/  (13 files)
INVALID  docs/old.md
error: E_EMPTY_DEPENDENCIES: docs/old.md: Correct the patterns in "dependencies"; together they select no file.
error: E_EMPTY_PATTERN: docs/old.md: src/old: Correct or remove the pattern; it matches no file.
0 ok, 1 stale, 1 invalid
next: review each stale file against its dependencies, then run: docstamp update docs/api.md
next: fix the configuration of each invalid file, then run: docstamp check docs/old.md
```

Each `next:` line names at most 10 files and ends with `  and <m> more` when there are more; update those and run `docstamp` again ([SPEC §14.3](docs/SPEC.md#143-check-text-mode)). A block of 5 or more changed files starts with a `changed` line that counts them by status. `--json` still lists every changed file.

When the doc's own dependency list was edited since its last review (a pattern added, removed or reordered in `docstamp.yaml` or in its inline block), the block says so on an `edited` line and the `review:` line includes the file that holds the list. Below it, one `(selection)` line per file the edit brought into the selection (`added`) or dropped from it (`removed`), compared on the files present today, so a file deleted since the review is not among them; `--json` has them as `selection`. Here an exclusion `!src/c.ts` was added. The reason stays `content-changed`: the lock records a hash, not the patterns, so only git history can tell the two apart, and the verdict never depends on git.

```console
$ docstamp
STALE    CLAUDE.md  (content-changed)
  edited    docstamp.yaml  (dependency list)
  removed   src/c.ts  (selection)
  review: git diff -M 6eff57282542cf9d373c2934764350e274eadf1a -- docstamp.yaml
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md
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
  review: git diff -M 086c7e92ed3634dd8464f9ca9feccba0fa01c06a -- src/core/hash.ts
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
- **Formatters.** A formatter that reflows or re-quotes the frontmatter of a doc changes that doc's content, so every doc that depends on it becomes stale; one that rewrites the `hash:` line (quotes or wraps it) makes the doc `invalid`. Exclude the `docstamp` block from formatters, or run `docstamp update` after formatting. For now, the same holds for an edit that only changes a comment or whitespace inside the block: it counts as a change of that doc (changing that would change hashes, so it needs its own versioned decision, [SPEC §9.6.4](docs/SPEC.md#964-stamping)).
- **A schema for the block.** The package ships `schema-frontmatter.json` (`docstamp/schema-frontmatter.json`), a JSON Schema (draft-07) for the frontmatter of a doc: the `docstamp` key takes `dependencies` (required, a non-empty list of strings), `use` (a list of preset names) and `hash` (64 lowercase hex digits), and nothing else, while other frontmatter keys stay free. A tool that validates frontmatter against a JSON Schema file can use it to catch a mistyped key before docstamp runs; point it at `node_modules/docstamp/schema-frontmatter.json` for the docs that carry a block. docstamp itself does not read the file, and checks the block as [SPEC §9.6.2](docs/SPEC.md#962-parsing) says. Checked with Ajv 8:

  ```js
  import { readFileSync } from 'node:fs';
  import Ajv from 'ajv';

  const schema = JSON.parse(readFileSync('node_modules/docstamp/schema-frontmatter.json', 'utf8'));
  const validate = new Ajv().compile(schema);
  validate({ docstamp: { dependencies: ['src'] } }); // true
  validate({ docstamp: { dependancies: ['src'] } }); // false: no "dependencies"
  ```
- **One typo, one diagnostic.** An unknown key in the block is reported once, as `E_UNKNOWN_KEY` for the file, and not also as `E_BLOCK` for the `dependencies` it replaced ([SPEC §9.6.2](docs/SPEC.md#962-parsing)). When the key is one or two edits from a real one, the message names it: `dependecies: Remove or correct the key; did you mean "dependencies"?` ([SPEC §9.3](docs/SPEC.md#93-reading)).
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

A file argument is resolved against the current directory, not `--root`, and the output is relative to the root. A path that is neither tracked nor on disk is not an error, so a script keeps working, but it is not silent either: the entry prints `(no dependents)` and a warning (`W_UNKNOWN_PATH`) names the path, so a typo shows:

```console
$ docstamp list-dependents src/core/hsh.ts
src/core/hsh.ts
  (no dependents)
warning: W_UNKNOWN_PATH: src/core/hsh.ts: The path is neither tracked nor on disk, so nothing depends on it; check the spelling (arguments are resolved against the current directory).
```

`list-dependents` is direct by default: a doc that depends on another doc is listed for the code the other doc covers only with `--transitive`, which shows the chain of docs that go stale one review round after another. A doc reached a second time is marked `(listed above)` and a cycle is marked `(cycle)`; neither is followed again, so the output is finite. Nothing about a verdict changes ([SPEC §13.8](docs/SPEC.md#138-listdependents)):

```console
$ docstamp list-dependents --transitive src/core/hash.ts
src/core/hash.ts
  docs/GUIDE.md   via src/core
    README.md          via docs/GUIDE.md
      docs/OVERVIEW.md   via README.md
    docs/OVERVIEW.md   via docs/GUIDE.md (listed above)
```

With `--json` each dependent also has `dependents` (the same nodes, nested), `cycle` and `repeated`.

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
- **Use directories and globs.** `src/cli` selects everything under it; `src/**/*.ts` selects by shape. Patterns use `/` on every platform: `\` escapes the next character, so `src\core` is the literal `srccore`, and the `E_EMPTY_PATTERN` it gets says so. Patterns are in [SPEC §8](docs/SPEC.md#8-patterns).
- **Exclude generated or noisy files with `!`.** The last matching pattern wins, so put exclusions after the pattern they cut from. A pattern without `!` must select at least one file, or it is an error (`E_EMPTY_PATTERN`). An exclusion that matches no file is only a warning (`W_EMPTY_EXCLUSION`), so a standard block such as `!src/core/**/__test__/**` can be copied into every doc before any test folder exists, and survives the deletion of the last test. The warning never changes the exit code or the verdict:

  ```
  $ docstamp
  warning: W_EMPTY_EXCLUSION: docs/architecture.md: !src/core/**/__test__/**: The exclusion matches no file, so it excludes nothing; remove it, or keep it for later.
  1 ok, 0 stale, 0 invalid
  ```

  A doc whose patterns together select nothing is still an error (`E_EMPTY_DEPENDENCIES`). An exclusion that a later pattern undoes, as in `src`, `!src/**/*.test.ts`, `src/sub` once a test exists under `src/sub/`, is a warning too (`W_SHADOWED_EXCLUSION`), naming the later pattern. A file named by its own path after the exclusion, such as `src/sub/keep.test.ts`, is taken as deliberate and not warned about ([SPEC §8.5](docs/SPEC.md#85-resolution)).
- **List each pattern once.** The same pattern twice in one doc is a warning (`W_DUPLICATE_PATTERN`), once per repeated pattern. It changes nothing: the selection, the hash and the exit code stay as they were. Keep one copy, unless the order of the patterns needs both, because the last matching pattern wins:

  ```
  $ docstamp
  1 ok, 0 stale, 0 invalid
  warning: W_DUPLICATE_PATTERN: docs/architecture.md: src/core: The pattern is listed more than once; keep one copy, unless the order of the patterns needs both.
  ```
- **Depend on the source of generated output, not on the output.** Files that `.gitignore` or the `ignore` list excludes are not in the universe, so they cannot be dependencies, whether or not they exist on disk. When a pattern names such a path, the error says so instead of suggesting a typo:

  ```
  $ docstamp
  INVALID  docs/output.md
  error: E_EMPTY_DEPENDENCIES: docs/output.md: Correct the patterns in "dependencies"; together they select no file.
  error: E_EMPTY_PATTERN: docs/output.md: build/output/index.js: Correct or remove the pattern; it matches no file: it exists but is ignored by .gitignore or the ignore list; depend on its source, or remove that rule (gitignore: false skips .gitignore files).
  0 ok, 0 stale, 1 invalid
  next: fix the configuration of each invalid file, then run: docstamp check docs/output.md
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

## Sharing a list with presets

When many docs repeat the same lines (the same test exclusions, one shared spec), define the lines once under `presets` in the configuration file and name them with `use` in a `files` entry or an inline block. Preset names are `[a-z][a-z0-9-]*`, each preset is a non-empty list of ordinary [patterns](docs/SPEC.md#81-syntax), and a preset cannot refer to another one:

```yaml
version: 2
presets:
  tests:
    - "!**/*.test.ts"
    - "!**/__test__/**"
  spec:
    - docs/SPEC.md
files:
  CLAUDE.md:
    dependencies: [src]
    use: [tests]
```

```md
---
title: Project README
docstamp:
  dependencies: [src/cli]
  use: [tests, spec]
---
```

A doc's patterns are its own `dependencies`, then the patterns of each preset in `use` order. The last matching pattern still wins, so an exclusion in a preset applies after the doc's own inclusions. The expansion is visible, and so is where each pattern comes from:

```console
$ docstamp list-dependencies README.md
README.md
  depends   src/cli
  depends   !**/*.test.ts (preset tests)
  depends   !**/__test__/** (preset tests)
  depends   docs/SPEC.md (preset spec)
  resolved  docs/SPEC.md
  resolved  src/cli/run.ts
```

`docstamp` (check) marks the preset patterns of a stale doc the same way. With `--json`, a file that uses presets also has `use` and `origins` (one entry per pattern, `null` for the doc's own), in `list-dependencies`, `check` and `update`. Things to know:

- **Presets are defined in the configuration file only.** An inline block that uses one needs a `docstamp.yaml` (or a script) that defines it. A name that is not defined, in a block or in `files`, makes only that file `invalid` with `E_UNKNOWN_PRESET`.
- **The hash depends on the selected files only.** Editing a preset makes a file that uses it stale exactly when the edit changes which files it selects; reordering a preset's lines, or adding an exclusion that removes nothing, does not make a doc stale. Nothing in the lock or in an inline `hash:` mentions presets.
- **Empty patterns.** An exclusion from a preset that matches no file raises no `W_EMPTY_EXCLUSION` (a doc that has nothing to exclude could not remove it); a preset pattern without `!` that matches nothing is `E_EMPTY_PATTERN`, and the message names the preset.
- **List exclusion presets last.** `use: [no-tests, more-src]` selects the tests again when `more-src` adds a directory after the exclusions of `no-tests`; the doc gets `W_SHADOWED_EXCLUSION`, naming the pattern and its preset. Write `use: [more-src, no-tests]`.
- **`dependencies` stays required**, with at least one pattern of the doc's own, and `use` must be a non-empty list of distinct names. Details: [SPEC §8.6](docs/SPEC.md#86-presets).

## Proposing dependencies

A doc already says what it is about: the paths in backticks, the links, the globs in the prose. `docstamp suggest <file>...` reads the files you name and proposes their `dependencies` from the repository paths they mention, with the number of files each pattern selects and the share of the last 30 days' commits that would have made the doc stale. `docs/architecture.md` is a doc of a small service:

```md
# Architecture

Requests enter through `src/server/router.ts`, are validated by the schemas in
`src/server/schemas` and handled by `src/server/handlers/users.ts`,
`src/server/handlers/orders.ts` and `src/server/handlers/billing.ts`. Storage goes
through [the store](../src/store/index.ts) and is configured by `config/*.yaml`.
The bundle lands in `dist/server.js` (not versioned); the scripts are in package.json.
```

```console
$ docstamp suggest docs/architecture.md
suggest docs/architecture.md
  pattern                           files   stale
  config/*.yaml                         2  0.1111
  src/server/handlers                   4  0.2222
  src/server/router.ts                  1  0.2222
  src/server/schemas                    2  0.0000
  src/store/index.ts                    1  0.0000
  !src/server/handlers/**/*.test.*     -1
  ignored  dist/server.js
```

Three files of one small directory became the directory, with an exclusion for the test file that is there. `package.json` is not proposed, because every dependency bump would make the doc stale, and `dist/server.js` is only a note, because it is ignored and so cannot be a dependency. `files` is how many files a pattern selects (`-1` is the one file an exclusion cuts), and `stale` is the share of the window's commits that touched any of them; it reads `n/a` when there is no usable git history, and the command never fails for that. `--write` records the proposal as an inline block with no `hash`, so the doc stays `unrecorded` until someone reviews it:

```console
$ docstamp suggest --write docs/architecture.md
suggest docs/architecture.md
  pattern                           files   stale
  config/*.yaml                         2  0.1111
  src/server/handlers                   4  0.2222
  src/server/router.ts                  1  0.2222
  src/server/schemas                    2  0.0000
  src/store/index.ts                    1  0.0000
  !src/server/handlers/**/*.test.*     -1
  ignored  dist/server.js
written  docs/architecture.md
$ docstamp
STALE    docs/architecture.md  (unrecorded)
  depends   config/*.yaml
  depends   src/server/handlers
  depends   src/server/router.ts
  depends   src/server/schemas
  depends   src/store/index.ts
  depends   !src/server/handlers/**/*.test.*
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update docs/architecture.md
```

The block is inserted into the frontmatter, indented like the first indented line already there (two spaces when there is none), or a minimal frontmatter is created; every other byte of the file stays (comments, the byte order mark, CR LF). Running it twice gives the same bytes. It never stamps, and it refuses to overwrite a block that records a `hash` or names presets with `use`, or a doc declared in the configuration file: edit those by hand. Read the proposal before you keep it: a bare directory mention can select hundreds of files, and a mention may be an illustration, not something the doc states. The extraction rules (what counts as a mention, the generic files that are dropped, when files collapse into their directory, which test exclusions are added) are in [SPEC §12.6](docs/SPEC.md#126-proposal); the command is [§13.10](docs/SPEC.md#1310-suggest).

## Measuring how noisy a list is

A broad list is the easy one to write and the one people stop reading: it goes stale on most commits. `docstamp stats` tells you before you commit to a list. It takes the files each doc resolves to today, replays the commits of a window against them, and counts the commits that would have made the doc stale. It only reports: it reads history, writes nothing, needs no lock, always exits 0 on success and leaves `check` unaffected. This is docstamp's own history since `v0.3.1`:

```console
$ docstamp stats --from v0.3.1
file          patterns  files  commits  days   stale   sweep
README.md            2      5        5     1  0.7143  0.0000
CLAUDE.md            8     49        4     1  0.5714  0.0000
docs/SPEC.md         1     33        3     1  0.4286  0.0000
window: 7 commits in v0.3.1..HEAD, 1 make no file stale
```

The last 30 days (the default, `--since 30d`) look the same way:

```console
$ docstamp stats --since 30d
file          patterns  files  commits  days   stale   sweep
CLAUDE.md            8     49       41     2  0.6613  0.0244
docs/SPEC.md         1     33       31     2  0.5000  0.0323
README.md            2      5       26     2  0.4194  0.0385
window: 62 commits in the last 30 days, 14 make no file stale
```

One row per doc, the staleest first. `patterns` and `files` are the declared patterns and the files they resolve to. `commits` is how many commits of the window touched at least one of those files (each would have made the doc stale), `days` is on how many distinct days (UTC, by commit date), and `stale` is `commits` over all the commits in the window, to 4 decimals: the share of commits that would make the doc stale. `sweep` is the share of those commits that touched more than 200 files: a share near 1 means the noise is a few repository-wide commits, not the list. The last line counts the commits in the window and the ones that would make no listed doc stale. CI gating on these numbers is deliberately not offered yet.

- **The window.** `--since <n>d` is the last *n* days, written exactly like `30d` (1 to 3650; `30`, `30.days` and dates are refused). It is measured back from the moment you run it, by commit time, so it moves from day to day. `--from <rev>` is the commits of `<rev>..HEAD` and does not move; use it when you want the same answer twice. Giving both is an error, and a `--from` that names no commit is `E_HISTORY`. Merge commits are left out, and a rename counts as touching both paths.
- **Resolved at HEAD.** The dependencies are the ones the lists select today, so a file that was deleted or renamed inside the window is not seen, and a window that crosses a reorganization understates how often a doc would have gone stale.
- **Warnings.** Dependencies resolve exactly as in `list-dependencies`, so the same warnings (for example `W_EMPTY_EXCLUSION`) appear on stderr, or in the `diagnostics` of the file in `--json`.
- **Needs full history.** A shallow clone, a directory that is not a git work tree and a repository with no commit are `E_HISTORY` (exit 2): fetch the history first (`fetch-depth: 0` in [GitHub Actions](#github-actions)).
- **Named docs.** `docstamp stats docs/architecture.md` measures only that doc, and the last line then counts the commits that would have made none of the named docs stale. `--json` has the same numbers (`staleRate` and `sweepShare` as numbers):

```json
{
  "file": "CLAUDE.md",
  "patterns": 8,
  "resolvedCount": 49,
  "staleCommits": 4,
  "days": 1,
  "staleRate": 0.5714,
  "sweepCommits": 0,
  "sweepShare": 0,
  "diagnostics": []
}
```

That is one entry of `files`; the report also has `version`, `mode`, `exitCode`, `window` (`kind`, `value`, `commits`, `untouched`) and top-level `diagnostics` ([SPEC §14.5](docs/SPEC.md#145-json-mode), [§13.9](docs/SPEC.md#139-stats)).

## Reference

### Commands

| Command | What it does |
|---|---|
| `docstamp [check] [--only-stale] [--quiet]` | The verdict. A bare `docstamp` is `check`. `--quiet` prints nothing when every file is `ok` (the exit code still says it) and the report as usual otherwise; `--only-stale` leaves the `ok` files out of the `--json` list while `summary` still counts them; without `--json` it changes nothing, since the text report has no line for an `ok` file. Neither is accepted by the other commands. |
| `docstamp update (--all \| <file>...)` | Record that you reviewed the named files, in the lock or, for an inline doc, in its own `hash:` line. It prints `written` for a file whose recorded hash changed and `unchanged` for one already recorded. In `--json`, both report `state: "ok"`, with `written` true or false. A refused update prints only the findings, never a `next:` line. |
| `docstamp list-dependencies [<file>...]` | Each file with its dependency patterns and the files they select. It does not read the lock. |
| `docstamp list-dependents [--transitive] <file>...` | The reverse query: for each named file (any file in the repository), the files that depend on it and the patterns that select it. Direct only unless `--transitive`, which also lists the dependents of those dependents. No lock. A path that exists nowhere gets a `W_UNKNOWN_PATH` warning and exit 0. |
| `docstamp stats [--since <n>d \| --from <rev>] [<file>...]` | Report how often each file's dependencies would have made it stale over the last `n` days or since `<rev>` ([Measuring how noisy a list is](#measuring-how-noisy-a-list-is)). Reads git history, never the lock. |
| `docstamp suggest [--write] <file>...` | Propose each file's dependencies from the repository paths it mentions ([Proposing dependencies](#proposing-dependencies)). With `--write`, record them as an inline block without a hash. Never stamps. |
| `docstamp help` | Usage. |
| `docstamp version` | The installed version. |

Every command except `help` and `version` takes `--json` and `--root <dir>`; `--root` needs a directory and never takes another option as its value. A command that fails before anything is evaluated (bad configuration, lock, root or file argument) prints only its diagnostics: no summary line, and `--json` omits `summary`. A file argument that is unknown or outside the root fails the whole command with only its diagnostics, never a partial report. `--write` is for `suggest` alone; `--files` and the old `--write` were replaced by `list-dependencies` and `update`. Command line: [SPEC §13](docs/SPEC.md#13-command-line).

### Exit codes

| Code | Meaning |
|---|---|
| 0 | `check`: every selected file is `ok`. `update`, `list-*`, `stats`, `suggest`, `help`, `version`: success. |
| 1 | `check` only: a selected file is `stale`. |
| 2 | An error, an `invalid` file, or a usage error. |
| 70 | An unexpected internal failure. |

Warnings never affect the exit code. Full table: [SPEC §16](docs/SPEC.md#16-exit-codes).

### Configuration

Declare the dependencies of each file in one configuration file at the repository root ([SPEC §9](docs/SPEC.md#9-configuration-file)). The Quick start shows the whole shape. The carrier is `docstamp.yaml`, or a script: `docstamp.config.ts`, `.mts`, `.js` or `.mjs` ([SPEC §9.1](docs/SPEC.md#91-carriers)). Two configuration files raise `E_CONFIG_AMBIGUOUS`. Besides `files`, the optional keys are `gitignore` (default `true`), `ignore` (extra ignore rules), `presets` ([shared lists](#sharing-a-list-with-presets)) and `include` (default `["**/*.md"]`): the patterns that select the files searched for [inline declarations](#inline-declarations). `files` stays required, so a configuration that only sets `ignore` or `include` writes `files: {}`. Without any configuration file the defaults apply and only inline declarations exist; a repository with neither fails with `E_CONFIG_MISSING`, so a gate that checks nothing never passes unnoticed.

For editor completion and validation in YAML, point the language server at the schema, which the package ships as `schema.json`:

```yaml
# yaml-language-server: $schema=https://unpkg.com/docstamp/schema.json
```

Offline, use `# yaml-language-server: $schema=./node_modules/docstamp/schema.json`.

A script must export plain data only ([SPEC §9.5](docs/SPEC.md#95-script-carriers)). TypeScript runs through Node's type stripping, so only erasable syntax works (no `enum`, no value `namespace`). TypeScript and JavaScript configurations were verified on Node.js 24.18.1. Evaluating the file may import other files; docstamp does not track them, so import only `docstamp`.

### JSON output

`--json` carries the same content as the text output, machine-formatted ([SPEC §14.5](docs/SPEC.md#145-json-mode)). Here is the stale `README.md` from the example above, with `changes` listing the changed dependencies (`null` when git history cannot answer). `via` names the patterns that select each path, and `"whitespaceOnly": true` appears on a modified file whose change is white space only. `"pair"` links a deleted and an added file with the same content (both stay listed). `"dependenciesEdited": true` follows `changes` when the doc's own dependency list was edited, then `"selection"`, the files that edit added to or removed from the selection (`{ "status": "added" | "removed", "path" }`):

```json
{
  "file": "README.md",
  "state": "stale",
  "reasons": ["content-changed"],
  "dependencies": ["src/cli"],
  "changes": [{ "status": "modified", "path": "src/cli/run.ts", "via": ["src/cli"] }],
  "diagnostics": []
}
```

This is one entry of `files`; the report also has `version`, `mode`, `exitCode`, `summary` and top-level `diagnostics`. `docstamp --json --only-stale` leaves the `ok` files out of `files` and keeps counting them in `summary`.

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
