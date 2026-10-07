# Contributing

Thanks for helping. Read [docs/PRINCIPLES.md](docs/PRINCIPLES.md) and [docs/VISION.md](docs/VISION.md) first; every change is checked against them.

## Scope

docstamp stays small on purpose. A change must keep it:

- deterministic: the same tree gives the same verdict and the same bytes on any machine;
- offline: no network access anywhere in `src/`;
- free of LLM calls;
- read-only toward git: `git` is only invoked in `src/history/`, for the advisory changed-file report, never for the verdict, the exit code or the lock.

New commands, states, options and dependencies need a strong reason. Open an issue before starting anything large.

## Setup

Requires Node.js 24 and pnpm.

```sh
pnpm install
pnpm test
```

`pnpm test` is the gate: format check, lint, types, knip, the build, the unit and end-to-end tests, and docstamp run on this repository. Run it before you push. A single vitest file or a successful build is iteration, not verification.

## Spec first

[docs/SPEC.md](docs/SPEC.md) defines all observable behavior and is the source of truth.

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
- A breaking change to the CLI, the lock or the JSON output needs `!` after the type (`feat!: ...`) and a `BREAKING CHANGE:` footer that says what to do.
- Do not edit `package.json` versions or `CHANGELOG.md` by hand; release-please owns them.
- Do not commit generated output: `dist/` is ignored, and `schema.json` is regenerated with `pnpm schema`.

## Conduct and security

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in public issues.
