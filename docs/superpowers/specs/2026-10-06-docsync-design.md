# docsync design rationale

Why docsync behaves as it does. Behavior itself is defined only in [SPEC.md](../../SPEC.md); this file never restates a rule, it explains the choice.

## Problem

Docs and AI context files (`CLAUDE.md`, `AGENTS.md`) drift from the code they describe. LLM-based checkers are token-heavy and non-deterministic; existing deterministic tools are too coarse to say which doc to review. Beyond docs, any file can silently depend on another (a fixture on a schema, a translation on its source).

## Decisions

| # | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 1 | Snapshot gate: CI fails on drift, an agent or person reviews, then records the review | Deterministic detection, scoped judgment; zero tokens when nothing drifted | LLM judging every run (cost, noise) |
| 2 | Any file can be a Dependent; docs are the primary case | Hidden links exist between all kinds of files | Docs-only tool |
| 3 | The Dependent file is the unit; precision lives on the covered side | Docs describe code as a whole; section bindings break on heading renames | Section-level bindings |
| 4 | All Bindings in `docsync.yaml`; no markers in files | One source of truth; no frontmatter parsing, stripping or discovery scan; works for every file type | Frontmatter first-class with config fallback (was the plan until late in brainstorming) |
| 5 | Config and Lockfile are separate files | Config is hand-written; Lockfile is generated. Writing never rewrites a hand-edited file | One file with bindings and hashes |
| 6 | Content hashes only, no git | Rebase, squash and cherry-pick cannot change a verdict | Recording the commit at Write time (breaks on history rewrites) |
| 7 | One Cover Hash per Dependent over (path, file hash) pairs | Lockfile stays one entry per Dependent even for thousands of files; paths in the input make renames count | Per-file hashes in the Lockfile (precise report, huge churning lock) |
| 8 | The report does not list changed files; the reviewer uses `docsync --files` plus its own diff | Consequence of 6 and 7; accepted | Local per-file manifest cache; per-binding opt-in detail |
| 9 | Universe is the gitignore scope, read from `.gitignore` files only | Covers what the repo contains; per-machine excludes would break determinism | Calling git; reading `core.excludesFile` |
| 10 | Gitignore patterns, last match wins, `!` negation, directory semantics for patterns | Familiar to every developer | Order-independent negation |
| 11 | No propagation between Dependents | A Write changes only the Lockfile, so chains A -> B -> C settle without a graph | Dependency graph |
| 12 | Strict cross-platform rules: NFC names, case-collision error, links hashed by target string, nested repos skipped | §2 promises the same Lockfile on every host | Documenting the differences as limits |
| 13 | CLI: `docsync` checks, `docsync --write <file>... \| --all` records | The two real use cases; prettier-style flags; naming files makes each Write a deliberate claim | Subcommands `check`, `status`, `stamp`, `ls`; bare write of every stale file |
| 14 | Lockfile conflicts are resolved like a package-manager lockfile | Take either side, run `docsync`, review, write | A custom merge driver |
| 15 | Diagnostic message text is informative; codes and subjects are the contract | Byte-identical output across implementations without freezing prose | Normative message templates |

## Review history

- Three adversarial reviews (formal rigor, workflow, determinism) on 2026-10-06 produced 55 findings. Spec fixes from them: ordered and complete diagnostics, unambiguous pattern grammar, explicit string escaping, strict YAML profile, byte-level output rules, lexical argument resolution, gitignore dialect, `.git` and nested-repository handling, link hashing, NFC and case collisions.
- Accepted, not fixed: semantic conflicts between parallel branches are caught only when `docsync` runs on the merge result; reviewers can still write without reviewing (the Lockfile diff in the PR is the evidence); broad globs cause frequent staleness until symbol-level targets exist.

## Scope

- **POC:** everything in SPEC.md version 1.
- **Next:** TypeScript symbol targets (`src/api.ts#createUser`) hashed by public shape, to cut noise from broad bindings.
- **Later:** structured paths (`package.json#scripts`), Markdown headings, a public extractor API, a rename helper, a merge driver.

## Tech

TypeScript 7 (strict), Node 24, ESM, pnpm. Runtime deps: `commander` with `@commander-js/extra-typings`, `yaml`, `zod`, `picocolors`. Tooling: tsup, vitest, oxlint, oxfmt, knip, husky, lint-staged, commitlint. Gitignore handling and pattern matching follow SPEC §7.3 and §8; whether they are hand-written or a library is a planning decision, decided by conformance tests. npm name `docsync` is free (checked 2026-10-06); a rename is likely before publishing.
