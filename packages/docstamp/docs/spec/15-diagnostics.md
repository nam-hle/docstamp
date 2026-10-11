## 15 Diagnostics

The fix column lists every fix a code can name. A message names the one that applies, and the
default message of a code (one with no detail of its own) may name only its first, general fix.

| Code | Severity | Raised by | Fix named by the message |
|---|---|---|---|
| `E_USAGE` | error | §13.2, §13.3, §13.8, §13.10, §13.11, §9.6.5 | correct the command line, as `docstamp help <command>` shows it; for a removed option, use the command it names; for a mistyped command, the command name it suggests, or `--` before a file of that name; for a file argument outside Root, name a path that resolves, against the working directory, inside Root; for an unknown help name, one of those the message lists |
| `E_CWD` | error | §13.4 | pass an existing directory to `--cwd` |
| `E_CONFIG_MISSING` | error | §6, §9.3, §12.2 | create a Configuration file (§9.1), or add a `docstamp` block to the frontmatter of a Markdown file (§5.6); `docstamp help start` shows both |
| `E_CONFIG_AMBIGUOUS` | error | §9.3 | keep one configuration file |
| `E_CONFIG` | error | §8.7, §9.2, §9.3, §9.5 | fix the named key (`presets.<name>` for a Preset, `use` for a file, `default-presets` for the default Presets; an empty `use` needs `default-presets`); for a missing `files`, write `files: {}` for none (a key one or two edits from `files` is `E_UNKNOWN_KEY` alone, §9.3 step 7); for a module without a default export, `export default` the value |
| `E_CONFIG_VERSION` | error | §9.3 | rename `dependents` to `files` and `covers` to `dependencies`, set `version: 2`; for a file with neither `version` nor `dependents`, add `version: 2` |
| `E_UNKNOWN_KEY` | error | §9.3, §9.6.2 | remove or correct the key; for `dependents` rename it to `files`, for `covers` rename it to `dependencies`; otherwise its near key, if any (§9.3 NOTE: `did you mean "dependencies"?`); attached to the file when it is a key of an inline block |
| `E_PATTERN` | error | §9.3, §9.6.2 | correct the pattern (§8.1); for an empty pattern, write a path or glob or remove it; for a lone `!`, write the path to exclude after it or remove it |
| `E_UNKNOWN_PRESET` | error | §8.6, §9.3 | define the Preset under `presets` in the Configuration file, or correct the name in `use` or `default-presets`; subject the name, attached to the file, or global for a name of `default-presets` |
| `E_BLOCK` | error | §8.7, §9.6.2 | write the `docstamp` block as a block mapping with `dependencies` and, optionally, `hash: <64 hex>` on one line; the subject names the part: `docstamp`, `frontmatter`, `dependencies`, `use` or `hash` |
| `E_DUPLICATE_DECLARATION` | error | §12.2 | declare the file once: remove the entry under `files` or the `docstamp` block |
| `E_FILE_MISSING` | error | §12.1 | rename the key or restore the file |
| `E_EMPTY_PATTERN` | error | §8.5, §8.7 | correct or remove the pattern; it has no Negation; when it names an existing but ignored path, depend on its source or remove the ignore rule; when git shows the path renamed (§12.7), depend on the new path, which the message names; when it holds `\` followed by a letter, use `/` as the separator (`\` escapes the next character) |
| `E_EMPTY_DEPENDENCIES` | error | §8.5 | correct the patterns in `dependencies`: no inclusion is empty, but together they select no file (there is no inclusion, or the exclusions deselect every file); never raised beside an `E_EMPTY_PATTERN` of the same file |
| `E_UNREADABLE` | error | §7.2, §9.6.3, §9.6.4, §10.2, §11.3, §13.10 | fix permissions; for a write of the Lockfile or a doc, also make the Root writable |
| `E_PATH_ENCODING` | error | §7.2 | rename the file to valid UTF-8 |
| `E_PATH_COLLISION` | error | §7.4, §7.5 | rename one of the files |
| `E_LOCK` | error | §9.2, §11.1 | resolve the conflict, or `docstamp update --all` after reviewing every file |
| `E_LOCK_VERSION` | error | §11.1 | for `docsync.lock`, delete it, review every file, then `docstamp update --all`; for a version 2 Lockfile, `docstamp update --all` rewrites it as version 3 (hashes are unchanged); otherwise as `E_LOCK` |
| `E_UNKNOWN_FILE` | error | §13.3 | name a file listed under `files` in the Configuration file, or one with a `docstamp` block; raised only for an argument that resolves inside Root (§13.4) |
| `E_HISTORY` | error | §12.4 | run in a git work tree with its full history; for `--from`, name a commit |
| `E_PLUGIN` | error | §8.7, §9.5 | fix the Plugin in the `plugins` of the script Carrier: a non-empty `name`, `apiVersion: 1`, a non-empty `files` List of Patterns and an `extract` function (and a `validateSelect` that is a function, when present), unique names, and no two Plugins claiming one path; the subject names the Plugin or `plugins[i]`, or the path claimed twice |
| `E_SELECT` | error | §8.7 | register a Plugin whose `files` claim the path, or fix the Plugin: `extract` must return `{ parts, diagnostics }` synchronously and the file must be a UTF-8 text file (subject the path); or, for an error the Plugin reports from `extract` or `validateSelect` (subject the path, `#` and the selector; `validateSelect` also attaches it to the file), correct `select` or the file as its message says, then run `docstamp check` again |
| `E_SELECT_NOT_FOUND` | error | §8.7 | correct `select`, or the file, so the Plugin returns at least one Part, then run `docstamp check` again; subject the path, `#` and the selector |
| `W_SELECT` | warning | §8.7 | change `select` or the file as the Plugin's message says, or ignore it: the Part still stands and nothing else changes; attached to the file, subject the path, `#` and the selector |
| `W_ORPHAN` | warning | §12.2 | run `docstamp update` on any file to remove it |
| `W_EMPTY_EXCLUSION` | warning | §8.5 | correct or remove the exclusion, or keep it: it matches no file of the Universe and changes nothing; attached to the file, subject the pattern |
| `W_SHADOWED_EXCLUSION` | warning | §8.5 | move the exclusion after the named later pattern (for a Preset, list it last in `use`), or narrow that pattern, unless re-selecting those files is intended; attached to the file, subject the exclusion |
| `W_DUPLICATE_PATTERN` | warning | §8.5 | keep one copy of the repeated pattern, unless the order of the patterns needs both (§8.4); attached to the file, subject the pattern, once per distinct repeated pattern |
| `W_UNKNOWN_PATH` | warning | §13.8 | check the spelling: the path is not in the Universe and not on disk, so nothing depends on it; subject the path as a RepoPath, carried by the entry of that path |
