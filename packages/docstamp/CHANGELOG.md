# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.0](https://github.com/nam-hle/docstamp/compare/v0.4.0...v0.5.0) (2026-10-09)


### ⚠ BREAKING CHANGES

* a file argument that resolves outside the root (usually because the current directory is not the root) is now E_USAGE for check, update, list-dependencies and stats; it was E_UNKNOWN_FILE there, and was already E_USAGE for list-dependents and suggest. The message and the exit code (2) are unchanged. Migration: a consumer that looked for E_UNKNOWN_FILE with a message saying the argument resolves outside the root should read E_USAGE instead; E_UNKNOWN_FILE now always means a file inside the root that is neither declared nor carries an inline block. No configuration, Lockfile or hash changes.
* one mistake now gives one diagnostic. (1) A configuration file whose only stand-in for the missing `files` key is a key one or two edits away from it, such as `fils: {}`, reports E_UNKNOWN_KEY alone (did you mean "files"?); the extra E_CONFIG with subject `files` is gone. (2) A file whose patterns select nothing because an inclusion matches no file (for example `src\core` as the only pattern, or a deleted directory) reports E_EMPTY_PATTERN alone; the extra E_EMPTY_DEPENDENCIES is gone. E_EMPTY_DEPENDENCIES is now raised only when no inclusion is empty yet together the patterns select nothing (no inclusion at all, or exclusions that remove every file). The verdict (invalid) and exit code 2 are unchanged. Migration: a consumer that looked for the E_CONFIG of a missing `files` should also accept E_UNKNOWN_KEY, and one that looked for E_EMPTY_DEPENDENCIES on a file should also accept E_EMPTY_PATTERN on that file. In text mode a subject containing `\` is printed as written instead of quoted; --json is unchanged. No configuration, Lockfile or hash changes.
* a first argument that is not a command, names nothing on disk, and is one or two edits from a command name (check, update, list-dependencies, list-dependents, stats, suggest, help, version), such as `docstamp updte`, is now E_USAGE "Unknown command "updte"; did you mean "update"?" with exit 2. Before, it was a file argument of check (E_UNKNOWN_FILE, or a root error such as E_CONFIG_MISSING), and with --help it printed the index and exited 0. Migration: spell the command correctly; to name a file that does not exist and is named like a command, write `--` before it (`docstamp -- updte`). An argument that is an existing file or directory is read as before. No configuration, Lockfile or hash changes.

### Features

* default-presets applied to every file without its own use ([#58](https://github.com/nam-hle/docstamp/issues/58)) ([088c410](https://github.com/nam-hle/docstamp/commit/088c4108109127f347dc4e0a2af6f8c39c54ef59))


### Bug Fixes

* help page drift and small gaps ([#60](https://github.com/nam-hle/docstamp/issues/60)) ([b9ff9c8](https://github.com/nam-hle/docstamp/commit/b9ff9c828f3437c1f8f04fcb5b4ad6a51f987695))
* rename lines once per report; direct dependents first in transitive text ([#62](https://github.com/nam-hle/docstamp/issues/62)) ([937f302](https://github.com/nam-hle/docstamp/commit/937f3026c3224ac56495a04287161abbf31e93ce))
* report a file argument outside the root as E_USAGE for every command ([bd3e325](https://github.com/nam-hle/docstamp/commit/bd3e32513746f7a0bc39e0f9d366dde9a0765be1))
* report a mistyped command instead of reading it as a file ([bd3e325](https://github.com/nam-hle/docstamp/commit/bd3e32513746f7a0bc39e0f9d366dde9a0765be1))
* report one diagnostic per configuration or pattern mistake ([bd3e325](https://github.com/nam-hle/docstamp/commit/bd3e32513746f7a0bc39e0f9d366dde9a0765be1))


### Documentation

* lead the README with the intention and the benefits ([#63](https://github.com/nam-hle/docstamp/issues/63)) ([da32ceb](https://github.com/nam-hle/docstamp/commit/da32ceb9633ffb95a23d9f067228fe15bff75e87))

## [0.4.0](https://github.com/nam-hle/docstamp/compare/v0.3.1...v0.4.0) (2026-10-08)


### ⚠ BREAKING CHANGES

* **inline:** for an inline block with an unknown key and no `dependencies`, the Diagnostic codes no longer include E_BLOCK with subject `dependencies`; the file is still invalid with exit code 2. Migration: a consumer that looked for E_BLOCK on `dependencies` for such a file should read E_UNKNOWN_KEY instead.
* **patterns:** migrating from 0.3.x. A `!` exclusion that selects no file is no longer E_EMPTY_PATTERN (an error that made the file invalid and exited 2). It is now the warning W_EMPTY_EXCLUSION, attached to the file, shown on stderr and in the file's diagnostics in --json, and it never changes the file's state or the exit code, so a file that was invalid only for this reason is now ok or stale. Positive patterns keep E_EMPTY_PATTERN, and a file whose patterns together select no file stays E_EMPTY_DEPENDENCIES. Nothing in the configuration, the lock file or the inline hashes needs to change, and no hash value moves. If a CI relied on exit 2 to catch a mistyped exclusion, look for W_EMPTY_EXCLUSION in the output instead. The E_EMPTY_PATTERN message also now says when a literal path exists on disk but is ignored by .gitignore or the ignore list.

### Features

* add docstamp stats to measure how noisy a dependency list is ([#32](https://github.com/nam-hle/docstamp/issues/32)) ([d65f18a](https://github.com/nam-hle/docstamp/commit/d65f18a36a726c27da5c336e841c4045255608be))
* add docstamp suggest to propose dependencies from the paths a doc mentions ([#35](https://github.com/nam-hle/docstamp/issues/35)) ([30cc8df](https://github.com/nam-hle/docstamp/commit/30cc8df4185198608d6390cee458ae224e1798af))
* **check:** report edited dependency lists, change counts and renames ([#39](https://github.com/nam-hle/docstamp/issues/39)) ([5541bab](https://github.com/nam-hle/docstamp/commit/5541bab23aba494c041b6e3479534ba608271b38))
* **check:** selection changes, untracked renames in the review command, output consistency ([#49](https://github.com/nam-hle/docstamp/issues/49)) ([c1f2880](https://github.com/nam-hle/docstamp/commit/c1f2880af6b85896848206d26d741852ccfb36d1))
* **check:** shrink the report and make it a review aid ([#36](https://github.com/nam-hle/docstamp/issues/36)) ([9d7f821](https://github.com/nam-hle/docstamp/commit/9d7f821878dd98fe45b2366e4e6b3165deba48b3))
* **inline:** report one diagnostic per unknown key in an inline block ([17fbe48](https://github.com/nam-hle/docstamp/commit/17fbe4854df74540e05a10e69321e73cf3d95398))
* list the dependents of dependents with list-dependents --transitive ([17fbe48](https://github.com/nam-hle/docstamp/commit/17fbe4854df74540e05a10e69321e73cf3d95398))
* make the CLI self-documenting with help pages and topics ([#54](https://github.com/nam-hle/docstamp/issues/54)) ([9a2ff13](https://github.com/nam-hle/docstamp/commit/9a2ff1370363d3697399ea04fd544b53844b7861))
* pattern hygiene: shadowed exclusions, empty patterns, backslash hint ([#48](https://github.com/nam-hle/docstamp/issues/48)) ([3fcda97](https://github.com/nam-hle/docstamp/commit/3fcda97165737ef74b8d925cdd5f8dd77323c3e5))
* **patterns:** warn instead of failing on an exclusion that matches nothing, and name ignored paths ([34b01ef](https://github.com/nam-hle/docstamp/commit/34b01ef5f1bfc5f1e4b0b06f8aa30629fa28768c))
* share dependency lists across files with presets ([17fbe48](https://github.com/nam-hle/docstamp/commit/17fbe4854df74540e05a10e69321e73cf3d95398))
* ship a JSON Schema for the inline block ([17fbe48](https://github.com/nam-hle/docstamp/commit/17fbe4854df74540e05a10e69321e73cf3d95398))
* suggest diff, rename hint, stats legend, did-you-mean keys ([#50](https://github.com/nam-hle/docstamp/issues/50)) ([d3290e1](https://github.com/nam-hle/docstamp/commit/d3290e15748bcbc248809e1b742ab31e25a7fc5f))
* warn on duplicate patterns and unknown list-dependents paths, and fix the help wording ([#33](https://github.com/nam-hle/docstamp/issues/33)) ([da69448](https://github.com/nam-hle/docstamp/commit/da69448fae76fc74c41c9334a910e1f6843ee5bb))


### Bug Fixes

* pin core.autocrlf=false for the changed-file report ([#38](https://github.com/nam-hle/docstamp/issues/38)) ([d21eeb3](https://github.com/nam-hle/docstamp/commit/d21eeb30387c47345b3267a4ded6ea591950e125))
* suggest --write keeps declared patterns; covered status, glob test exclusions, config messages ([#55](https://github.com/nam-hle/docstamp/issues/55)) ([c6d8f78](https://github.com/nam-hle/docstamp/commit/c6d8f789a989c4cadc45057b255569a15a9ab667))
* suggest order of exclusions and next-line hints that resolve from cwd ([#47](https://github.com/nam-hle/docstamp/issues/47)) ([24bbef8](https://github.com/nam-hle/docstamp/commit/24bbef84ca0c1b4a538998d58b993ec977782b23))

## [0.3.1](https://github.com/nam-hle/docstamp/compare/v0.3.0...v0.3.1) (2026-10-07)


### Features

* declare dependencies inline in markdown frontmatter ([#13](https://github.com/nam-hle/docstamp/issues/13)) ([29be889](https://github.com/nam-hle/docstamp/commit/29be889f4effcc119d66bd6ba432448c0ece475b))

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
