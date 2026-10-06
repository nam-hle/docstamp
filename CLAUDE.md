# docsync

A deterministic snapshot gate for hidden links between files. Each Dependent (usually a doc, but
any file) declares the files it covers; `docsync` fails when they changed since the Dependent
was last reviewed, and `docsync --write <file>` records the review. Terms are defined in
[SPEC §4](docs/SPEC.md#4-terms); use them, not synonyms.

Why it is built this way is imported below and binds every change. Read both before anything
else, and check the work against them.

@docs/PRINCIPLES.md
@docs/VISION.md

## The contract

[docs/SPEC.md](docs/SPEC.md) defines all observable behavior: formats, algorithms, output, exit
codes. It is the source of truth.

- Behavior changes start in the spec, then code and tests follow in the same change.
- Code that implements an algorithm cites its clause (`// §8.4`). Tests are named by clause
  (`describe('§13 Evaluate', ...)`).
- A behavior the spec does not define is a spec gap: fix the spec, do not invent behavior in code.
- [docs/superpowers/specs/](docs/superpowers/specs/) holds design rationale: why, not what. It is
  frozen once its plan ships.

## Runtime

Node.js >= 24. ESM only.

## Tooling

- **pnpm** is the only package manager. Never delete `pnpm-lock.yaml`; update it in place.
- **TypeScript 7**, strict, `tsc --noEmit` over src, tests and root configs.
- **tsup** bundles `src/index.ts` into a single `dist/index.js` with a `docsync` bin.
- **vitest** for unit and end-to-end tests.
- **oxlint** (type-aware) and **oxfmt** for lint and format; `pnpm format` orders imports, never
  by hand.
- **knip** for unused dependencies, files and exports.
- No commit hooks are installed; the gate is the only enforcement.
- The only runtime dependency is **yaml**. Any other dependency needs a stated reason and the
  user's approval.

## The gate

`pnpm test` runs format check, lint, types, knip, the build, every test suite and `docsync`
itself. Run it before committing.
Nothing narrower is a substitute: a single vitest file or a successful build is iteration, not
verification. If the gate cannot run, say which steps did.

## Layout

```
docsync/
├── src/
│   ├── index.ts          # entry; wires the CLI
│   ├── core/             # shared types, path order, quoting, diagnostics (§3, §4, §15)
│   ├── cli/              # args, path resolution, run; exit codes (§13, §16)
│   ├── config/           # docsync.yaml (§9)
│   ├── universe/         # Root, ignore rules, walk (§6, §7)
│   ├── pattern/          # grammar, matching, selection (§8)
│   ├── hash/             # normalization, file and cover hash (§10)
│   ├── lock/             # read, canonical write (§11)
│   ├── engine/           # evaluation; pure, no I/O (§12)
│   └── report/           # text and JSON output, diagnostics (§14, §15)
├── tests/
│   ├── helpers/          # temp-repo fixture builder shared by tests
│   ├── unit/             # one file per spec section
│   └── e2e/              # temp-repo fixtures driving the built CLI
└── docs/
    ├── SPEC.md           # the contract
    ├── PRINCIPLES.md
    ├── VISION.md
    └── superpowers/      # design rationale and plans
```

## Critical Invariants

Only what no test can check stays here.

- **No LLM call, no network, no git invocation, no clock** anywhere in `src/` (SPEC §2).
- **`engine/` does no I/O.** Everything it needs is passed in, so every state is unit-testable.
- **Nothing writes the Lockfile automatically.** Only `docsync --write` with named files or
  `--all` may write it; a Write is the record that a review happened.

## Known Anti-Patterns

- Never add a state, reason or exit code without a spec change. Few states is a principle.
- Never sort with `localeCompare` or `Intl`; path order is UTF-16 code unit order (§3.3).
- Never restate a spec rule in another doc; link to the clause.
- Never leave a settled finding only in a commit message; write it down in `docs/`.

## Commits

Conventional Commits (by convention, not enforced by tooling). `!` marks a breaking change to the CLI, the
Lockfile or the JSON output, and gets a CHANGELOG entry.

## Docs

Once `docsync` runs, this repo uses it on itself: `docsync.yaml` binds `CLAUDE.md` and the docs
to the code they describe, and `pnpm test` runs `docsync`. When it fails:

1. Run `docsync --files <file>`, then `git diff origin/main -- <those files>`, and re-check the
   doc's claims against the change.
2. Fix what is no longer true.
3. Only then run `docsync --write <file>`.

Never write without step 1. A Write without a review hides the drift the gate exists to catch.
Never use `--write --all` to make CI green.
