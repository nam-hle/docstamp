# Changelog

## 0.1.0 (2026-10-14)


### ⚠ BREAKING CHANGES

* a dependency string is now split at its first unescaped `:` into a file path and a selector, so a dependency written as a file name that contains a colon (for example `notes:2024.md`) no longer names that file. Write the colon as `\:` (`notes\:2024.md`). This ships with Lockfile version 4.
* replace --root with --cwd ([#99](https://github.com/nam-hle/docstamp/issues/99))

### Features

* a plugin returns parts and diagnostics ([#95](https://github.com/nam-hle/docstamp/issues/95)) ([2c9341e](https://github.com/nam-hle/docstamp/commit/2c9341e4c451eecada7e1697f58c36149769ed95))
* add docstamp-plugin-js, a plugin that selects a declaration by its name ([#79](https://github.com/nam-hle/docstamp/issues/79)) ([30ecb05](https://github.com/nam-hle/docstamp/commit/30ecb0501e05e5614c91a9cd494bf8f7b116f4e1))
* let a plugin say what a part is and where it is ([#86](https://github.com/nam-hle/docstamp/issues/86)) ([0ba965e](https://github.com/nam-hle/docstamp/commit/0ba965e826e395e137f511d69cccfb36bae79ba4))
* plugin validateSelect and stable diagnostic codes ([#115](https://github.com/nam-hle/docstamp/issues/115)) ([09dc38f](https://github.com/nam-hle/docstamp/commit/09dc38fa4157ce4ac571d2355ffb32771c239ef0))
* plugins define their select format, core validates meta.schema ([#118](https://github.com/nam-hle/docstamp/issues/118)) ([dc64255](https://github.com/nam-hle/docstamp/commit/dc6425530edcf84ba23888d568e0fd4c97752f4e))
* plugins suggest what exists when a selector finds nothing ([#124](https://github.com/nam-hle/docstamp/issues/124)) ([ccfa7c1](https://github.com/nam-hle/docstamp/commit/ccfa7c12237cfaba386045d55804c4912237bd12))
* replace --root with --cwd ([#99](https://github.com/nam-hle/docstamp/issues/99)) ([09f0698](https://github.com/nam-hle/docstamp/commit/09f06981fd1581304e5bdfc87ca669987ee72032))
* select a part of a file with path:selector shorthand ([#117](https://github.com/nam-hle/docstamp/issues/117)) ([ceab8b1](https://github.com/nam-hle/docstamp/commit/ceab8b1c62b500d01bafd4deb4e4b5095d83a473))


### Bug Fixes

* trim selector blanks in linear time ([#116](https://github.com/nam-hle/docstamp/issues/116)) ([ca2e024](https://github.com/nam-hle/docstamp/commit/ca2e024f957992a374db84ae474bff020af2831c))


### Documentation

* split the spec into one file per section ([#98](https://github.com/nam-hle/docstamp/issues/98)) ([b0a0114](https://github.com/nam-hle/docstamp/commit/b0a0114b1bd68927911dc5e5ea792b346d30754d))
* version the plugin contract, plugins need a script config ([#112](https://github.com/nam-hle/docstamp/issues/112)) ([1099646](https://github.com/nam-hle/docstamp/commit/1099646eef7f3d062de139fc2a54d5829a65592d))


### Internal

* remove match from selected dependencies ([#94](https://github.com/nam-hle/docstamp/issues/94)) ([80adf3b](https://github.com/nam-hle/docstamp/commit/80adf3b9e9224de2721a9a594d4131a5aa5e8d5e))
