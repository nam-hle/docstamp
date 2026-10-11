---
title: Run it in CI
---

# Run it in CI

`docstamp` exits 0 when every doc is `ok`, 1 when a doc is stale, and 2 on an error or an invalid
doc ([exit codes](/reference/topics/exit-codes)). Run it on every pull request and fail the job on a
non-zero exit.

## The GitHub Action

The repository ships a composite action. It runs `docstamp`, writes the report to the job summary,
posts it as one pull request comment that later runs update, and fails the job on exit 1 or 2. Fetch
full history so the changed-file report can read it; the verdict itself does not need it. Replace
`<version>` with a released version that contains `action.yml`: there is no floating tag before 1.0,
because a breaking change raises the minor version.

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
| `version` | required | npm version of `docstamp` to run, or a path to a packed tarball. The action installs it into a temporary directory, so your project needs no `docstamp` dependency. |
| `comment` | `true` | Post the pull request comment. |
| `working-directory` | `.` | Passed to `docstamp` as `--cwd`; the commands in the comment then carry it (`docstamp update CLAUDE.md --cwd docs`). |
| `github-token` | `github.token` | Needs `pull-requests: write` for the comment. |

The comment lists each stale file with its changed dependencies and the resolving command:

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

On a pull request from a fork the token is read-only, so no comment is posted and the same text goes
to the job summary only. The comment never runs `update`: only a review writes the lock.

## Without the action

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

`pnpm/action-setup` installs the pnpm version named by `packageManager` in your `package.json`. With
npm, drop the `pnpm/action-setup` step and `cache: pnpm`, then run `npm ci` and `npx docstamp`. Pin
the actions to commit SHAs if your policy requires it.
