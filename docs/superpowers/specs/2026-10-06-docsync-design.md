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

TypeScript (strict), Node 22/24, ESM, pnpm. Candidate deps (to confirm before install): `tinyglobby`, `ignore`, `yaml`, `commander`. Frontmatter parsed by hand (leading `---` block + `yaml`).

## Open items

- Error handling and messages.
- Testing strategy.
- Packaging / distribution (npm name `docsync` availability).
