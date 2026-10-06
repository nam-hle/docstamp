# docsync

A deterministic snapshot gate for hidden links between files. Each Dependent (usually a doc, but
any file) declares the files it covers; `docsync check` fails when they changed since the
Dependent was last reviewed, and `docsync stamp` records the review. Terms are defined in
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
- **husky + lint-staged + commitlint**: pre-commit formats staged files; commit messages follow
  Conventional Commits.
- Runtime dependencies: **commander** (with `@commander-js/extra-typings`), **yaml**, **zod**,
  **picocolors**. Any other dependency needs a stated reason and the user's approval.

## The gate

`pnpm test` runs format check, lint, types, knip and every test suite. Run it before committing.
Nothing narrower is a substitute: a single vitest file or a successful build is iteration, not
verification. If the gate cannot run, say which steps did.

## Layout

```
docsync/
├── src/
│   ├── index.ts          # entry; wires the CLI
│   ├── cli/              # commands, exit codes (SPEC §14, §17)
│   ├── config/           # docsync.yaml + frontmatter discovery (§9, §10)
│   ├── universe/         # Root, ignore rules, walk (§6, §7)
│   ├── pattern/          # grammar, matching, selection (§8)
│   ├── hash/             # normalization, hash (§11)
│   ├── lock/             # read, canonical write (§12)
│   ├── engine/           # evaluation; pure, no I/O (§13)
│   └── report/           # text and JSON output (§15, §16)
├── tests/
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
- **Nothing stamps automatically.** No command, hook or flag may write the Lockfile without the
  caller asking for `stamp`; the stamp is the record that a review happened.

## Known Anti-Patterns

- Never add a state, reason or exit code without a spec change. Few states is a principle.
- Never sort with `localeCompare` or `Intl`; path order is UTF-16 code unit order (§3.3).
- Never restate a spec rule in another doc; link to the clause.
- Never leave a settled finding only in a commit message; write it down in `docs/`.

## Commits

Conventional Commits, enforced by commitlint. `!` marks a breaking change to the CLI, the
Lockfile or the JSON output, and gets a CHANGELOG entry.

## Docs

Once `docsync` runs, this repo uses it on itself: `CLAUDE.md` and the docs carry `docsync`
frontmatter and `pnpm test` runs `docsync check`. When it fails:

1. Read the listed files and re-check the doc's claims against them.
2. Fix what is no longer true.
3. Only then run `docsync stamp <doc>`.

Never stamp without step 1. A stamp without a review hides the drift the gate exists to catch.
