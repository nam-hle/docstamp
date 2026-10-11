---
title: Declare dependencies
---

# Declare dependencies

A dependency list says which files a doc's claims rest on. The pattern language is
`docstamp help patterns` ([reference](/reference/topics/patterns), [SPEC §8](/spec/patterns)).

## In the configuration file

`docstamp.yaml` (or `docstamp.config.ts`, with `defineConfig` from `docstamp`) maps each file to its
`dependencies`. [Get started](/get-started) shows a complete one; every key is in the
[config topic](/reference/topics/config).

## In the doc itself

A Markdown doc can declare its own dependencies in its frontmatter, with no configuration file and
no lock. `hash` is written by `docstamp update`:

```md
---
title: README
docstamp:
  dependencies: [src/cli, docs/architecture.md]
  hash: 0126db6f752905a5b5a6c6e2c453b1911365df00c703128665aba9dbd56ed98f
---
```

In a repository with a `.git` and no configuration file, add a block without `hash` to each doc and
run `docstamp`. `update` rewrites only the `hash:` line, and no `docstamp-lock.yaml` is created:
commit the docs. Exclude the block from formatters: reflowing it changes the doc. The rules are in the
[inline topic](/reference/topics/inline) and [SPEC §9.6](/spec/configuration-file#96-inline-declarations).

## Write narrow lists

- **Bind to the narrowest files that make the doc true.** A doc that depends on all of `src` goes
  stale on every commit, and people then stop reading the reports. Measure a list with
  [`docstamp stats`](/guide/tune).
- **Use directories and globs.** `src/cli` selects everything under it; `src/**/*.ts` selects by
  shape. Patterns use `/` on every platform.
- **Exclude generated or noisy files with `!`.** The last matching pattern wins, so put exclusions
  after the pattern they cut from.
- **Depend on the source of generated output, not on the output.** Files that `.gitignore` or the
  `ignore` list excludes cannot be dependencies.
- **Know what counts as a change.** A file is hashed as it is, except that CR LF becomes LF in text
  files. Renaming or moving a dependency counts too ([SPEC §10.2](/spec/hashing#102-normalized-content)).

## Share a list with presets

When many docs repeat the same lines, define them once under `presets` and name them with `use`.
`default-presets` applies presets to every doc without a `use` of its own:

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

A doc's patterns are its own `dependencies`, then each preset's in `use` order. Details:
[presets topic](/reference/topics/presets), [SPEC §8.6](/spec/patterns#86-presets).

## Depend on one value of a JSON or YAML file

`package.json`, a CI workflow or any `.json`, `.yaml` or `.yml` file can be depended on by value,
with no plugin. `select` is a dotted path:

```yaml
version: 2
files:
  CLAUDE.md:
    dependencies:
      - { path: package.json, select: scripts.build }
      - { path: package.json, select: scripts.test }
      - { path: ci.yml, select: jobs.test.steps.1.run }
```

Editing `scripts.lint` or `version` of `package.json` leaves `CLAUDE.md` `ok`; editing
`scripts.test` makes it stale. The value is hashed, not its text: key order, comments and quoting
never matter ([SPEC §8.8](/spec/patterns#88-builtin-plugins)).

For parts of other files, such as a section of a Markdown guide, see
[Depend on part of a file](/guide/plugins).
