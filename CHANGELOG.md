# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **Breaking:** the Lockfile is now `docsync-lock.yaml`, format version 2: one `"<dependent>": <hash>`
  line per Dependent. It no longer records the patterns ([SPEC §11](docs/SPEC.md#11-lockfile)).
- **Breaking:** the `binding-changed` Reason is removed; a pattern change that alters the covered
  set is reported as `content-changed`, and one that does not needs no review. JSON consumers must
  stop expecting `binding-changed` in `reasons`.
- `docsync-lock.yaml` replaces `docsync.lock` in the Universe exclusion; add
  `docsync-lock.yaml text eol=lf` to `.gitattributes`.

### Migration

A leftover `docsync.lock` is refused with `E_LOCK_VERSION`. Delete it, review every Dependent, then
run `docsync --write --all`. The write does not delete `docsync.lock`.
