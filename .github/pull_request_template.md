## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `docs/SPEC.md` is updated first for any behavior change, and the code cites the clause
- [ ] Tests are added or updated, named by clause
- [ ] `pnpm test` is green
- [ ] Stale docs were re-checked against their dependencies before `docstamp update`, not just re-stamped
- [ ] The PR title is a Conventional Commit (`!` and a `BREAKING CHANGE:` footer for breaking changes)

## Compatibility

- [ ] Touches anything in the breaking table of SPEC §17.2? Then: title `!`, `BREAKING CHANGE:` footer, version bump (lock, config or JSON), migration note
- [ ] Golden hash and selection vectors (`tests/unit/golden.test.ts`) are unchanged, or deliberately updated together with a lock version bump
