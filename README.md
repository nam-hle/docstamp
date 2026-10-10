# docstamp

[![npm version](https://img.shields.io/npm/v/docstamp)](https://www.npmjs.com/package/docstamp)
[![CI](https://github.com/nam-hle/docstamp/actions/workflows/ci.yml/badge.svg)](https://github.com/nam-hle/docstamp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/docstamp)](LICENSE)

Stop docs from silently going stale: docstamp fails CI when code a doc depends on changed since the doc was last reviewed, and names the doc and the changed files, deterministically.

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
- **CI-ready, one dependency.** Exit codes, `--json`, a [GitHub Actions](#github-actions) snippet; `yaml` is its only runtime dependency.

Requires Node.js 24 or newer:

```sh
pnpm add -D docstamp      # or run it with npx docstamp
npx docstamp help start   # from nothing to a first passing check
```

## Contents

- [Quick start](#quick-start), [Inline declarations](#inline-declarations), [Working with AI agents](#working-with-ai-agents)
- [Writing good dependencies](#writing-good-dependencies), [sharing them with presets](#sharing-a-list-with-presets), [part of a file](#depend-on-part-of-a-file-plugins), [proposing them](#proposing-dependencies), [measuring them](#measuring-how-noisy-a-list-is)
- [Reference](#reference): [commands](#commands), [exit codes](#exit-codes), [configuration](#configuration), [JSON output](#json-output), [GitHub Actions](#github-actions), [upgrading](#upgrading)
- [Compatibility](#compatibility), [Why not just ...](#why-not-just-), [Beyond docs](#beyond-docs), [Contributing](#contributing)

Everything here is also in the CLI: `docstamp help` lists the commands and topics, `docstamp help diagnostics <code>` explains an error, `docstamp <command> --help` shows a command with its options and examples, and `docstamp help spec` points to the specification the package ships.

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

Or write the same object as `docstamp.config.ts`, `export default defineConfig({ version: 2, files: { ... } })` with `import { defineConfig } from 'docstamp'` ([Configuration](#configuration)).

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

Later, a commit changes `src/cli/run.ts` and `src/core/generated/types.ts`, and reformats `src/index.ts`. `docs/architecture.md` stays `ok`: the only core file that changed is excluded:

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

Review each stale doc against the listed files, fix what is no longer true, then run `docstamp update CLAUDE.md README.md` and commit the lock. Run `docstamp` in CI; see [GitHub Actions](#github-actions).

### Reading the report

- **`review:`** is a read-only git command showing the change since the last `update` (the work tree against that commit, so uncommitted edits count; `-M` shows renames). Over 10 changed files, it gives a pathspec of the patterns instead.
- **Untracked files** need `git add -N` to appear in a diff, so the report adds an `untracked: git add -N -- <path>` line; docstamp never runs it, since it changes the index.
- **`(whitespace only)`** is git's judgement, to help you skim; it never changes the verdict.
- **Renames.** A file moved with identical content is one `renamed  <old> -> <new>` line; five or more moved between the same two directories, or five or more `added` (or `deleted`) directly in one directory, become one line. A moved and edited file stays `added` plus `deleted`. A later doc with the same rename lines prints `renamed   (same <n> renames as <first doc>)` ([SPEC §14.3.1](packages/docstamp/docs/SPEC.md#1431-change-lines)).
- **Long lists.** 5 or more changed files start with a `changed` line counting them by status. A `next:` line names at most 10 files, then `  and <m> more` ([SPEC §14.3](packages/docstamp/docs/SPEC.md#143-check-text-mode)). `--json` lists every file.
- **Invalid docs.** On a terminal, errors follow the doc's line (each stream alone is unchanged). When a missing file pattern was moved with its content unchanged, the error names the new path; that hint needs full history and changes no verdict ([SPEC §12.7](packages/docstamp/docs/SPEC.md#127-renamed-path)).
- **An edited list.** When the doc's own list was edited since the review, an `edited` line names the file holding it (also in `review:`), and `(selection)` lines show files the edit `added` or `removed`, compared on the files present today (`selection` in `--json`). The reason stays `content-changed`: the lock records a hash, not the patterns.
- **No history.** Without usable git (no work tree, a shallow clone, an uncommitted `update`), the report prints the `depends` patterns instead and `changes` in `--json` is `null`; diff the files of `docstamp list-dependencies <doc>` yourself.

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

In a repository with a `.git` and no configuration file, add a block without `hash` to each doc and run `docstamp`; it works as in the [Quick start](#quick-start), and `docstamp update` stamps the docs. The root is the nearest directory with a configuration file, else the nearest with a `.git` (a directory or a file, so linked work trees work). `update` rewrites only the `hash:` line, or appends `hash: <64 hex>` as the last key of the block. Every other byte stays: comments, quoting, the byte order mark and the line endings (CR LF files stay CR LF). No `docstamp-lock.yaml` is created; commit the docs. `docstamp help inline` has the rules. Things to know:

- **Which files.** Those the config key `include` selects (default `**/*.md`), not ignored, with a `docstamp:` line in column 0. Only those frontmatters are parsed, strictly ([SPEC §9.2](packages/docstamp/docs/SPEC.md#92-yaml-profile)). A malformed block makes only that file `invalid`.
- **With a configuration file.** Both kinds live side by side; `update --all` covers both, and the lock holds only `files`. A file declared both ways is `E_DUPLICATE_DECLARATION`.
- **Docs depending on docs.** The `hash:` line is not part of a doc's content when another doc hashes it, so re-stamping a doc leaves its dependents `ok` ([SPEC §10.2](packages/docstamp/docs/SPEC.md#102-normalized-content)).
- **Moving a doc.** Its declaration and hash travel with it; dependencies on its old path need the new one.
- **Formatters.** Reflowing the frontmatter changes the doc (its dependents go stale); rewriting the `hash:` line makes it `invalid`. Exclude the block from formatters. A comment or whitespace edit inside the block counts as a change too ([SPEC §9.6.4](packages/docstamp/docs/SPEC.md#964-stamping)).
- **Schema and typos.** The package ships `schema-frontmatter.json` for frontmatter validators (`docstamp help schema`). An unknown key is one `E_UNKNOWN_KEY`, and a near miss names the real key: `dependecies: Remove or correct the key; did you mean "dependencies"?` ([SPEC §9.3](packages/docstamp/docs/SPEC.md#93-reading)).
- **Changed files** come from git history of the doc's own `hash:` line ([SPEC §12.3](packages/docstamp/docs/SPEC.md#123-changedsince)); a doc renamed since the review prints `depends` lines instead.

## Working with AI agents

An agent is usually the one that reads the failure and does the review. The stale report ends with a line that points at `docstamp help agents`, which prints the workflow below; an agent with only the installed package can read it there. Put this paragraph in your `CLAUDE.md` or `AGENTS.md`:

```md
## Docs

`docstamp` fails when a doc's dependencies changed since it was last reviewed. When it fails, for each stale doc: read the changed files it lists (`git diff` if more context is needed), compare them with what the doc claims, and fix every claim that is no longer true. Only then run `docstamp update <doc>`. Never run `docstamp update` without that re-check, and never use `--all` to make the check pass.
```

Before changing code, `docstamp list-dependents <file>` shows which docs the change affects, so the agent can update them in the same change:

```console
$ docstamp list-dependents src/cli/run.ts
src/cli/run.ts
  CLAUDE.md   via src
  README.md   via src/cli
```

A file argument is resolved against the current directory, not `--root`, and the output is relative to the root. A path that is neither tracked nor on disk prints `(no dependents)` and a `W_UNKNOWN_PATH` warning, with exit 0, so a typo shows but a script keeps working. `--transitive` also lists docs that depend on those docs, the chain that goes stale one review round after another; a doc reached again is marked `(listed above)` or `(listed below)`, a cycle `(cycle)`, and neither is followed again ([SPEC §13.8](packages/docstamp/docs/SPEC.md#138-listdependents)). With `--json` each dependent also has `dependents` (nested), `cycle` and `repeated`.

`docstamp list-dependencies <doc>` shows what a doc depends on and which files the patterns select, without reading the lock:

```console
$ docstamp list-dependencies docs/architecture.md
docs/architecture.md
  depends   src/core
  depends   !src/core/generated
  resolved  src/core/hash.ts
```

Every command except `help` and `version` takes `--json`, so an agent can read the verdict as data ([JSON output](#json-output)).

## Writing good dependencies

The pattern language is `docstamp help patterns` and [SPEC §8](packages/docstamp/docs/SPEC.md#8-patterns).

- **Bind to the narrowest files that make the doc true.** A doc that depends on all of `src` goes stale on every commit, and people then stop reading the reports. Measure it with [`docstamp stats`](#measuring-how-noisy-a-list-is).
- **Use directories and globs.** `src/cli` selects everything under it; `src/**/*.ts` selects by shape. Patterns use `/` on every platform: `\` escapes the next character, so `src\core` is the literal `srccore`.
- **Exclude generated or noisy files with `!`.** The last matching pattern wins, so put exclusions after the pattern they cut from. A pattern without `!` must select at least one file (`E_EMPTY_PATTERN`), and a doc whose patterns together select nothing is `E_EMPTY_DEPENDENCIES`. An exclusion that matches no file is only a warning (`W_EMPTY_EXCLUSION`), so a standard block such as `!src/core/**/__test__/**` can be copied into every doc before any test folder exists. An exclusion that a later pattern undoes is `W_SHADOWED_EXCLUSION`, unless the later pattern names the file by its own path ([SPEC §8.5](packages/docstamp/docs/SPEC.md#85-resolution)). The same pattern twice in one doc is `W_DUPLICATE_PATTERN`. Warnings never change the selection, the hash, the verdict or the exit code.
- **Depend on the source of generated output, not on the output.** Files that `.gitignore` or the `ignore` list excludes cannot be dependencies, whether or not they exist on disk. When a literal path names such a file, `E_EMPTY_PATTERN` says it exists but is ignored, instead of suggesting a typo. `gitignore: false` ends the exclusion for every `.gitignore` in the repository, not for one path.
- **Do not depend on the lock, the configuration or the doc itself.** The root configuration and lock are not selectable, and a file is never one of its own dependencies, so editing a doc never makes it stale.
- **Know what counts as a change.** A file is hashed as it is, except that CR LF becomes LF in text files ([SPEC §10.2](packages/docstamp/docs/SPEC.md#102-normalized-content)). A changed license header, whitespace, a final newline, a byte order mark and every binary file all count, byte for byte. Renaming or moving a dependency counts too.
- **Commit the lock separately from the edits.** The changed-file list is the difference from the commit that introduced the lock entry. An edit committed in the same commit as `docstamp update` makes the doc stale but is not listed, because docstamp stores one hash and no commit id ([SPEC §12.3](packages/docstamp/docs/SPEC.md#123-changedsince)).
- **Lock conflicts.** Two branches that update the same doc conflict on that doc's line in the lock. Take either side, run `docstamp`, review what it reports stale, and write again ([SPEC §11.2](packages/docstamp/docs/SPEC.md#112-canonical-form)).

## Sharing a list with presets

When many docs repeat the same lines (the same test exclusions, one shared spec), define them once under `presets` in the configuration file and name them with `use` in a `files` entry or an inline block. `default-presets` applies presets to every doc without a `use` key of its own:

```yaml
version: 2
presets:
  tests: ["!**/*.test.ts", "!**/__test__/**"]
  spec: [docs/SPEC.md]
default-presets: [tests]
files:
  CLAUDE.md:
    dependencies: [src]
```

A doc's patterns are its own `dependencies`, then each preset's patterns in `use` order, so an exclusion in a preset applies after the doc's own inclusions. `list-dependencies` and `check` mark each preset pattern, as in `depends   !**/*.test.ts (preset tests)`.

- **Defined in the configuration file only.** Preset names are `[a-z][a-z0-9-]*`, each preset is a non-empty list of patterns, and a preset cannot refer to another. An undefined name in a block or in `files` makes only that file `invalid` with `E_UNKNOWN_PRESET`; in `default-presets` it is a global `E_UNKNOWN_PRESET`.
- **An own `use` replaces the defaults.** `use: [spec]` gets `spec` only; write `use: [spec, tests]` to keep both, or `use: []` (accepted only when `default-presets` exists) for none. Inline docs get the `default-presets` of the root configuration.
- **The hash depends on the selected files only.** Editing a preset makes a doc stale exactly when it changes which files the doc selects. Nothing in the lock or an inline `hash:` mentions presets.
- **Warnings.** A preset exclusion that matches no file raises no `W_EMPTY_EXCLUSION`; a preset inclusion that matches nothing is `E_EMPTY_PATTERN` naming the preset. List exclusion presets last: `use: [no-tests, more-src]` selects the tests again and warns `W_SHADOWED_EXCLUSION`.
- **`dependencies` stays required**, with at least one pattern of the doc's own. With `--json`, a doc that uses presets also has `use` and `origins`. Details: [SPEC §8.6](packages/docstamp/docs/SPEC.md#86-presets), `docstamp help presets`.

## Depend on one value of a JSON or YAML file

`package.json`, a CI workflow or any `.json`, `.yaml` or `.yml` file can be depended on by value, with no plugin and in any configuration file or inline block. `select` is a dotted path, and the same file may appear in as many entries as you like:

```yaml
version: 2
files:
  CLAUDE.md:
    dependencies:
      - { path: package.json, select: scripts.build }
      - { path: package.json, select: scripts.test }
      - { path: ci.yml, select: jobs.test.steps.1.run }
```

```console
$ docstamp
STALE    CLAUDE.md  (unrecorded)
  depends   "package.json#\"scripts.build\""
  depends   "package.json#\"scripts.test\""
  depends   "ci.yml#\"jobs.test.steps.1.run\""
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md
  run update only after the review, never --all just to pass; see docstamp help agents
$ docstamp update CLAUDE.md
written  CLAUDE.md
```

Editing `scripts.lint` or `version` of `package.json` leaves `CLAUDE.md` `ok`; editing `scripts.test` makes it stale.

- **The value is hashed, not its text.** Key order, comments, quoting and indentation never matter; a changed value, or a changed type (`"1"` is not `1`), does. A selected object or list counts as a whole.
- **Dotted path.** `scripts.build`, `items.0.name` (a list index), and `["a.b"].c` for a key that holds a dot. A path that is not there is `E_SELECT_NOT_FOUND`, one per entry. Text that does not parse, a repeated YAML key, or a YAML file with several documents is `E_SELECT`. YAML merge keys (`<<`) are an ordinary key.
- **A plugin of your own wins.** A registered plugin that claims a file replaces the builtin one for it ([SPEC §8.8](packages/docstamp/docs/SPEC.md#88-builtin-plugins)).

## Depend on part of a file (plugins)

A pattern depends on a whole file. When a doc rests on one section of a long guide, an edit to any other section still makes it stale. A *plugin* teaches docstamp to hash one part of a file: you write it, register it in a script configuration, and name the part with `select`. docstamp stays format-agnostic; the plugin decides what a selector means ([SPEC §8.7](packages/docstamp/docs/SPEC.md#87-selected-dependencies)).

A plugin is an object with a `name`, `apiVersion: 1`, the `files` patterns it handles, and a synchronous `extract({ path, text, select })` that returns `{ hashes }`, one hash string per part it finds. This one hashes the body of a Markdown heading:

```ts
// tools/headings.ts
import { createHash } from 'node:crypto';
import { definePlugin } from 'docstamp';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const parseHeading = (line: string) => {
  const [, marks = '', title = ''] = /^(#{1,6})\s+(.*?)\s*$/u.exec(line) ?? [];
  return marks === '' ? undefined : { level: marks.length, title };
};

// Hashes the body of every heading titled <select>, of any level, up to the next heading of
// the same or a higher level.
export default definePlugin({
  name: 'headings',
  apiVersion: 1,
  files: ['**/*.md'],
  extract({ text, select }) {
    const lines = text.split('\n');
    const hashes: string[] = [];
    lines.forEach((line, index) => {
      const heading = parseHeading(line);
      if (heading?.title !== select) return;
      const end = lines.findIndex(
        (next, i) => i > index && (parseHeading(next)?.level ?? Infinity) <= heading.level,
      );
      hashes.push(sha(lines.slice(index + 1, end === -1 ? undefined : end).join('\n')));
    });
    return { hashes };
  },
});
```

Register it under `plugins` and add an entry `{ path, select }` next to the patterns. `CLAUDE.md` here depends on `src` and on the `Install` section of `docs/guide.md` only:

```ts
// docstamp.config.ts
import { defineConfig } from 'docstamp';
import headings from './tools/headings.ts';

export default defineConfig({
  version: 2,
  plugins: [headings],
  files: {
    'CLAUDE.md': {
      dependencies: ['src/**', { path: 'docs/guide.md', select: 'Install' }],
    },
  },
});
```

```console
$ docstamp
STALE    CLAUDE.md  (unrecorded)
  depends   src/**
  depends   "docs/guide.md#\"Install\""
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md
  run update only after the review, never --all just to pass; see docstamp help agents
$ docstamp update CLAUDE.md
written  CLAUDE.md
$ docstamp
1 ok, 0 stale, 0 invalid
```

Editing the `Usage` section of `docs/guide.md` leaves `CLAUDE.md` `ok`; editing `Install` makes it stale:

```console
$ docstamp
STALE    CLAUDE.md  (content-changed)
  depends   src/**
  depends   "docs/guide.md#\"Install\""
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md
  run update only after the review, never --all just to pass; see docstamp help agents
```

- **One part, by default.** `select` is any plain value with finite numbers only, passed to the plugin as it is. Two entries with the same `path` and `select` are one dependency: the first wins, with its `match`. A plugin that finds no part, several parts (unless `match: 'all'`), or throws, and a plugin that is invalid or claimed twice, each make the file `invalid` with their own code: [SPEC §8.7](packages/docstamp/docs/SPEC.md#87-selected-dependencies), `docstamp help diagnostics`.
- **Script configuration only.** `plugins` is a key of `docstamp.config.ts` or `.js`, not of `docstamp.yaml` or an inline block ([SPEC §9.5](packages/docstamp/docs/SPEC.md#95-script-carriers)).
- **A literal path.** `path` names one file, never a glob; escape glob characters as in a pattern (`data\[1\].json` for `data[1].json`).
- **A stale file names the parts that changed.** The report runs the plugin on the file as it was at the review commit and prints `fragment  "docs/guide.md#\"Install\""  (changed)` for each selected part whose hash differs (`(new)` when the part did not exist then), and `--json` has a `fragments` list. Like the changed-file list it needs history, and it never changes a verdict ([SPEC §12.3](packages/docstamp/docs/SPEC.md#123-changedsince)).
- **Determinism is the plugin author's duty.** A plugin runs in your process and docstamp trusts its hashes. Keep it independent of the clock, the network and the environment.
- **Ready-made plugins.** `docstamp-plugin-markdown` selects a section by its heading, so you need not write the one above: [packages/docstamp-plugin-markdown](packages/docstamp-plugin-markdown#readme), with its own [SPEC](packages/docstamp-plugin-markdown/SPEC.md). `docstamp-plugin-js` selects a top-level declaration of a JavaScript or TypeScript file by its name: [packages/docstamp-plugin-js](packages/docstamp-plugin-js#readme), with its own [SPEC](packages/docstamp-plugin-js/SPEC.md). Neither is published yet. docstamp itself ships only the JSON and YAML plugins described above.

## Proposing dependencies

`docstamp suggest <file>...` reads the docs you name and proposes their `dependencies` from the repository paths they mention (paths in backticks, links, globs), with the number of files each pattern selects and the share of the last 30 days' commits that would have made the doc stale. `--write` records the proposal as an inline block without a `hash`, so the doc stays `unrecorded` until someone reviews it.

<details>
<summary>Example: a doc of a small service</summary>

The doc mentions `src/server/router.ts`, `src/server/schemas`, three files under `src/server/handlers`, a link to `../src/store/index.ts`, `config/*.yaml`, `dist/server.js` (not versioned) and package.json:

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

Three files of one small directory became the directory, with an exclusion for the test file there. `package.json` is not proposed (every dependency bump would make the doc stale), and `dist/server.js` is only a note, because it is ignored. `files` is how many files a pattern selects (`-1` is the file an exclusion cuts); `stale` reads `n/a` without usable git history, and the command never fails for that.

</details>

- **What `--write` touches.** Only the block; every other byte stays, and a second run gives the same bytes. An unstamped block keeps its patterns and gets the `new` proposals appended. It refuses a block with a `hash`, a `use` list it would rewrite, or a doc declared in the configuration file.
- **A diff against what is declared.** A `status` column says `declared`, `covered` or `new`, and `only declared  <pattern>` lines list the rest.
- **Read it before you keep it.** A directory mention can select hundreds of files, and a mention may be an illustration. Rules: [SPEC §12.6](packages/docstamp/docs/SPEC.md#126-proposal), [§13.10](packages/docstamp/docs/SPEC.md#1310-suggest).

## Measuring how noisy a list is

A broad list is easy to write and is the one people stop reading. `docstamp stats` takes the files each doc resolves to today, replays the commits of a window against them, and counts the commits that would have made the doc stale. It only reports: it reads history, writes nothing, needs no lock and exits 0 on success. This is docstamp's own history since `v0.3.1`:

```console
$ docstamp stats --from v0.3.1
file          patterns  files  commits  days   stale   sweep
README.md            2      5        5     1  0.7143  0.0000
CLAUDE.md            8     49        4     1  0.5714  0.0000
docs/SPEC.md         1     33        3     1  0.4286  0.0000
window: 7 commits in v0.3.1..HEAD, 1 make no file stale
legend: patterns declared, files they select, commits and distinct days that would make the file stale; stale = commits / window commits; sweep = share of those commits that touch over 200 paths
```

`days` counts distinct UTC commit dates; `stale` is given to 4 decimals; a `sweep` near 1 means the noise is a few repository-wide commits, not the list. Rows are sorted staleest first. CI gating on these numbers is deliberately not offered yet.

- **The window.** `--since <n>d` (default `30d`, 1 to 3650) counts back from now by commit time; `--from <rev>` is `<rev>..HEAD` and gives the same answer twice. Not both. Merge commits are left out; a rename touches both paths.
- **Resolved at HEAD.** Files deleted or renamed inside the window are not seen, so a reorganization understates staleness.
- **Needs full history.** A shallow clone, no work tree, no commit, or a bad `--from` is `E_HISTORY` (exit 2).
- **Named docs and JSON.** `docstamp stats <doc>` measures only that doc. `--json` has the same numbers (`staleRate`, `sweepShare`, ...) and a `window` object ([SPEC §13.9](packages/docstamp/docs/SPEC.md#139-stats)).

## Reference

### Commands

| Command | What it does |
|---|---|
| `docstamp [check] [--only-stale] [--quiet]` | The verdict; a bare `docstamp` is `check`. A first word one or two edits from a command name that names nothing on disk is `E_USAGE` (`docstamp updte`: did you mean "update"?); `docstamp -- updte` names a file. `--quiet` prints nothing when every file is `ok`; `--only-stale` leaves `ok` files out of the `--json` list while `summary` still counts them. |
| `docstamp update (--all \| <file>...)` | Record that you reviewed the named files, in the lock or in an inline doc's `hash:` line. Prints `written` when the recorded hash changed, `unchanged` otherwise (`--json`: `state: "ok"`, `written` true or false). A refused update prints only the findings. |
| `docstamp list-dependencies [<file>...]` | Each file with its patterns and the files they select. Does not read the lock. |
| `docstamp list-dependents [--transitive] <file>...` | For each named file, the files that depend on it and the patterns that select it; `--transitive` follows dependents of dependents. A path that exists nowhere gets `W_UNKNOWN_PATH` and exit 0. |
| `docstamp stats [--since <n>d \| --from <rev>] [<file>...]` | How often each file would have gone stale ([Measuring](#measuring-how-noisy-a-list-is)). Reads git history, never the lock. |
| `docstamp suggest [--write] <file>...` | Propose dependencies from the paths each file mentions ([Proposing](#proposing-dependencies)); `--write` records an inline block without a hash. Never stamps. |
| `docstamp help [<command> \| <topic>]` | The index, or one page: `help check`, `help patterns`, `help diagnostics E_EMPTY_PATTERN` (codes may be lower case). `docstamp <command> --help` (or `-h`) is that command's page. An unknown name is `E_USAGE`. |
| `docstamp version` | The installed version. |

Every command except `help` and `version` takes `--json` and `--root <dir>` (a directory, never another option). A command that fails before evaluating (bad configuration, lock, root or file argument) prints only its diagnostics, with no summary line, and never a partial report: `E_UNKNOWN_FILE` for a file inside the root that is not stamped, `E_USAGE` for an argument outside the root (arguments resolve against the current directory, not `--root`). `--files` and the old `--write` of `check` were replaced by `list-dependencies` and `update`. Command line: [SPEC §13](packages/docstamp/docs/SPEC.md#13-command-line).

### Exit codes

| Code | Meaning |
|---|---|
| 0 | `check`: every selected file is `ok`. `update`, `list-*`, `stats`, `suggest`, `help`, `version`: success. |
| 1 | `check` only: a selected file is `stale`. |
| 2 | An error, an `invalid` file, or a usage error. |
| 70 | An unexpected internal failure. |

Warnings never affect the exit code. Full table: [SPEC §16](packages/docstamp/docs/SPEC.md#16-exit-codes).

### Configuration

Declare the dependencies of each file in one configuration file at the repository root ([SPEC §9](packages/docstamp/docs/SPEC.md#9-configuration-file)). The Quick start shows the whole shape. The carrier is `docstamp.yaml`, or a script: `docstamp.config.ts`, `.mts`, `.js` or `.mjs` ([SPEC §9.1](packages/docstamp/docs/SPEC.md#91-carriers)). Two configuration files raise `E_CONFIG_AMBIGUOUS`. Besides `files`, the optional keys are `gitignore` (default `true`), `ignore` (extra ignore rules), `presets` ([shared lists](#sharing-a-list-with-presets)), `default-presets` (presets for every doc), `plugins` (script configurations only, [below](#depend-on-part-of-a-file-plugins)) and `include` (default `["**/*.md"]`): the patterns that select the files searched for [inline declarations](#inline-declarations). `files` stays required, so a configuration that only sets `ignore` or `include` writes `files: {}`. Without any configuration file the defaults apply and only inline declarations exist; a repository with neither fails with `E_CONFIG_MISSING`, so a gate that checks nothing never passes unnoticed.

For editor completion in YAML, start the file with `# yaml-language-server: $schema=https://unpkg.com/docstamp/schema.json` (offline: `$schema=./node_modules/docstamp/schema.json`); the package ships it as `schema.json`.

A script must export plain data only, except the `plugins` list ([SPEC §9.5](packages/docstamp/docs/SPEC.md#95-script-carriers), [plugins](#depend-on-part-of-a-file-plugins)). TypeScript runs through Node's type stripping, so only erasable syntax works (no `enum`, no value `namespace`). TypeScript and JavaScript configurations were verified on Node.js 24.18.1. Evaluating the file may import other files; docstamp does not track them, so import only `docstamp`.

### JSON output

`--json` carries the same content as the text output, machine-formatted ([SPEC §14.5](packages/docstamp/docs/SPEC.md#145-json-mode)); `docstamp help json` has every shape. Here is the stale `README.md` from the Quick start:

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

`changes` is `null` when git history cannot answer, and `via` names the patterns that select each path. `"whitespaceOnly": true` marks a white-space-only change, and `"pair"` links a deleted and an added file with the same content (both stay listed). `"dependenciesEdited": true` follows `changes` when the doc's own list was edited, then `"selection"` (`{ "status": "added" | "removed", "path" }`). This is one entry of `files`; the report also has `version`, `mode`, `exitCode`, `summary` and top-level `diagnostics`.

### GitHub Actions

The repository ships a composite action. It runs `docstamp`, writes the report to the job summary, posts it as one pull request comment that later runs update, and fails the job on exit 1 or 2. Fetch full history so the changed-file report can read it ([SPEC §12.3](packages/docstamp/docs/SPEC.md#123-changedsince)); the verdict itself does not need it. Replace `<version>` with a released version that contains `action.yml`; there is no floating tag before 1.0, because a breaking change raises the minor version.

```yaml
name: Docs
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
jobs:
  docstamp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: nam-hle/docstamp@v<version>
        with:
          version: <version>
```

| Input | Default | Meaning |
| --- | --- | --- |
| `version` | required | npm version of `docstamp` to run, or a path to a packed tarball (relative to the working directory of the job). The action installs it into a temporary directory, so your project needs no `docstamp` dependency. |
| `comment` | `true` | Post the pull request comment. |
| `working-directory` | `.` | Passed to `docstamp` as `--root`; the commands in the comment then carry it (`docstamp update docs/CLAUDE.md --root docs`). |
| `github-token` | `github.token` | Needs `pull-requests: write` for the comment. |

The comment lists each stale file with its changed dependencies, and the resolving command. Here is the one for the stale `CLAUDE.md` of this repository, produced from a real `docstamp --json --only-stale` report:

```markdown
### docstamp: 1 file needs review

#### `CLAUDE.md` (stale)

- modified `.github/workflows/ci.yml` (via `.github`)
- modified `knip.json` (via `knip.json`)
- modified `tsconfig.json` (via `tsconfig.json`)

After review: `docstamp update CLAUDE.md`

Review each stale file against its dependencies, then run `docstamp update <file>`.
Run update only after the review, never `--all` just to pass.
```

On a pull request from a fork the token is read-only, so no comment is posted and the same text goes to the job summary only. When the comment cannot be posted for another reason (a read-only token on a bot's pull request, say), the action prints a warning and the verdict stays the exit code of `docstamp`. The comment shows at most 50 changed files per doc, then a count. The comment never runs `update`: only a review writes the lock. The action updates only a comment written by `github-actions[bot]`, so with a personal access token as `github-token` it adds a new comment on each failing run. It runs `actions/setup-node` itself and switches the job to Node 24, which `docstamp` needs; later steps of the job see that version.

#### Without the action

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

From a version 1 lock (`docsync.lock`): delete it, review every file, then run `docstamp update --all` ([SPEC §11.1](packages/docstamp/docs/SPEC.md#111-reading)).

From a version 1 configuration (`dependents` and `covers`): rename `dependents` to `files` and `covers` to `dependencies`, and set `version: 2`. Then run `docstamp update --all` to rewrite the version 2 lock as version 3; the hashes do not change, so first review the files with the previous docstamp version or `git diff`, because the version 2 lock stops `docstamp check` (E_LOCK_VERSION) and it reports nothing stale.

## Compatibility

Your committed lock and your CI are what docstamp protects:

- Within a lock version, the hash of a given input never changes. A change to hash inputs or to which files a pattern selects always comes with a new lock version.
- A release that does not support your lock version refuses it with `E_LOCK_VERSION` and names the migration. It never recomputes or accepts a hash that now means something else. Today a release supports one lock version.
- An inline `hash:` is the plain hash the lock would hold and has no version of its own. A future change to the hash rules adds an explicit optional key to the block; an older release refuses the unknown key and never reinterprets the hash.
- Breaking changes (hashes, selection, file formats, verdicts, exit codes, error codes, `--json`, the Node.js floor) raise the minor version before 1.0 and the major version after.
- Each breaking change carries a migration note, shown as "BREAKING CHANGES" in the [release notes](https://github.com/nam-hle/docstamp/releases).

Full policy: [SPEC §17](packages/docstamp/docs/SPEC.md#17-compatibility).

## Why not just ...

- **Timestamps or `git blame`?** A rebase, squash or merge rewrites them. docstamp compares content hashes, so history never changes a verdict. git is only read, for the advisory list of changed files.
- **A header in each doc?** Declarations can live in one central file, so they also work for files that cannot carry a header (JSON, generated files, binaries). A Markdown doc may also carry its own declaration in its frontmatter.
- **An LLM judge?** It costs tokens on every run, answers differently from run to run, and its false alarms teach people to ignore it. A hash comparison is free and reproducible. The review itself still needs a reader; docstamp only decides when one is due.

## Beyond docs

The mechanism does not care that the dependent file is a doc. Any hidden link between two files can be declared the same way: a schema and the fixtures that mirror it, a migration and its seed data, generated code and the template it comes from. Any file in the repository can have dependencies, and any file can be one ([SPEC §1](packages/docstamp/docs/SPEC.md#1-scope)).

More: [packages/docstamp/docs/SPEC.md](packages/docstamp/docs/SPEC.md), the contract for all observable behavior; [docs/PRINCIPLES.md](docs/PRINCIPLES.md), the principles every change is held to; [docs/VISION.md](docs/VISION.md), why docstamp exists.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
