# docsync design

Status: draft, decisions agreed during brainstorming. Open items at the end.

## Problem

Project docs and AI context files (`CLAUDE.md`, `AGENTS.md`, ...) drift from the code they describe because manual updates are forgotten. Existing tools either use token-heavy LLM guesswork (false positives, non-deterministic) or lack fine-grained, deterministic tracking between code changes and specific docs.

## Goal

A deterministic snapshot gate:

1. CI runs `docsync check`; it fails when any doc's covered code changed since the doc was last reviewed.
2. An AI agent (or human) reads the report, reviews the flagged doc, updates it if needed.
3. Reviewer runs `docsync stamp`; the lockfile updates; CI passes.

The tool itself never calls an LLM. AI only does the review/edit step. Zero tokens spent when nothing drifted.

## Decisions

### Unit of staleness

- The **doc file** is the unit. No section-level bindings.
- Precision lives on the **code side** (what the doc covers).

### Binding declaration

- **Markdown frontmatter is first-class**, under a namespaced `docsync` key:

  ```markdown
  ---
  docsync:
    covers:
      - src/cli/**
      - "!src/cli/**/*.test.ts"
      - package.json
  ---
  ```

- **Central file `docsync.yaml`** as fallback for files that cannot carry frontmatter (`.adoc`, `.txt`, generated files):

  ```yaml
  docs:
    docs/architecture.adoc:
      covers: [src/core/**, "!src/core/**/*.spec.ts"]
  ```

- Same doc declared in both places: **error** (one source of truth).

### Pattern semantics (`covers`)

- Paths are relative to the **repo root** (where the lock lives), not the doc's folder.
- Supports files, folders, `*`, `**`, and `!negate`.
- A folder means everything under it (`src/cli` == `src/cli/**`).
- Patterns evaluated in order, last match wins (`.gitignore` style).
- Gitignored files are excluded.
- `docsync.lock` and `docsync.yaml` are always excluded from matches.

### Doc discovery

- Default: scan all files not ignored by `.gitignore` for `docsync` frontmatter, plus every doc listed in `docsync.yaml`.
- Configurable via `include` / `exclude` in `docsync.yaml`.

### Change detection

- **Content hashes only. No git revisions** in the lock (rebase/squash/merge would make SHAs unreliable).
- Per-file hashes, so the report lists exactly which files were modified, added or removed. A diff, if wanted, is the agent's job (e.g. `git diff origin/master -- <files>`).
- Hash: SHA-256 truncated to 16 hex chars.
- Normalization before hashing:
  - Text: CRLF to LF.
  - Binary (NUL byte in first 8KB): raw bytes.
  - If the target file is itself a bound doc: strip its `docsync` frontmatter block first.
- The doc's own content is never part of its own staleness.

### Transitive chains (A -> B -> C)

E.g. `src/` <- `CLAUDE.md` (B) <- `README.md` (C).

- Staleness is computed from current content only; no propagation, no dependency graph, one pass.
- Stamping B writes only the lock, so B's content is unchanged and C stays `ok`.
- If B's prose is edited, C becomes stale on the next check (correct).
- Editing B's `covers` makes B `stale` (`binding-changed`) but not C, because the frontmatter is stripped before hashing B as a target.
- Cycles are harmless for the same reason.

### Doc states

| State | Meaning | Exit |
|---|---|---|
| `ok` | all hashes match | 0 |
| `stale` | needs review; reason one of `modified`, `added`, `removed`, `unstamped`, `binding-changed` | 1 |
| `invalid` | config error: glob matches nothing, doc declared twice, bad frontmatter | 2 |

Lock entry whose doc no longer exists: warning on `check`, pruned silently by `stamp`. Not a failure.

### CLI

```
docsync check [docs...]      # gate; exit 0 ok, 1 stale, 2 invalid
docsync stamp [docs...]      # re-hash and write lock; no args = all non-ok docs
docsync status [docs...]     # like check, always exit 0
docsync ls [doc]             # show resolved files per doc (debug globs)
```

Global flags: `--json` (machine output for agents), `--root <dir>` (default: nearest dir with `docsync.yaml`, else git root, else cwd).

- `stamp` trusts the caller; it does not verify that a review happened.
- `--json` emits one object per doc: `{ doc, state, reasons, modified[], added[], removed[] }`.

### Lockfile (`docsync.lock`, committed)

```yaml
version: 1
docs:
  CLAUDE.md:
    covers: ["src/cli/**", "!src/cli/**/*.test.ts", "package.json"]
    files:
      package.json: 9f2c1ab04e7d3c58
      src/cli/check.ts: 1a7e33c0b9d24f61
```

- `covers` stored verbatim; a mismatch with the declaration means `binding-changed`.
- Docs and files sorted, one file per line: deterministic output, merge-friendly.
- Conflict resolution: take either side, then `docsync stamp` (after reviewing any stale docs).

## Architecture

| Module | Responsibility | In -> Out |
|---|---|---|
| `config` | load `docsync.yaml`, discover frontmatter, merge, detect duplicates | root -> `Binding[]` |
| `resolve` | expand `covers` with ignore rules and include/exclude | `Binding` -> files |
| `hash` | normalize and hash | path -> hash |
| `lock` | read/write lock deterministically | file <-> `Lock` |
| `engine` | compare current state against lock (pure, no I/O) | `Binding[]` + hashes + `Lock` -> `DocResult[]` |
| `report` | text and JSON output | `DocResult[]` -> stdout |
| `cli` | command wiring, exit codes | argv |

Internal extractor boundary (not a public plugin API yet):

```ts
interface Extractor {
  matches(target: string): boolean;
  read(target: string, root: string): Promise<Uint8Array>;
}
```

## Scope

**POC:** files, folders, globs with `**`, `*`, `!negate`; Markdown frontmatter + `docsync.yaml`; the four CLI commands; text and JSON output.

**After POC (must-have):** TypeScript symbol targets (`src/api.ts#createUser`) hashed by signature / public shape, via the extractor boundary.

**Later (nice-to-have):** JSON/YAML path targets (`package.json#scripts`), Markdown heading targets, public plugin API.

## Tech

TypeScript 7 (strict), Node 24, ESM, pnpm. Runtime deps: `commander` (+ `@commander-js/extra-typings`), `yaml`, `zod`, `picocolors`. Tooling: tsup, vitest, oxlint, oxfmt, knip, husky, lint-staged, commitlint. Pattern matching and gitignore handling are specified in SPEC §7-§8; whether they are hand-written or use a library is a planning decision.

## Error handling

- All config errors are collected and reported together, never fail-fast.
- Every message names the fix. Codes and exit codes: SPEC §16, §17.
- Unreadable covered file, broken symlink: error. Symlinked files are followed; symlinked directories are not.
- Corrupt or wrong-version lock: error; `docsync stamp --rebuild` after reviewing every doc.
- `stamp` refuses and writes nothing when any target is invalid.
- In `--json` mode, diagnostics are part of the single JSON document.

## Testing

- Unit tests per spec section; `engine` is pure and table-tested over every state and reason, including A -> B -> C and cycles.
- `hash`: CRLF/LF equivalence, binary detection, frontmatter stripping.
- `lock`: round-trip and byte-identical output regardless of input order.
- End-to-end: temp-repo fixtures driving the built CLI; exit codes and `--json` snapshot-tested.

## Packaging

npm package `docsync` (name free on npmjs as of 2026-10-06), bin `docsync`, single bundle `dist/index.js`. No library API in the POC; the CLI and `--json` are the contract.

## Refinements made while writing SPEC.md

- Default doc discovery: `include: ["**/*.md"]` over the Universe (non-ignored files).
- Glob grammar also supports `?`, `[...]`, `{a,b}` and `\` escapes; a pattern matching a directory covers everything under it.
- `--json` emits one envelope `{version, command, exitCode, docs[], diagnostics[]}` instead of one object per doc.
- Frontmatter stripping hashes the remaining frontmatter as canonical JSON, so reformatting frontmatter does not cause staleness.
- `stamp --rebuild` added for a corrupt lock. Exit code 70 for internal failures.
- `docsync.yaml` has a required `version: 1`.

## Sources

- Behavior: [SPEC.md](../../SPEC.md).
- Principles and vision: [PRINCIPLES.md](../../PRINCIPLES.md), [VISION.md](../../VISION.md).
