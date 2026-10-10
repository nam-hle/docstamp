# Contributing

Thanks for helping. Read [docs/PRINCIPLES.md](docs/PRINCIPLES.md) and [docs/VISION.md](docs/VISION.md) first; every change is checked against them.

## Scope

docstamp stays small on purpose. A change must keep it:

- deterministic: the same tree gives the same verdict and the same bytes on any machine;
- offline: no network access anywhere in `packages/docstamp/src/`;
- free of LLM calls;
- read-only toward git: `git` is only invoked in `packages/docstamp/src/host/node-git.ts`, for the advisory changed-file report, never for the verdict, the exit code or the lock.

New commands, states, options and dependencies need a strong reason. Open an issue before starting anything large.

## Setup

Requires Node.js 24 and pnpm.

```sh
pnpm install
pnpm test
```

`pnpm test` is the gate: format check, lint, types, knip, the build, the unit and end-to-end tests, and docstamp run on this repository. Run it before you push. A single vitest file or a successful build is iteration, not verification.

## Spec first

[packages/docstamp/docs/SPEC.md](packages/docstamp/docs/SPEC.md) defines all observable behavior and is the source of truth.

1. Change the spec first. A behavior the spec does not define is a spec gap: fix the spec, do not invent behavior in code.
2. Change the code and tests in the same pull request.
3. Cite the clause in code (`// §8.4`) and name tests by clause (`describe('§12.1 Evaluate', ...)`).
4. Do not restate a spec rule in another document; link to the clause.

## Docs self-check

This repository runs docstamp on itself ([docstamp.yaml](docstamp.yaml)). When `pnpm test` reports a doc as stale:

1. Run `docstamp list-dependencies <file>` and `git diff origin/main -- <those files>`.
2. Re-check what the doc claims against the change, and fix what is no longer true.
3. Only then run `node dist/index.js update <file>` and commit `docstamp-lock.yaml`.

Never run `update --all` to make a check pass. An update without a review hides the drift the gate exists to catch.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/). Commit types drive releases through release-please, so pick them carefully: `feat`, `fix`, `perf`, `docs`, `refactor`, `test`, `chore`.
- Pull requests are squash-merged, and the pull request title becomes the commit message on `main`. Write the title as a Conventional Commit.
- A breaking change ([SPEC §17.2](packages/docstamp/docs/SPEC.md#172-breaking-changes)) needs `!` after the type (`feat!: ...`) and a `BREAKING CHANGE:` footer that says what to do; see [Breaking changes](#breaking-changes).
- Do not edit `package.json` versions or `CHANGELOG.md` by hand; release-please owns them.
- Do not commit generated output: `dist/` is ignored, and `schema.json` is regenerated with `pnpm schema`.

## Breaking changes

Users commit a lock and gate CI on it, so a change that alters what a lock or a verdict means is breaking. [SPEC §17](packages/docstamp/docs/SPEC.md#17-compatibility) classifies them: hash inputs, selection, formats, verdicts, the CLI and JSON contract, and the platform.

Checklist:

1. Look the change up in the table of [SPEC §17.2](packages/docstamp/docs/SPEC.md#172-breaking-changes). If a row fits, it is breaking; if it only matches [SPEC §17.3](packages/docstamp/docs/SPEC.md#173-non-breaking-changes), it is not.
2. Change the spec first, including the new version number and, for a hash or selection change, the migration (a refused older lock must say how to migrate: `E_LOCK_VERSION`).
3. Bump the version that the change touches: the lock `version` for any change to hash inputs or selection ([SPEC §17.4](packages/docstamp/docs/SPEC.md#174-the-hash-guarantee)); the configuration `version` for a changed key or accepted file name; the JSON `version` for a removed, renamed or re-meant member. Adding a JSON member needs none.
4. Update the golden vectors deliberately (below), only together with a lock version bump when a hash or selection vector moved.
5. Title the pull request `feat!: ...` or `fix!: ...` and add the `BREAKING CHANGE:` footer.

The footer is the migration note. release-please copies it under "BREAKING CHANGES" in `CHANGELOG.md` and the GitHub release, so write it for a user who has never seen the change: what it was, what it is now, and the steps.

A hypothetical example:

```text
feat!: hash symbolic link targets with a new tag

BREAKING CHANGE: a symbolic link is hashed as `link`, 0x00 and its target, where it was
hashed as the file it points to. Before: `docstamp` was ok after the target changed.
After: it is not. Migration: review every file with a link dependency, then run
`docstamp update --all` to write a version 4 lock.
```

### Golden vectors

`packages/docstamp/tests/unit/golden.test.ts` holds literal hashes and file lists computed from a fixed tree ([SPEC §17.7](packages/docstamp/docs/SPEC.md#177-pinned-vectors)). A failure means the change is breaking: the message says so. Do not paste the new value over the old one. To update on purpose:

1. Complete steps 1 to 3 above, so the spec and the lock version already say the vector moves.
2. Run the test, copy each received value into its literal, and read every changed line: each one must be explained by the change.
3. Describe the moved vectors in the `BREAKING CHANGE:` footer.

Do not change `packages/docstamp/tests/helpers/golden-tree.ts` without the same care: the tree defines the vectors.

### Versioning

Before 1.0.0, a breaking change raises the minor version; from 1.0.0, the major version ([SPEC §17.6](packages/docstamp/docs/SPEC.md#176-versioning-and-migration-notes)). release-please computes this from the `!` and the footer. Do not edit the version by hand.

## Conduct and security

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in public issues.
