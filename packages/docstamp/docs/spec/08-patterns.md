## 8 Patterns

### 8.1 Syntax

```
Pattern     ::= Negation? Glob
Negation    ::= "!"
Glob        ::= Segment ( "/" Segment )*
Segment     ::= "**" | Part+
Part        ::= Literal | "*" | "?" | Class | Alternation
Alternation ::= "{" Alt ( "," Alt )+ "}"
Alt         ::= AltPart+
AltPart     ::= Literal | "*" | "?" | Class
Class       ::= "[" "!"? ClassItem+ "]"
ClassItem   ::= ClassChar | ClassChar "-" ClassChar
Literal     ::= any code point except * ? [ ] { } , / \  |  Escape
ClassChar   ::= any code point except ] / \  |  Escape
Escape      ::= "\" any code point except /
```

Additional rules:

- A leading `!` is always Negation. A literal leading `!` is written `\!`.
- `**` is a Segment only when it is the whole segment. Two consecutive `*` inside a longer segment
  make the Pattern invalid.
- In a Class, `-` is literal when it is the first or last ClassItem. A range whose first code
  point is greater than its second is invalid. `[!]` is invalid.
- A Pattern is *invalid* if it does not match the grammar, is empty after the Negation, starts
  with `/` after the Negation, ends with `/`, has a segment whose text, with Escapes resolved, is
  exactly `.` or `..` (so `\.` is invalid), or is not in NFC.

NOTE: `\` is the escape character, so a Windows path such as `src\cli` is the literal `srccli`.
Patterns always use `/`.

### 8.2 Glob Matching

`GlobMatches(glob, path)` is true iff *path* is in the language of *glob*:

- a Literal matches itself; an Escape `\c` matches *c*;
- `*` matches zero or more code points, none `/`;
- `?` matches one code point other than `/`;
- a Class matches one code point other than `/` that is (or, with `!`, is not) a listed code point
  or within a listed inclusive range;
- an Alternation matches what any one of its Alts matches;
- a Segment `**` that is the last segment matches one or more whole segments; any other Segment
  `**` matches zero or more whole segments;
- matching is case-sensitive and anchored at both ends; a leading `.` has no special meaning.

NOTE: `src/**` selects everything under `src/` but not a file named `src`.

### 8.3 Pattern Matching

`PatternMatches(pattern, path)`:

1. Let *glob* be *pattern* without its Negation.
2. If `GlobMatches(glob, path)`, return true.
3. If some proper prefix of *path* that ends immediately before a `/` satisfies
   `GlobMatches(glob, prefix)`, return true.
4. Return false.

NOTE: Step 3 gives directory semantics: `src/cli` selects every file under `src/cli/`, and so does
`src/*`, which matches the directory `src/cli`.

### 8.4 Selection

`Select(patterns, candidates)`:

1. Let *result* be an empty List.
2. For each *path* of *candidates*, in path order:
   1. Let *selected* be false.
   2. For each *pattern* of *patterns*, in order: if `PatternMatches(pattern, path)`, set
      *selected* to true if *pattern* has no Negation, else to false.
   3. If *selected*, append *path* to *result*.
3. Return *result*.

NOTE: The last matching pattern wins. Unlike an ignore rule (§7.3), a later pattern can re-select
a file under a directory an earlier negation removed.

### 8.5 Resolution

`ResolveDependencies(declaration, universe)`:

1. Let *problems* and *warnings* be empty Lists.
2. Let *candidates* be *universe* without `declaration.[[File]]`.
3. For each *pattern* of the effective patterns of *declaration* (§8.6; `declaration.[[Dependencies]]`
   when it uses no Preset): if no *path* of *candidates* satisfies `PatternMatches(pattern, path)`,
   then, with `[[Subject]]` *pattern*: if *pattern* has no Negation, collect `E_EMPTY_PATTERN` into
   *problems*; otherwise, unless *pattern* comes from a Preset, collect `W_EMPTY_EXCLUSION` into
   *warnings*.
4. For each distinct String that appears more than once in `declaration.[[Dependencies]]` (String
   equality, §3.2), collect `W_DUPLICATE_PATTERN` into *warnings*, `[[Subject]]` that String. A
   pattern that comes from a Preset is not counted: only the file's own patterns are.
5. Let *resolved* be `Select` of the effective patterns of *declaration* and *candidates*.
6. If *resolved* is empty, `declaration.[[Selected]]` is empty and *problems* is empty, collect
   `E_EMPTY_DEPENDENCIES` into *problems*.
7. Call a *path* of *resolved* *re-selected* when its last matching pattern (§8.4) is not a literal
   path (NOTE below) that denotes *path* itself. For each distinct String *e* of the effective
   patterns that has a Negation and satisfies `PatternMatches(e, path)` for some re-selected *path*,
   collect `W_SHADOWED_EXCLUSION` into *warnings*, `[[Subject]]` *e*. Its `[[Message]]` names, in
   pattern order, each pattern that is the last matching pattern of such a *path*, and the Preset it
   comes from, if any.
8. If *problems* is not empty, raise *problems* followed by *warnings*. Otherwise return *resolved*
   and *warnings*.

NOTE: A file is never one of its own dependencies (step 2), so editing a file never
makes it stale. A pattern without Negation must match something (Principle 6): a dependency that
matches nothing is a mistyped or stale rule, and a declaration whose patterns together select
nothing is a mistake (step 6). One mistake gives one Diagnostic: when a pattern raised
`E_EMPTY_PATTERN`, that already explains an empty selection, so step 6 raises
`E_EMPTY_DEPENDENCIES` only when every pattern without Negation matches a file and together they
still select nothing: there is no such pattern, or the exclusions deselect every file.

NOTE: A *duplicate* is the same String twice, whatever its Negation, and is warned once however
many times it repeats. Patterns that differ in any code point, such as `src` and `src/**`, are not
duplicates even when they select the same files. The warning changes neither `Select` (§8.4), the
resolved files, the Dependency Hash nor the state of the file. Removing a repeat is not always
neutral, because the last matching pattern wins: in `src`, `!src/gen`, `src` the second `src`
selects `src/gen` again, and deleting it changes the selection.

NOTE: An exclusion *matches nothing* when no file of *candidates* satisfies `PatternMatches` for the
exclusion itself (step 3). The test looks at the exclusion alone: it does not depend on the
patterns before it, so an exclusion that matches a file nothing selected is not warned about, and
one that matches only files outside the Universe (ignored, §7.3) is. It never changes `Select`
(§8.4), the last matching pattern still wins, the resolved files, the Dependency Hash or the state
of the file. A warning lets a standard exclusion block be declared before the files it excludes
exist, and survive their deletion.

NOTE: The `[[Message]]` of `E_EMPTY_PATTERN` is informative (§5.5), and SHOULD say when the pattern
is a *literal path* that exists under Root but is not in the Universe because it is ignored, so
that nobody hunts for a typo. A literal path is a Pattern whose every Segment is made of Literals
only (no `*`, `?`, Class, Alternation or `**`); it denotes the String of those Literals, Escapes
resolved. It is *ignored* when it exists as an entry under Root (a file, link or directory, not
followed) and either it or a directory above it is an ignored entry (§7.2 step 3.4), or an ignored
entry is below it (a directory whose content is all ignored). This changes neither the selection,
nor the Diagnostic code, nor the Diagnostic order, nor any verdict. `git` is not consulted for it.
Otherwise, for a literal path that is not ignored, the `[[Message]]` SHOULD name the path that
`RenamedTo` (§12.7) returns, if it returns one other than `declaration.[[File]]`: `git shows it
renamed to <path>`. That is the only use of `git` in §8.5, it is made only for a pattern that
already raised `E_EMPTY_PATTERN`, and it changes nothing but that wording.

NOTE: For the same reason, the `[[Message]]` of `E_EMPTY_PATTERN` SHOULD say that patterns use `/`
as the separator and that `\` escapes the next character when the pattern holds a `\` followed by a
letter: `src\core` is the literal `srccore` (§8.1 NOTE), almost always a Windows path. When that
pattern is the Declaration's only inclusion, it is the only Diagnostic: step 6 raises no
`E_EMPTY_DEPENDENCIES` beside an `E_EMPTY_PATTERN`. The Diagnostic line shows the pattern as written
(§14.3), `src\core`.

NOTE: A pattern that comes from a Preset (§8.6) is reported like any other when it is not an
exclusion: `E_EMPTY_PATTERN`, with the Preset named in the `[[Message]]`. An exclusion that comes
from a Preset never gives `W_EMPTY_EXCLUSION`: a Preset is a standard block shared by many files,
declared for the files that need it, and a file that has nothing to exclude could not remove the
warning without editing every other file that uses the Preset.

NOTE: An exclusion is *shadowed* (step 7) when a file it matches is still selected: the last
matching pattern wins (§8.4), so the last matching pattern of that file is an inclusion after the
exclusion, and the exclusion has no effect on it. In `src`, `!src/**/*.test.ts`, `src/sub` the
exclusion is shadowed by `src/sub` as soon as a test file exists under `src/sub/`. The test reads
the resolved files, not the patterns: an inclusion after the exclusion that selects none of the
files it matches, such as `docs` after `!src/gen`, gives no warning. A file named by its own literal
path after the exclusion, as `src/lib/x.ts` in `src/**`, `!src/lib`, `src/lib/x.ts` (§8.4 NOTE), is
re-selected on purpose and gives no warning; `src/lib`, which names a directory, is not such a path
for the files under it. It applies whatever the origin
of either pattern, a Preset included, because the cause is the order of the effective patterns
(§8.6), which `use` decides: `use: [no-tests, more-src]` re-selects the tests when `more-src` adds
a directory after the exclusions of `no-tests`, and the fix is to list the exclusions last. A file
that uses the Preset can fix it by its own `use` order, and the Preset's author by the Preset's own
order, so, unlike `W_EMPTY_EXCLUSION`, it is raised for patterns of a Preset too. The warning changes neither `Select`, the resolved files, the Dependency
Hash, the state of the file nor the exit code.

### 8.6 Presets

A Preset is defined in the Configuration file (§9.3). A Declaration, configured or inline, names the
Presets it uses in its `use` key; the patterns of a Preset are not a new syntax: they are patterns of
§8.1, and nothing in a pattern refers to a Preset, so no existing pattern changes meaning and a
Preset cannot refer to another one.

The *used Presets* of a Declaration are its `[[Use]]` when it is not none, and otherwise
`config.[[DefaultPresets]]`, the default Presets (§9.3). A Declaration *uses a Preset* when its
used Presets are not empty.

`ExpandPresets(declaration, presets, defaults, present)`, where *presets* is `config.[[Presets]]`,
*defaults* is `config.[[DefaultPresets]]` and *present* tells whether a Configuration file exists
(§9.3), returns the effective patterns and their origins of *declaration*, or raises:

1. Let *problems* be an empty List, *patterns* a copy of `declaration.[[Dependencies]]`, and *origins*
   a List of as many none elements. Let *used* be `declaration.[[Use]]` if it is not none, else
   *defaults*.
2. For each name *n* of *used*, in order: if *presets* has no key *n*, collect
   `E_UNKNOWN_PRESET` into *problems*, `[[Subject]]` *n*; otherwise append the patterns of the Preset
   *n*, in order, to *patterns*, and as many elements *n* to *origins*.
3. If *problems* is not empty, raise it. Otherwise return *patterns* and *origins*.

The message of `E_UNKNOWN_PRESET` is informative (§5.5); when *present* is false it SHOULD say that
Presets are defined in a Configuration file and that a Root without one has none.

NOTE: The effective patterns are the file's own patterns first, then each Preset in `use` order, so
an exclusion of a Preset applies after the file's own inclusions (§8.4: the last matching pattern
wins), and a later Preset can re-select what an earlier one excluded. The result is an ordinary
pattern list: `Select`, the Dependency Hash and the Lockfile are unaware of Presets. Editing a Preset
changes the dependencies of every file that uses it, and so is a `content-changed` exactly for the
files whose set of dependencies it changes (§12.1 NOTE). A Declaration whose `use` raises is
`invalid`, and its Result keeps its own patterns, unexpanded (§12.1 step 6).

NOTE: A file with an inline block that uses a Preset needs a Configuration file that defines it:
Presets are not definable in a block, so that a list shared by many files has one definition.

NOTE: The default Presets come last, after the file's own patterns, as any `use` does: a
Declaration without `use` behaves exactly as if its own `use` named `config.[[DefaultPresets]]`.
A Declaration with a `use` key does not get them: its `use` replaces them, so a file that needs
other Presets and a default one names both, and `use: []` uses none (§9.3 step 8.3, §9.6.2 step 6).
A name of `config.[[DefaultPresets]]` is checked once, when the Configuration file is read (§9.3
step 6), so this clause never raises for it. The default Presets are those of the Configuration
file at Root, for configured and inline Declarations alike: an inline file in a Root whose
Configuration file has `default-presets` gets them unless its block has a `use` key, and a Root
with no Configuration file has none. The warnings of §8.5 treat them as any Preset: an exclusion of a default Preset that
matches nothing is silent, `W_SHADOWED_EXCLUSION` names the default Preset as the origin of a
pattern, and `W_DUPLICATE_PATTERN` counts the file's own patterns only.

NOTE: Editing `default-presets`, like editing a Preset, changes the effective patterns of every
Declaration that has no `use` key. It is an ordinary change of selection: a file whose set of
dependencies changes is `stale` with `content-changed`, and a file whose set of dependencies is the
same stays `ok`, because the Dependency Hash depends on the resolved files only (§10.4), never on the
patterns. The Lockfile and its `version` are unchanged. It is not an edit of the file's own list
(§12.3 step 1.4), which holds the file's own `use` key only.

### 8.7 Selected Dependencies

A *Selected Dependency* is { `[[Path]]`: a RepoPath, `[[Select]]`: a plain value (§3.5) }. In a
`dependencies` List a Selected Dependency is written as a Map with the keys `path` and `select`, or
as a String in the *shorthand* `Path ":" Selector` (below); any other String is a Pattern (§8.1)
as before. The written `path` is a literal path (§8.5 NOTE) and
`[[Path]]` is the String it denotes, so a file named `a[1].json` is written `a\[1\].json`. A Map
with another key, a missing `path` or `select`, a `path` that is not a valid Pattern without
Negation or not a literal path, or a `select` holding a Number that is not finite at any depth is
`E_CONFIG` (`E_BLOCK` in an inline block).

Selected Dependencies with the same `[[Path]]` and the same `CanonicalJson([[Select]])` are one
dependency: the Declaration's `[[Selected]]` holds the first of them in order of appearance and
drops the others without a diagnostic.

A *Shorthand* is { `[[Path]]`: a RepoPath, `[[Raw]]`: a String }. `SplitDependency(s)` reads the code
points of the String *s* in order, a `\` and the code point after it counting as one escaped unit,
and returns none if no unit is a `:`; otherwise it splits *s* at the first `:` that is not escaped:
*path* is the text before it, as written, and *raw* the text after it, verbatim, so *raw* may hold
further `:` and `\`. `ParseShorthand(s)`, for an *s* that `SplitDependency` splits, returns a
Shorthand or raises. It raises when *path* or *raw* is empty, or when *path* is not a valid Pattern
(§8.1) without Negation or not a literal path (§8.5 NOTE), the message of a glob naming the escape
(`\*`, `\:`). `[[Path]]` is the String *path* denotes, as for a Map, so a file named `a:b.md` is
written `a\:b.md`. The raising is `E_CONFIG` (`E_BLOCK` in an inline block), `[[Subject]]`
`dependencies`.

NOTE: A String that has no unescaped `:` is a Pattern, and `\:` is already an Escape of §8.1 for a
literal `:`. A Pattern is split only where it is an element of `dependencies`; a Preset (§8.6), `include`
and `ignore` hold Patterns only.

A *Selector Grammar* is the same for every Plugin that declares `[[SelectorFields]]` (below).
`ResolveSelector(plugins, shorthand)` returns a plain value (§3.5) or an `E_SELECT` Diagnostic:

1. Let *plugin* be `Claim(plugins, shorthand.[[Path]])`. If that raises, or *plugin* has no
   `[[SelectorFields]]`, return `shorthand.[[Raw]]`, a String, verbatim: no `,`, `=` or `\` of it has a
   meaning, which is how a Value Path (§8.8) holding them is written.
2. Split *raw* into *items* at each `,` that is not escaped, an escape being a `\` before `,`, `=` or
   `\`. Any other `\` is literal.
3. If *items* has one item and it holds no `=` that is not escaped, return the item with its escapes
   resolved, a String, which must not be empty. This is the main field, and the String is the
   `select` that a bare String has always been, so no hash changes (§17.4).
4. Otherwise each item is *key* `=` *value*, split at its first `=` that is not escaped, with the
   escapes of both resolved; an item without such `=`, with an empty *key* or a *key* repeated is an
   `E_SELECT`. Let *type* be `fields[key]`; if there is none, the value stays a String and the Plugin
   judges the key as it judges a Map (`E_SELECT` through `ValidateSelect` or `Extract`). If *type* is
   `integer`, *value* must be `0` or a decimal integer without a leading zero or `+`, optionally
   after `-`, of at most 15 digits, and becomes that Number; if *type* is a List, *value* must be
   one of its Strings; otherwise it is an `E_SELECT`. Return the Map of the pairs.

The `E_SELECT` has `[[File]]` the file declaring it and `[[Subject]]` `[[Path]]`, `:` and `[[Raw]]`;
its message names the item and what to write. Even a single pair (`heading=Install`) is the Map, not
the String.

A *Plugin* is { `[[Name]]`: a non-empty String, `[[ApiVersion]]`: 1, `[[Files]]`: a non-empty List
of Patterns, `[[Extract]]`: a function, `[[ValidateSelect]]`: a function, when present,
`[[SelectorFields]]`: { `main`: a String, `fields`: a Map from a field name to `string`, `integer`
or a non-empty List of Strings, the member `fields[main]` being `string` }, when present }, other
members being ignored. Plugin names are unique. A `validateSelect` that is present and not a function,
or a `selectorFields` that is present and not of this shape, is an invalid Plugin (`E_PLUGIN`, §9.5).
The names of `fields` are the keys of the Map form the Plugin accepts, and `main` is the one that the
bare String stands for.

The *Plugin API* is the shape of this Map, of the Map `[[Extract]]` receives (§8.7 `Fragments` step 2)
and of the Map it returns (step 3), and `[[ApiVersion]]` names it; version 1 is the shape defined
here. Adding an optional member to the input or the result keeps `[[ApiVersion]]`. Removing a
member, or giving one another meaning, requires a new `[[ApiVersion]]`. docstamp accepts only
`[[ApiVersion]]` 1; §9.5 says what any other value raises.

`Claim(plugins, path)` returns the Plugin whose `[[Files]]` select *path* (`Select(Files, « path »)`
is not empty, §8.4), or raises. Let *claimed* be the Plugins of *plugins* that do; if it is empty,
let it be the Builtin Plugins (§8.8) that do. `E_SELECT` with `[[Subject]]` *path* if *claimed* is
empty; `E_PLUGIN` with `[[Subject]]` *path* if it holds more than one, its message naming each
Plugin.

`Fragments(entry, text)`, with *subject* the path of *entry*, `#` and
`CanonicalJson(entry.[[Select]])`, returns a Fragment and a List of warnings, or raises:

0. Let *plugin* be `Claim(plugins, entry.[[Path]])`, which raises as above.
1. If the file is a link, binary (§10.1) or not valid UTF-8, raise `E_SELECT` (`[[Subject]]` the
   path). *text* is the content of §10.2 steps 1 to 4 after the `file` tag.
2. Call `plugin.[[Extract]]` synchronously with { `path`, `text`, `select` }, *select* being a copy
   of `entry.[[Select]]`, so what the Plugin does to it changes neither the Declaration nor any
   Hash. If it throws, returns a Promise or does not return a Map, raise `E_SELECT`
   (`[[Subject]]` the path).
3. Read from the result { `parts` }, « » when absent, a List of Maps { `content`: a String without
   a lone surrogate, `focus`: a non-empty String, when present, `lines`: a Map { `start`, `end` }
   of integers with 1 <= `start` <= `end`, when present }, and { `diagnostics` },
   « » when absent, a List of at most 100 Maps { `severity`: `error` or `warning`, `message`: a
   non-empty String, `code`: a *Plugin Code*, when present }. A *Plugin Code* is a String of 1 to 64
   characters of `a-z`, `0-9` and `-`, the first a letter (`heading-not-found`). A `focus` or a `message` holds no code point below U+0020 and no U+007F, so
   it is one line. The limit of 100 counts `diagnostics` as returned, before duplicates are
   removed (§5.5). Any other shape raises `E_SELECT` (`[[Subject]]` the path). Other members are
   ignored.
4. Let *errors* be, for each `error` of `diagnostics` in the order given, an `E_SELECT` Diagnostic
   with `[[Subject]]` *subject*, `[[Message]]` its `message` and `[[PluginCode]]` its `code` when it
   has one, and *warnings* the same with `W_SELECT` for each `warning`.
5. If *errors* is not empty, raise *errors* and *warnings*; the order the Plugin gave them in does
   not matter (§5.5).
6. If `parts` is empty, raise `E_SELECT_NOT_FOUND` with `[[Subject]]` *subject*, and *warnings*.
7. Otherwise the Fragment is `parts` in the order given, each a Part { `[[Content]]`, `[[Focus]]`,
   `[[Lines]]` }, and *warnings* are returned with it.

`ValidateSelect(entry, plugin)`, with *entry* a Selected Dependency of the Declaration *file*, returns
a List of Diagnostics. It is called at load (§12.2 step 5), once for each Selected Dependency of each
Declaration, never at evaluation, and only when `Claim(plugins, entry.[[Path]])` returns a Plugin
that has `[[ValidateSelect]]`; a Plugin without it adds nothing, and a path no Plugin claims is left
to `Fragments` step 0. It reads no file:

1. Call `plugin.[[ValidateSelect]]` synchronously with a copy of `entry.[[Select]]` (as `Fragments`
   step 2). If it throws or returns a Promise or not a Map, return « `E_SELECT` » with `[[File]]`
   *file* and `[[Subject]]` the path, `#` and `CanonicalJson(entry.[[Select]])`.
2. Read from the result `diagnostics`, « » when absent, as `Fragments` step 3 does; other members are
   ignored. A `diagnostics` of another shape, or holding a `warning`, gives the same `E_SELECT` as
   step 1.
3. Return, for each `error` in the order given, an `E_SELECT` Diagnostic with `[[File]]` *file*, the
   `[[Subject]]` of step 1, `[[Message]]` its `message` and `[[PluginCode]]` its `code` when it has
   one.

The Diagnostics are attached (§5.5): a Declaration that has one is `invalid` and none of its
dependencies is resolved or hashed, as for an `E_PATTERN` (§12.1 step 6). A selector a Plugin
validates is therefore reported with the file and the path it is written in, before any file is read.
`E_SELECT` is the code, not `E_CONFIG`: the selector is the Plugin's (§8.7), its malformation is the
same fact `Fragments` step 4 reports, and a Declaration stays an ordinary Declaration. No new code.

NOTE: A Shorthand is resolved at load (§12.2 step 5), before any hash, so it is the Selected
Dependency the written Map would be: `docs/guide.md:Install` is `{ path: docs/guide.md, select:
Install }`, and `docs/guide.md:heading=Install,level=2` is `{ path: docs/guide.md, select: { heading:
Install, level: 2 } }`, with the same Dependency Hash (§10.4, §17.7). The bare form and the one-pair form
are different values, as `Install` and `{ heading: Install }` always were; `CanonicalJson` of a Map
orders its keys (§3.5), so the order of the pairs never matters. Reports print the resolved
`CanonicalJson` (§14.3).

NOTE: `ValidateSelect` is an early check, not a second extraction: a Plugin MUST NOT depend on the
file's content in it, and a selector it accepts may still be `E_SELECT` or `E_SELECT_NOT_FOUND` at
`Fragments`. `list-dependencies` (§13.7) calls it too, since it runs at load and reads no file.

NOTE: A Plugin Code is the Plugin's own identifier of a kind of Diagnostic, stable across its
versions so that a consumer can act on it; it is advisory and is never part of a Hash. It changes
neither the code (`E_SELECT` or `W_SELECT`, never another), the state of a file, a Hash nor an exit
code, and two Plugins may use the same one. A Plugin that gives none behaves as before; its own
SPEC says which it gives and which are stable (§17.1).

NOTE: A Plugin decides what a selector selects, and says so. One Part means one piece; several
Parts mean the selector asked for all of them, and the Fragment depends on every one, in the order
given, so a Plugin SHOULD return them in an order that does not change when an unrelated part of
the file does. A selector that selects several Parts only by accident SHOULD be an `error`, since
the reader cannot tell which was meant; docstamp has no policy for it. A `warning` is for what the
reader can fix while a Part still stands, and SHOULD NOT be output on every run for something
harmless. Every `message` SHOULD name what to change.

NOTE: *Focus* says in words what a Part is, as a reader of the report needs it (`section "Install"
(level 2)`, `function createUser`), and *Lines* where it is in *text*, which has the line count of the
file (CR LF is read as LF, §10.2). A Part has one range: what lies in several places of the file is
several Parts, each with its own. Both are written by the Plugin, advisory, and never part of a Hash or a verdict (§10.4 reads `content`
only); they appear in the changed-file report (§12.3 step 11). A warning never changes a state, a
Hash or an exit code (§5).

NOTE: A file that is `invalid` shows the warnings of the Selected Dependencies that raised, and of
no other (§12.1 step 6). A Plugin that begins to report as an `error` what it reported as a
`warning` changes verdicts through the Plugin, not through docstamp: §17.2 does not apply, and the
Plugin's own SPEC says what is breaking for it.

NOTE: A Selected Dependency whose path is not in the Universe, or is the file itself, is
`E_EMPTY_PATTERN` with `[[Subject]]` the path (§8.5 steps 2 and 3). A file whose `dependencies`
hold only Selected Dependencies is not `E_EMPTY_DEPENDENCIES`.

NOTE: A Plugin is user code run in the host runtime, like a script Carrier (§9.5 NOTE): it SHOULD be
deterministic and independent of the environment, the clock and the network (§2). The `content` of
its Parts is hashed by docstamp (§10.4) and otherwise opaque to it.

NOTE: `list-dependencies` (§13.7) does not call `[[Extract]]` of a Plugin. `ChangedSince` (§12.3) reports the
Selected Dependencies whose Fragment changed (step 11); `stats` (§13.9) and `suggest` (§13.10) do
not know Selected Dependencies yet: `stats` counts a commit that touches the path.

### 8.8 Builtin Plugins

Two Plugins are built in. `Claim` (§8.7) falls back to them when no registered Plugin claims a path,
so a registered Plugin whose `[[Files]]` select a path replaces the builtin one for it. They need no
registration and work in every Carrier and in an inline block; they are not in `plugins`, and their
names are not checked against it.

| `[[Name]]` | `[[Files]]` | Text parsed as |
|---|---|---|
| `docstamp-json` | `**/*.json` | one JSON value (RFC 8259); of a repeated key in an object the last wins |
| `docstamp-yaml` | `**/*.yaml`, `**/*.yml` | one YAML 1.2 document, core schema, no merge keys |

Their `[[ApiVersion]]` is 1, they declare no `[[SelectorFields]]`, so a Shorthand for them is the
Value Path verbatim (`package.json:scripts.build`, `config.yaml:items.0.name`, `a.json:["x,y"].z`), and
their `select` is a *Value Path*: a String of one or more steps.
The first step is a name or a bracket; each later step is `.` and a name, or a bracket. A *name* is
one or more characters other than `.`, `[` and `]`; a *bracket* is `[`, a JSON String and `]`,
which names a key of any characters. `scripts.build`, `items.0.name` and `["a.b"].c` are Value
Paths.

`Extract(path, text, select)`:

1. Parse *text*. A text that does not parse, a YAML text with more than one document, an error or
   warning of the YAML parser (a repeated key, an alias that is not defined, too many aliases), or a
   *select* that is not a Value Path, gives `{ diagnostics: « d » }` with *d* an `error` whose
   message says which of them it is and what to correct.
2. Let *value* be the parsed value. For each step: if *value* is a List and the step is `0` or a
   decimal without a leading zero, less than its length, let *value* be that element; if *value* is
   a Map and has the step as an own key, let *value* be its member; otherwise return `{ }`, which
   docstamp reports as `E_SELECT_NOT_FOUND` (§8.7 step 6).
3. If *value* holds anywhere a Number that is not finite, or a value that is not a null, Boolean,
   Number, String, List or Map with String keys, return an `error` as in step 1.
4. Return `{ parts: « p » }` with *p* the Part { `content`: `CanonicalJson(value)` (§3.5), `focus`:
   the *select*, a space and in parentheses the type of *value*: `null`, `boolean`, `number`,
   `string`, `list` or `object` (`scripts.build (string)`) }. It gives no `lines`.

So a key reordered, a comment, the quoting style and the indentation never change a Fragment, and a
changed value does. `null` at the path is a value like any other. The Fragment never holds more
than one Part.

NOTE: Several Selected Dependencies of one file are independent (§8.7): each has its own `select`,
its own Fragment and its own `E_SELECT_NOT_FOUND`, and the Dependency Hash (§10.4 step 3) has a
line for each.

NOTE: A change to the `content` these Plugins return (the `CanonicalJson` of the value) is a change
of a Hash input (§17.2).
