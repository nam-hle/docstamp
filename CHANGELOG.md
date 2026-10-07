# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0](https://github.com/nam-hle/docstamp/compare/v0.2.1...v0.3.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* migrating from 0.2.x. (1) Configuration: rename the top-level key dependents to files and each covers to dependencies, and set version: 2; version 1 is rejected with E_CONFIG_VERSION. A docstamp.config.ts must use the same keys. (2) Lockfile: it is now version 3 with the top-level key files instead of dependents; a version 2 lock is rejected with E_LOCK_VERSION. Hash values are unchanged: review the stamped files as you normally would, then run docstamp update --all, or rename the key and set version: 3 by hand. The first changed-file report after migrating may be empty until the next update. (3) Commands: the old list-dependents is now list-dependencies; list-dependents <file>... now answers the reverse question (which files depend on a file, via which pattern) and requires at least one file. (4) --json (output version 2): the top-level dependents array is files, each entry's dependent member is file, covers is dependencies, list-dependencies adds resolvedFiles, diagnostics carry file instead of dependent, summary is omitted when a run fails before evaluating anything, and in update an entry with written true reports state ok. (5) Text output: covers lines are now depends lines and resolved lines list the selected files; update prints unchanged for an entry whose recorded hash did not change; there is no summary line when a run fails before evaluating anything and no next: line after a refused update. (6) Error codes: E_EMPTY_COVERS is E_EMPTY_DEPENDENCIES, E_UNKNOWN_DEPENDENT is E_UNKNOWN_FILE, E_DEPENDENT_MISSING is E_FILE_MISSING. (7) --root no longer accepts another option as its value: --root --json is now E_USAGE instead of E_ROOT.

### Features

* name config keys files and dependencies, add reverse list-dependents ([d06fa38](https://github.com/nam-hle/docstamp/commit/d06fa38749d895a76323b465d446657e9f3b4398))


### Bug Fixes

* end-to-end suite and the output fixes it found ([#6](https://github.com/nam-hle/docstamp/issues/6)) ([8289fc3](https://github.com/nam-hle/docstamp/commit/8289fc33435837d6359730595f4724527376f67a))


### Documentation

* add a compatibility policy and lead the README with documentation ([#9](https://github.com/nam-hle/docstamp/issues/9)) ([df72e20](https://github.com/nam-hle/docstamp/commit/df72e20df8232f011190280c5baa16b752b03d8e))
* prepare the repository for going public ([#7](https://github.com/nam-hle/docstamp/issues/7)) ([0538031](https://github.com/nam-hle/docstamp/commit/05380318a4fd6ec0dfed1984350ab73b19d70b17))


### Internal

* Bump pnpm/action-setup from 6.0.8 to 6.1.0 in /.github/actions/setup in the github-actions group across 1 directory ([#8](https://github.com/nam-hle/docstamp/issues/8)) ([e46fd5b](https://github.com/nam-hle/docstamp/commit/e46fd5b06c434a0dd6e6c76eb606e6cfd63e8d8b))
* ignore major @types/node bumps ([#11](https://github.com/nam-hle/docstamp/issues/11)) ([bcaf2c0](https://github.com/nam-hle/docstamp/commit/bcaf2c0251b8ffe04156c79d75090470b96fd91f))

## [0.2.1](https://github.com/nam-hle/docstamp/compare/v0.2.0...v0.2.1) (2026-10-06)


### Features

* read the configuration from TypeScript or JavaScript files ([743471e](https://github.com/nam-hle/docstamp/commit/743471e4d18f584cffbc580157a083bbd5e0ea22))


### Bug Fixes

* reject Proxy values in script carriers and document loader caching ([f8029bd](https://github.com/nam-hle/docstamp/commit/f8029bd9d25cbcd6811ca8d9053b76ab0d357ae8))


### Internal

* point repository url at the renamed repo ([d5fb0e8](https://github.com/nam-hle/docstamp/commit/d5fb0e8bf3e2f672090504b1269e849cb81b7f72))

## [0.2.0](https://github.com/nam-hle/docsync/compare/v0.1.0...v0.2.0) (2026-10-06)


### ⚠ BREAKING CHANGES

* command, config and lock files are renamed docstamp, docstamp.yaml, docstamp-lock.yaml.

### Features

* rename docsync to docstamp ([c3d6032](https://github.com/nam-hle/docsync/commit/c3d6032786bfbbb98ff1b0de0d24bbe7f3f0e6e7))

## 0.1.0 (2026-10-06)


### ⚠ BREAKING CHANGES

* **cli:** restructure the CLI into subcommands
* **lock:** Lockfile version 2 as docsync-lock.yaml

### Features

* **cli:** argument parsing per SPEC 13.2 ([cc7d118](https://github.com/nam-hle/docsync/commit/cc7d118030372899440ef68a0b3da58587bcc2f4))
* **cli:** check and write commands with text and JSON output per SPEC 13-16 ([a5ebb4c](https://github.com/nam-hle/docsync/commit/a5ebb4ccc21f06206d7a58b3a25c75bbc7588daa))
* **cli:** lexical path resolution and selection per SPEC 13.3-13.4 ([b1f9eac](https://github.com/nam-hle/docsync/commit/b1f9eac67b62d341b33fe4f24435718cf4dfd2d9))
* **cli:** restructure the CLI into subcommands ([542bc70](https://github.com/nam-hle/docsync/commit/542bc7081d5915dde6b00c626e2fa1325d0f5a83))
* **config:** strict YAML profile and docsync.yaml reading per SPEC 9 ([6ec32c3](https://github.com/nam-hle/docsync/commit/6ec32c3c17563707a7f2733c1be2178ae49c88e7))
* **core:** records, path order, quote, diagnostics ([e612e62](https://github.com/nam-hle/docsync/commit/e612e62d628a0d60414bf7b5df2c3fe467147a02))
* **engine:** resolve covers and evaluate per SPEC 8.5 and 12 ([89089c1](https://github.com/nam-hle/docsync/commit/89089c1cfff38ff3d21fe37cb3f2684c98337816))
* **hash:** normalized content, file and cover hash per SPEC 10 ([298406d](https://github.com/nam-hle/docsync/commit/298406de7c614025be428d4239b3901a1290aaf3))
* **lock:** Lockfile version 2 as docsync-lock.yaml ([56e94d7](https://github.com/nam-hle/docsync/commit/56e94d7408ee25d9f81b60106c29520343ccb7d0))
* **lock:** read, canonical text and atomic write per SPEC 11 ([c2edeea](https://github.com/nam-hle/docsync/commit/c2edeea294eb64f0d3624a2f2cbe887896076e69))
* **pattern:** glob matching and selection per SPEC 8.2-8.4 ([aa0a617](https://github.com/nam-hle/docsync/commit/aa0a617ec72c1f109586aaeea452665683625786))
* **pattern:** parse patterns per SPEC 8.1 ([6b40212](https://github.com/nam-hle/docsync/commit/6b402129b95bfbde33d42561c06fc44232083c98))
* report changed covered files for stale dependents (SPEC §12.3) ([7f3823e](https://github.com/nam-hle/docsync/commit/7f3823e52ba71bbdb3b5fce0260df581210b8957))
* **universe:** ignore rule dialect per SPEC 7.3 ([9948988](https://github.com/nam-hle/docsync/commit/9948988ffd5bb66683e78870799b568c0bd5df00))
* **universe:** root discovery and universe walk per SPEC 6-7 ([5c16911](https://github.com/nam-hle/docsync/commit/5c1691104fef4ded53ea6881381e132b04bd2fae))


### Bug Fixes

* **cli:** take the command from the first non-option argument ([2568dfc](https://github.com/nam-hle/docsync/commit/2568dfcf7eaab2a295fe2f5fd07dcfe5ab9dcb3e))
* **config:** lstat docsync.yaml, strict UTF-8 decode, more version tests ([fdf594f](https://github.com/nam-hle/docsync/commit/fdf594ffff273d651db71b2c2c59ed6d5ac5e7dc))
* harden changed-file report base commit, shallow and env handling ([e802b44](https://github.com/nam-hle/docsync/commit/e802b44e7e372ae6b55372d4bca3a6728a755380))
* **lock:** raise E_LOCK on unreadable lock, E_UNREADABLE on write failure ([ed09c78](https://github.com/nam-hle/docsync/commit/ed09c78cf4a3a13ba7c82b1b48f86854f603ea66))
* **lock:** read plain hash by source, clean temp file, sorted key compare ([0b4ab3c](https://github.com/nam-hle/docsync/commit/0b4ab3c03fe83bce09be1cef19e88e95151d6972))


### Performance

* **run:** memoize file hashes per run ([4ece377](https://github.com/nam-hle/docsync/commit/4ece3775979d246f6934faf4372cc8254b476edc))


### Documentation

* add spec, principles, vision and CLAUDE.md ([3b951ce](https://github.com/nam-hle/docsync/commit/3b951ced79ccc324742e702219ee4d2b75fdcfdb))
* add v1 implementation plan ([2dd9614](https://github.com/nam-hle/docsync/commit/2dd96142bf65fc646d5cf2333934e17aa4ac0584))
* apply spec review findings and reduce CLI to check and --write ([ca34e86](https://github.com/nam-hle/docsync/commit/ca34e8674ad8c87d854121e21994c8294d171f5a))
* declare all bindings in docsync.yaml, drop frontmatter ([e035032](https://github.com/nam-hle/docsync/commit/e0350325ff96a4719ba85b6643851dd7e3c8425e))
* fix CLAUDE.md details, widen docsync.yaml covers, refresh lock ([f9ec47b](https://github.com/nam-hle/docsync/commit/f9ec47bc44adf35f3c8ee352c3908aa229795003))
* generalize bindings from docs to any dependent file ([e6e873f](https://github.com/nam-hle/docsync/commit/e6e873f8fbfa9113559a6664360272fc98f2c1b7))
* store one cover hash per dependent in the lock ([60861af](https://github.com/nam-hle/docsync/commit/60861af6d26c2a5212ca8b6be762d1959028a1b0))


### Internal

* add MIT license and build before publish ([129f145](https://github.com/nam-hle/docsync/commit/129f145b490ff755db90a6a86d0c91394232204f))
* dogfood docsync on its own docs and add README ([20717ed](https://github.com/nam-hle/docsync/commit/20717ed38535a74045cb84c846bf168996c3b9e4))
* **e2e:** end-to-end CLI workflow ([4026200](https://github.com/nam-hle/docsync/commit/4026200eb2b00bfc532414d3481cc6294574ecc6))
* scaffold project and gate ([4bfddc6](https://github.com/nam-hle/docsync/commit/4bfddc6a38202490f2ab1a800d751667998c9597))
* start releases at 0.1.0 ([ba02eac](https://github.com/nam-hle/docsync/commit/ba02eac141278a8c5ba537b35277b9cfbcb9b13c))
* **universe:** clean up temp trees, cover rule popping and nested docsync files ([956bc07](https://github.com/nam-hle/docsync/commit/956bc0751fc02dad371506dd13a0fa582ada79b2))

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
