## 9 Configuration File

### 9.1 Carriers

The Configuration file is a file at Root named, in this order of discovery, one of:

| Name | Carrier |
|---|---|
| `docstamp.yaml` | YAML (§9.2) |
| `docstamp.config.ts`, `docstamp.config.mts` | script (§9.5), TypeScript |
| `docstamp.config.js`, `docstamp.config.mjs` | script (§9.5), JavaScript |

Exactly one of these names MAY be an entry of Root (§9.3). A Root with none of them uses the
defaults of §5.2 and declares its files inline only (§9.6). The Carrier is only a format: every
Carrier yields the same normalized value, and the rules of §9.3 apply to that value alone. The
Lockfile is always YAML.

The same configuration in the YAML Carrier:

```yaml
version: 2
files:
  CLAUDE.md:
    dependencies:
      - src/**
      - "!src/**/*.test.ts"
      - package.json
  tests/fixtures/user.json:
    dependencies:
      - schemas/user.schema.json
```

Patterns starting with `!` or `*` must be quoted in YAML.

In the script Carrier (§9.5) the file exports the same value:

```ts
import { defineConfig } from 'docstamp';

export default defineConfig({
  version: 2,
  files: {
    'CLAUDE.md': { dependencies: ['src/**', '!src/**/*.test.ts', 'package.json'] },
    'tests/fixtures/user.json': { dependencies: ['schemas/user.schema.json'] },
  },
});
```

### 9.2 YAML Profile

The YAML Carrier of the Configuration file and the Lockfile are read as YAML 1.2 with the Core
schema, restricted as follows. A violation raises `E_CONFIG` (Configuration file) or `E_LOCK`
(Lockfile). The profile applies to those two files only, never to a script Carrier.

- The file is UTF-8; a leading U+FEFF is ignored. It holds exactly one document.
- Anchors, aliases, tags, merge keys (`<<`) and complex keys are not allowed.
- Every mapping key is a plain or quoted scalar that resolves to a string. A plain scalar key
  such as `1`, `true` or `null` is an error, not a string.
- A mapping MUST NOT contain the same key twice.

The *normalized value* of a YAML document is the Value it denotes: a mapping is a Map, a sequence
is a List, and a scalar is the Null, Boolean, Number or String it resolves to. The one exception
is the value of the top-level key `version`: it is the Number 2 if it is the plain scalar `2`
exactly, and Null for any other scalar, so that `2.0`, `0x2`, `+2`, `02` and `"2"` are not
version 2.

### 9.3 Reading

`ReadConfig(root)` returns a Config, a List of attached Diagnostics and a Boolean *present*, or
raises:

1. Let *fatal* be an empty List. Let *attached* be an empty List.
2. Let *names* be the names of §9.1 that are entries of Root, of any kind, in the order of §9.1.
   1. If *names* has more than one element, raise « `E_CONFIG_AMBIGUOUS` », `[[Subject]]` the
      elements of *names* joined with `, `.
   2. If *names* is empty, return the Config of the defaults of §5.2, « » and *present* false.
   3. If its element is not an entry of kind *file*, raise « `E_CONFIG_MISSING` ».
3. Let *value* be the normalized value of that file: under §9.2 for `docstamp.yaml`, under §9.5
   for any other name. On failure, or if *value* is not a Map, raise « `E_CONFIG` ».
4. If the key `version` is absent, or its value is not the Number 2, raise « `E_CONFIG_VERSION` »,
   whose message names the migration from version 1 when *value* has the key `version` or
   `dependents`, and otherwise (a first configuration file) says to add `version: 2`.
5. If step 3 returned a `plugins` member (§9.5) that is not a valid List of Plugins, collect its
   `E_PLUGIN` into *fatal*. Then, for each key of *value* other than `version`, `gitignore`,
   `ignore`, `include`, `presets`, `default-presets` and `files`, collect `E_UNKNOWN_KEY` into
   *fatal*, `[[Subject]]` the key.
6. If `gitignore` is present and not a Boolean, or `ignore` is present and not a List of
   Strings, collect `E_CONFIG` into *fatal*, `[[Subject]]` the key. If `include` is present and
   not a non-empty List of Strings, collect `E_CONFIG` into *fatal*, `[[Subject]]` `include`;
   otherwise, for each string *s* of `include` that is not a valid Pattern (§8.1), collect
   `E_PATTERN` into *fatal*, `[[Subject]]` *s*. If `presets` is present and not a Map, collect
   `E_CONFIG` into *fatal*, `[[Subject]]` `presets`; otherwise, for each (*name*, *list*) of it: if
   *name* is not of the form `[a-z][a-z0-9-]*`, or *list* is not a non-empty List of Strings,
   collect `E_CONFIG` into *fatal*, `[[Subject]]` `presets.` followed by *name*; otherwise, for each
   string *s* of *list* that is not a valid Pattern (§8.1), collect `E_PATTERN` into *fatal*,
   `[[Subject]]` *s*. If `default-presets` is present and is not a non-empty List of Strings without
   a repeated element, collect `E_CONFIG` into *fatal*, `[[Subject]]` `default-presets`; otherwise,
   for each string *n* of it that is not a key of `presets` (all of them when `presets` is absent or
   not a Map), collect `E_UNKNOWN_PRESET` into *fatal*, `[[Subject]]` *n*, with an empty `[[File]]`:
   a global Diagnostic, as every other Diagnostic of this step.
7. If `files` is not a Map, or is absent while no key of step 5 has `files` as its near key
   (NOTE below), collect `E_CONFIG` into *fatal*, `[[Subject]]` `files`. When it is absent, the
   message says that `files` is required and to write `files: {}` for none. When it is absent and
   a key of step 5 has `files` as its near key, nothing is collected here: that key's
   `E_UNKNOWN_KEY`, which names `files`, is the one Diagnostic of the typo.
8. Otherwise, for each (*key*, *value*) of `files`:
   1. If *key* is not a RepoPath, collect `E_CONFIG` into *fatal*, `[[Subject]]` *key*, and
      continue.
   2. If *value* is not a Map, or has no key `dependencies`, or `dependencies` is not a non-empty
      List whose elements are Strings or Selected Dependencies (§8.7), or a String that `ParseShorthand` (§8.7) raises for, collect `E_CONFIG` into
      *fatal*, `[[File]]` *key*, and continue.
   3. For each key of *value* other than `dependencies` and `use`, collect `E_UNKNOWN_KEY` into
      *fatal*, `[[File]]` *key*, `[[Subject]]` that key. If `use` is present and is not a List of
      Strings without a repeated element, or is empty while `default-presets` is absent, collect
      `E_CONFIG` into *fatal*, `[[File]]` *key*, `[[Subject]]` `use`.
   4. For each string *s* of `dependencies` that `SplitDependency` does not split and that is not a
      valid Pattern (§8.1), collect
      `E_PATTERN` into *attached*, `[[File]]` *key*, `[[Subject]]` *s*.
   5. Produce the Declaration { `[[File]]`: *key*, `[[Shorthands]]`: the Shorthands of the strings of `dependencies` that `SplitDependency` splits, `[[Dependencies]]`: the other strings of
      `dependencies`, `[[Selected]]`: its Maps as Selected Dependencies (§8.7), each in order of
      appearance, `[[Use]]`: the strings of `use`, or none if it is absent, `[[Origin]]`:
      `config`, `[[Recorded]]`: none }.
9. If *fatal* is not empty, raise *fatal*.
10. Return the Config, with defaults (§5.2) for absent keys, `[[Presets]]` from `presets`,
    `[[DefaultPresets]]` from `default-presets`, and the Declarations in path order, *attached* and
    *present* true.

NOTE: An empty `use` means "none of the default Presets" (§8.6), so it is accepted only where there
are default Presets; without `default-presets` it says nothing and stays `E_CONFIG`, as it was
before default Presets existed (§17.3).

NOTE: A bad pattern makes only its file `invalid`; every other file is still evaluated.
A structural error stops evaluation.

NOTE: `include` replaces the default `**/*.md` (§5.2); it selects only where inline blocks are
searched (§9.6.1), never which files may be dependencies. `files` stays required: a Configuration
file that only sets `ignore` or `include` writes `files: {}`.

NOTE: `plugins` is accepted only in a script Carrier (§9.5), which removes it from the value before
step 3. In `docstamp.yaml` it is `E_UNKNOWN_KEY` (step 5), and its message says that Plugins are
registered in a script Carrier.

NOTE: Steps 5 to 10 never see the Carrier. Key order in a Map is not significant: the Declarations are
in path order (step 10).

NOTE: The `[[Message]]` of `E_UNKNOWN_KEY` is informative (§5.5), and SHOULD name the *near key*
of the unknown key when there is one: among the keys of its level, in the order listed by step 5
(top level), step 8.3 (`dependencies`, `use`) or §9.6.2 step 5 (`dependencies`, `use`, `hash`),
those whose edit distance to it is 1 or 2, the first one at the smallest distance. The edit
distance is the least number of code points to insert, delete or replace. So `dependecies` names `dependencies`. The fixed
messages for `dependents` and `covers` (§15) take precedence. Likewise the `[[Message]]` of the
`E_CONFIG` of step 8.2, for an entry that is a Map without `dependencies`, SHOULD name a key of it
whose edit distance to `dependencies` is 1 or 2. Neither changes a code, a `[[Subject]]` or the
order of Diagnostics.

### 9.4 Stamped Files

A file with a configured Declaration MUST be an entry of kind *file* whose name, in the listing of
its parent directory, is equal to the last segment of the file's RepoPath after §7.4. A file
need not be in the Universe; it may be an ignored file. An inline file is in the Universe
(§9.6.3).

NOTE: The check uses the directory listing, not a lookup by path, so `claude.md` does not resolve
to `CLAUDE.md` on a case-insensitive file system. Renaming a file without renaming its key
raises `E_FILE_MISSING`.

### 9.5 Script Carriers

`LoadScript(path)` returns the normalized value of a Configuration file whose name is not
`docstamp.yaml`, or raises `E_CONFIG`:

1. Evaluate the file at *path*, synchronously, as a module of the host runtime. If it cannot be
   loaded, if evaluation throws, or if evaluation is asynchronous (top-level `await`), raise
   « `E_CONFIG` » with `[[File]]` the file's name and the message `The script cannot be loaded: <cause>.` The
   cause is stable text, never the runtime's: for a specifier the module imports and the runtime
   cannot resolve (not an absolute path or a `file:` URL), `it imports "<specifier>", which cannot be
   resolved`; for a package path it does not export, `it imports "<package>", which does not
   export that path`; otherwise `evaluation
   threw <name>`, *name* being the `name` of the thrown Error (`a value` for anything else). The
   message holds no absolute path and no stack.
2. Let *exports* be the module's exports. If *exports* is an ECMAScript module namespace whose
   `default` export is absent, `undefined` or Null, raise « `E_CONFIG` »; its message says to
   use `export default`, and that a CommonJS `module.exports` value is accepted. Otherwise let
   *exported* be its `default` export if *exports* has one that is neither `undefined` nor Null,
   else *exports*.
3. Return ? `ToPlain(exported, empty)`, where, if *exported* is an object whose prototype is the
   Object prototype or null and that has an own `plugins` member, *exported* is taken without that
   member, which is read separately (below).

`LoadScript` returns the plain value of step 3 and, separately, the value of the top-level
`plugins` member of *exported*, when it has one. `plugins` is not part of the plain value and is
exempt from `ToPlain`; a function anywhere else is still `E_CONFIG` (`ToPlain` step 6). It MUST be a dense, plain (not a Proxy) List of Plugins (§8.7);
otherwise `ReadConfig` (§9.3 step 5) collects one `E_PLUGIN`, for the first problem, `[[Subject]]` the
Plugin name or `plugins[i]`, with a message that names `apiVersion` when `[[ApiVersion]]` is not 1.
It is collected with the other Diagnostics of that step, and no Plugin is used then.

`ToPlain(v, ancestors)`, where *ancestors* is the List of objects being converted, raises
`E_CONFIG` with `[[Subject]]` the top-level key whose value contains *v* (empty if *v* is the
exported value itself):

1. If *v* is Null, a Boolean or a String, return it.
2. If *v* is a Number, return it if it is finite, else raise.
3. If *v* is an object that is in *ancestors*, raise. If *v* is a Proxy, raise.
4. If *v* is an Array, every own property of it MUST be a data property named by an index below
   its length or `length`, and every index below its length MUST be present; otherwise raise.
   Return the List of `ToPlain(element, ancestors + « v »)` for its elements in index order.
5. If *v* is an object whose prototype is the Object prototype or null, every own property of it
   MUST be an enumerable data property named by a String; otherwise raise. Return the Map of
   each name to `ToPlain(value, ancestors + « v »)`.
6. Raise. This covers `undefined`, functions, symbols, big integers, accessors, class instances
   and every other object.

NOTE: `plugins` is accepted only in a script Carrier; in `docstamp.yaml` it is `E_UNKNOWN_KEY`, and
its message says Plugins are registered in a script Carrier (§9.3 NOTE).

NOTE: A repository whose Configuration file is `docstamp.yaml`, or that has only inline blocks and
no Configuration file, cannot use a Plugin: it needs a script Carrier (`docstamp.config.ts`), for
example `export default { version: 2, plugins: [markdown], files: {} }`.

NOTE: A Proxy is rejected wherever it occurs, even one that wraps a plain object or an Array, since
its traps can answer differently on each access.

NOTE: A value nested too deeply to traverse, so that the host runtime exhausts its stack, raises
`E_CONFIG` with an empty `[[Subject]]`.

NOTE: A script Carrier is evaluated by the host runtime's module loader, which may cache it. A
process that reads the same path more than once may observe the first evaluation (the CLI reads
once).

NOTE: A value reached twice without a cycle is allowed and is converted twice. Duplicate keys
cannot occur, and the key order of a Map is not significant (§9.3).

NOTE: TypeScript files are evaluated by the host runtime's type stripping, so only erasable
TypeScript syntax is supported: no `enum`, no `namespace` with values, no parameter properties.

NOTE: Evaluating a Configuration file runs its code, and the code may import other files. Those
files are not dependencies, not hashed and not part of the Universe, so a change in them changes
no verdict. A script Carrier SHOULD import only `docstamp`, and its value SHOULD NOT depend on the
environment, the clock or the network (§2).

### 9.6 Inline Declarations

#### 9.6.1 Candidates

A *candidate* is a file of the Universe of kind *file* that `config.[[Include]]` selects
(`Select`, §8.4). A candidate is an *inline file* when `ScanFrontmatter` (§5.6) of its text is not
*none*. The text of a file is its bytes decoded as UTF-8, a leading U+FEFF kept; a file that is
binary (§10.1) or not valid UTF-8 has no text and is not an inline file.

#### 9.6.2 Parsing

`ParseBlock(file, scan, defaults)`, where *defaults* is true iff `config.[[DefaultPresets]]` is
not empty (§9.3; false where another clause calls it without *defaults*, true in §12.3 step 1.4),
returns a Declaration or
raises a List of Diagnostics attached to *file*:

1. Let *problems* be an empty List.
2. If the marker line, after `docstamp:`, is not only blanks and an optional `#` comment, collect
   `E_BLOCK`, `[[Subject]]` `docstamp`, and return the Declaration with no dependencies together
   with *problems*: the block MUST be a block mapping.
3. Parse the lines between the delimiters, joined, under the strict profile of §9.2 (the profile
   of §9.2 applies to this text and to no other frontmatter). If that fails, collect `E_BLOCK`,
   `[[Subject]]` `frontmatter`, and return as in step 2. A duplicate `docstamp` key fails here.
4. If the document is not a mapping, or its key `docstamp` is not a mapping, collect `E_BLOCK`,
   `[[Subject]]` `docstamp`, and return as in step 2.
5. For each key of the block other than `dependencies`, `use` and `hash`, collect `E_UNKNOWN_KEY`,
   `[[Subject]]` the key.
6. If `dependencies` is present but not a non-empty List whose elements are Strings or Selected
   Dependencies (§8.7), or is absent and step 5 collected no `E_UNKNOWN_KEY`, or holds a String that
   `ParseShorthand` (§8.7) raises for, collect `E_BLOCK`, `[[Subject]]` `dependencies`. Otherwise,
   for each string *s* of it that `SplitDependency` does not split and that is not a valid Pattern
   (§8.1), collect `E_PATTERN`, `[[Subject]]` *s*. If `use` is present and is not a List of Strings without a repeated element, or is empty
   while *defaults* is false, collect `E_BLOCK`, `[[Subject]]` `use`.
7. If `hash` is present, let *recorded* be it. Collect `E_BLOCK`, `[[Subject]]` `hash`, unless
   *recorded* is a String of 64 characters of `[0-9a-f]`, the scan has exactly one
   line of *hashLines*, and that line, after `hash:`, is one or more blanks, *recorded* itself,
   then either optional blanks, or one or more blanks and a `#` comment (a `#` with no blank
   before it is part of the scalar, as in YAML), and its terminator.
8. If *problems* is empty, return the Declaration { `[[File]]` *file*, `[[Shorthands]]` the
   Shorthands of the strings of `dependencies` that `SplitDependency` splits, `[[Dependencies]]` the
   other strings of `dependencies`, `[[Selected]]` its Maps as Selected Dependencies (§8.7), each in order
   of appearance, `[[Use]]` the strings of `use`, or none if it is absent, `[[Origin]]`
   `inline`, `[[Recorded]]` *recorded*, or none }. Otherwise raise *problems*, and the Declaration of the Result
   (§12.1) is { *file*, the strings of `dependencies` if it is a List of Strings and Selected Dependencies else « » }.

NOTE: One fault, one Diagnostic. A key that is not part of the block is reported once, as
`E_UNKNOWN_KEY` attached to the file, and never also as `E_BLOCK`: a mistyped `dependancies` does
not add "`dependencies` is missing". `E_BLOCK` remains for exactly these cases: the marker line is
not a block mapping (step 2); the frontmatter is not strict YAML (step 3); the document or the
`docstamp` key is not a mapping (step 4); `dependencies` is absent and no key is unknown, or is
present and not a non-empty List of Strings and Selected Dependencies (step 6); `use` is not a List of Strings without a
repeated element, or is empty without default Presets (step 6); `hash` is not 64 lowercase hexadecimal digits
alone on its line (step 7). A block with an unknown key and a malformed `dependencies` or `hash`
has one Diagnostic for each fault.

#### 9.6.3 Discovery

`ReadInline(root, universe, config)` returns the inline Declarations, the attached Diagnostics
and the *marked* Map from RepoPath to the `[[hashLines]]` of its scan, or raises:

1. Let *fatal* be an empty List, and let *candidates* be as in §9.6.1.
2. For each candidate *c*, in path order: read its text. If it cannot be read, collect
   `E_UNREADABLE` into *fatal*, `[[Subject]]` *c*, and continue. If `ScanFrontmatter` is *none*,
   continue. Add *c* and the hash lines of its scan to *marked*, and call `ParseBlock` with
   *defaults* from *config*: add the
   Declaration it returns to the Declarations, and its raised Diagnostics to *attached*.
3. If *fatal* is not empty, raise it. Otherwise return the three Lists.

NOTE: Only a file in the Universe is a candidate, so an inline file is never ignored by an ignore
rule or `.gitignore`, never a link, and is never the Configuration file or the Lockfile. A file
can be moved or renamed, because its declaration is in the file itself.

NOTE: The frontmatter of a candidate with no `docstamp:` line is not read as YAML at all, so
anchors, tags and every other YAML feature the profile rejects are harmless there.

#### 9.6.4 Stamping

`Stamp(root, file, hash)` writes the Hash *hash* into the inline block of *file*, whose scan is
*scan*. It changes no byte of the file other than the ones it names:

1. If *scan* has exactly one line of *hashLines*, replace in that line the 64 characters of its
   value by *hash*.
2. Otherwise insert, after the line *last* of *scan*, the line *keyIndent*, `hash: `, *hash*
   and the terminator of the line *last*, which has one because *close* follows it.
3. Replace *file* atomically with the resulting bytes, with its file mode: a concurrent reader sees
   either the old contents or the new. If this fails, raise « `E_UNREADABLE` » with `[[Subject]]`
   *file*, leaving the old contents.

NOTE: The text is not re-serialized: comments, quoting, key order, other frontmatter, the byte
order mark, the body and the line terminators of every line survive. The appended `hash` line uses
the terminator of the last line of the block, so CR LF files stay CR LF.

NOTE: Reformatting the frontmatter of an inline file *B* (a formatter reflowing `dependencies`,
say) is a content change of *B* (§10.2): every file that depends on *B* becomes `stale` with
`content-changed`, although no fact changed. A formatter that rewrites the `hash` line into
another form (quoted, wrapped) makes *B* `invalid` (§9.6.2 step 7). Exclude the block from
formatters, or run `docstamp update` after formatting.

NOTE: Deliberate, for now: an edit that touches only a comment or whitespace inside the `docstamp:`
block of an inline file *B*, apart from its `hash` line, still counts as a change of *B* (§10.2), so
the files that depend on *B* become `stale`. Counting only the declaration, or normalizing the
comments of the block, would change the Hash of every inline file that has such comments: that is a
hash input change, breaking (§17.2) and needing a deliberate decision and a Lockfile `version`
(§17.4). It is not part of this version; the issue that tracks it (nam-hle/docstamp#24) stays open
for that part.

#### 9.6.5 Writing a Block

`WriteBlock(text, dependencies)` returns the text of a file with an inline block that declares
*dependencies*, a non-empty List of patterns, and never a `hash` key, or raises `E_USAGE`. It is
used only by `suggest --write` (§13.10); it never records a Review.

1. Let *scan* be `ScanFrontmatter(text)`. Let *item*(*s*) be *s* if it matches
   `^([A-Za-z_]|\.[A-Za-z_])[A-Za-z0-9_./@+=*?\[\]{},-]*$` and is none of `true`, `false`, `null`,
   `y`, `n`, `yes`, `no`, `on`, `off`, `.inf`, `.nan` in any letter case, else `Quote(s)` (§3.4).
2. If *scan* is not *none*:
   1. If *hashLines* of *scan* is not empty, raise: a block that records a Hash is never
      overwritten; its message tells the user to edit it by hand.
   2. If the marker line, after `docstamp:`, is not only blanks and an optional `#` comment, raise.
   3. Let *declared* be the `[[Dependencies]]` of the Declaration that `ParseBlock(scan)` (§9.6.2)
      returns, even when it raises. If *dependencies* does not start with the elements of
      *declared*, in order, raise. If *declared* is not empty and *dependencies* has no other
      element, return *text*.
   4. If *declared* is not empty and `ParseBlock(scan)` does not raise, look for the *last item*:
      let *key* be the first line from *marker* + 1 to *last* that starts with *keyIndent* followed
      by `dependencies:` and, after it, only blanks and an optional `#` comment. Let an *item line*
      be a line that, after some U+0020 *itemIndent*, starts with `- `. Walk the lines after *key*
      up to *last*: skip a line that is only blanks or blanks and a `#` comment; the first other
      line must be an item line, which fixes *itemIndent*; then an item line with that
      *itemIndent*, or a line with more leading U+0020 than *itemIndent* (it continues an item),
      is the *last item*, and any other line ends the walk. If there is a *last item*, the block is
      *extended*: insert after it, for each pattern *s* of *dependencies* after the elements of
      *declared*, the line *itemIndent*, `- `, *item*(*s*), each followed by the terminator of the
      *last item*. Every other line of *text* is kept as it is, including `use`, comments and the
      items of *declared*.
   5. Otherwise (no *key* or no item line, as for `dependencies: [a, b]`, or a block that declares
      no pattern or raises), raise if a line from *marker* + 1 to *last* starts with *keyIndent*
      followed by `use:`, so a `use` is never lost. The message says what to change: when
   *declared* is not empty and `ParseBlock(scan)` does not raise, to write `dependencies` one
   pattern per line (`- <pattern>`), which step 2.4 extends, or to edit the block by hand;
   otherwise to edit the block by hand. Let *indent* be *keyIndent*, or two U+0020 if it
      is *absent*, and *eol* the terminator of the marker line. Replace the lines after *marker* up
      to and including *last* by the line *indent* and `dependencies:`, and, for each pattern *s*,
      the line *indent*, two U+0020, `- `, *item*(*s*), each followed by *eol*.
3. Otherwise, if the first line of *text* (without a leading U+FEFF) and a later line are `---`
   (§5.6 steps 2 and 3), insert before that later line the line `docstamp:` and the lines of
   step 2.5, each followed by the terminator of the first line, with *indent* the U+0020 characters
   that start the first line between the two that starts with U+0020 followed by a character other
   than U+0020, a tab or a line terminator, or two U+0020 if there is no such line. The block then
   follows the indentation the frontmatter already uses.
4. Otherwise let *text* start with the U+FEFF if it has one, then the lines `---`, `docstamp:` and
   the lines of step 2.5 with *indent* two U+0020, then `---`, each followed by the terminator of
   the first line of *text* (CR LF if it is CR LF, else LF), then the rest of *text*.
5. Let *result* be the text so produced. If `ScanFrontmatter(result)` is *none*, if `ParseBlock`
   (§9.6.2) of it raises, or if the dependencies it declares differ from *dependencies*, raise.
   Otherwise return *result*.

NOTE: Every byte of *text* outside the replaced lines survives: the other frontmatter, the byte
order mark, the body and the line terminators of every line. An extended block (step 2.4) only gains
lines, so a declared pattern, a `use` and a comment in it are never lost. A block that is not
extended is replaced (step 2.5): its declared patterns are kept, since *dependencies* starts with
them, but a comment inside it is not; the marker line, with its own comment, is. Step 5 is the
safety net: a frontmatter this clause cannot extend with certainty (for
example one that is not strict YAML, §9.2, or already has a quoted `"docstamp"` key) is
refused, never rewritten.
