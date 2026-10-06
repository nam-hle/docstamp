# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **Breaking:** the CLI is now subcommands: `docsync [check]`, `docsync update`,
  `docsync list-dependents`, `docsync help` and `docsync version`
  ([SPEC §13](docs/SPEC.md#13-command-line)). A bare `docsync` is still `check`.
- **Breaking:** `--write` is removed; use `docsync update`. `--files` is removed; use
  `docsync list-dependents`, which lists each Dependent with its patterns and covered files and does
  not read the Lockfile. Passing either exits 2 with `E_USAGE` naming the replacement. `--all` is
  valid only for `update`.
- **Breaking:** JSON output: `mode` is `check`, `update` (was `write`) or `list-dependents`, and
  `check` no longer has the `files` member per Dependent. The `next:` line reads
  `docsync update <file>...`.
- **Breaking:** the Lockfile is now `docsync-lock.yaml`, format version 2: one `"<dependent>": <hash>`
  line per Dependent. It no longer records the patterns ([SPEC §11](docs/SPEC.md#11-lockfile)).
- **Breaking:** the `binding-changed` Reason is removed; a pattern change that alters the covered
  set is reported as `content-changed`, and one that does not needs no review. JSON consumers must
  stop expecting `binding-changed` in `reasons`.
- `docsync-lock.yaml` replaces `docsync.lock` in the Universe exclusion; add
  `docsync-lock.yaml text eol=lf` to `.gitattributes`.

### Migration

A leftover `docsync.lock` is refused with `E_LOCK_VERSION`. Delete it, review every Dependent, then
run `docsync update --all`. The write does not delete `docsync.lock`.
