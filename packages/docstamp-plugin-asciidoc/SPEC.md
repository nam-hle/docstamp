# docstamp-plugin-asciidoc Specification

The contract of the plugin: which part of an AsciiDoc file a selector names, and what is hashed.
How docstamp calls a plugin, counts matches and reports errors is the contract of docstamp
([SPEC §8.7](../docstamp/docs/spec/08-patterns.md#87-selected-dependencies)); this document does not repeat it.

## 1 Scope

The plugin registers for AsciiDoc files and lets a dependency name one *section* by its title or its
anchor, so a doc that rests on one section of a long manual goes stale only when that section changes.
It parses the file with Asciidoctor (`@asciidoctor/core`, the 3.0 line) only to find where sections
begin and end; it hashes the source text of the section, never a rendering.

An `include::` directive is never followed and no file other than the one given is read: the text of
an included file is not part of a section, so a doc that rests on it names that file as a dependency
of its own.

## 2 Terms

- *Source*: the text of the file, with every CR LF replaced by LF (§5.1).
- *Section*: a section of the Source as Asciidoctor parses it, at any depth (§5.2), and the text it
  covers (§5.5).
- *Level*: the number of `=` (or `#`) of its title marker, 1 to 6: Asciidoctor's level plus one, so a
  section written `== Install` has level 2 and a document title has level 1.
- *Title*: the text of the title line as written (§5.3).
- *Anchor*: the id the author gave a section, with `[#id]`, `[[id]]` or `[id=...]` above its title.
  A section without one has no Anchor; an id Asciidoctor would generate from the title is not one.
- *Selector*: the `select` value of a dependency (§4).

## 3 The Plugin

The default export is a docstamp plugin (SPEC §8.7) with `name` `docstamp-plugin-asciidoc`,
`apiVersion` 1 and `files` « `**/*.adoc`, `**/*.asciidoc`, `**/*.asc` ». Its `extract` is `Extract`
(§6), its `validateSelect` is `ValidateSelect` (§6.1), its `parseSelect` is `ParseSelect` (§4.1) and
its `meta.schema` (SPEC §8.7 Select Schema) is { `type`: « `string`, `object` », `minLength`: 1,
`properties`: { `title`: { `type`: `string`, `minLength`: 1 }, `level`: { `type`: `integer`,
`minimum`: 1, `maximum`: 6 }, `anchor`: { `type`: `string`, `minLength`: 1 } },
`additionalProperties`: `false` }: it names the keys of §4 and the range of step 5, so docstamp refuses
a Map with another key or a level outside 1 to 6 before `ValidateSelect` runs. The combinations the
schema cannot say are `ValidateSelect`'s (§4 steps 2 and 4).

## 4 Selector

`ParseSelector(v)` returns { `[[Kind]]`: `title`, `[[Title]]`: a String, `[[Level]]`: a Number or
*none* } or { `[[Kind]]`: `anchor`, `[[Anchor]]`: a String }, or raises:

1. If *v* is a String, let *title* be *v*, and *level* and *anchor* be *none*.
2. Else if *v* is a Map whose keys are all `title`, `level` or `anchor`, let *title*, *level* and
   *anchor* be its values, or *none* if absent.
3. Otherwise raise.
4. If *anchor* is not *none*: raise if *title* or *level* is not *none*, or if *anchor* is not a String
   or is empty after its leading and trailing U+0020 and U+0009 are removed; otherwise return the
   Anchor selector with that text.
5. Remove from *title* its leading and trailing U+0020 and U+0009. Raise if *title* is not a String or
   is empty.
6. Raise unless *level* is *none* or an integer from 1 to 6.

### 4.1 ParseSelect

A dependency may be written as one String, `Path ":" Raw` (SPEC §8.7), whose *Raw* docstamp gives to
`ParseSelect(raw)`; what it returns is the `select`, so it is the only value hashed. It reads *raw*
in one linear pass:

1. Let *n* be the number of `=` at the start of *raw*. If *n* is not 0 and the code point after them
   is U+0020 or U+0009, *raw* is a level marker and a title: if *n* is greater than 6, or *raw* after
   the blanks that follow the marker, with its trailing U+0020 and U+0009 removed, is empty, return
   `{ diagnostics: « d » }`, *d* an `error` with the code `invalid-selector`; otherwise return
   `{ select: { title, level: n } }`, *title* being that text.
2. Otherwise, if *raw* starts with `#`, has a code point after it, and that code point is not U+0020
   or U+0009, return `{ select: { anchor } }`, *anchor* being *raw* after the `#`, with its trailing
   U+0020 and U+0009 removed.
3. Otherwise return `{ select: raw }`: *raw* itself, a String, verbatim.

`docs/guide.adoc:Install` is the String `Install`, `docs/guide.adoc:== Install` is the Map
`{ title: Install, level: 2 }` (the level is the number of `=`), and `docs/guide.adoc:#install-steps`
is the Map `{ anchor: install-steps }`, each with the hash of the same Map written out. `,` and `=` mean nothing inside *raw* after the marker, so a title that holds them is
written as it is. A title that starts with `=` and a blank, or with `#` and a non-blank, is written as
the Map, `{ title: '#1 rule' }`. The String `Install` and the Map `{ title: Install }` are different
`select` values, so their hashes differ.

NOTE: A selector that raises is returned as `{ diagnostics: « d » }`, *d* an `error` whose message
says what is wrong and the three forms that are accepted (`Install`, `{ title: Install, level: 2 }`
and `{ anchor: install }`); docstamp reports it as `E_SELECT` (SPEC §8.7). A selector that is valid
but matches nothing returns a `warning` (§6.2), which docstamp reports with `E_SELECT_NOT_FOUND`.

## 5 Source, Sections

### 5.1 Source

`Source(text)` is *text* with every CR LF replaced by LF. Nothing else is removed or changed: a
leading comment block, a header or a byte order mark stays where it is, and every line number below
counts the lines of the Source.

### 5.2 Sections

`Sections(source)` returns the List of Sections in source order, each { `[[Level]]`, `[[Title]]`,
`[[Anchor]]`: a String or *none*, `[[TitleLine]]`: 1-based, `[[Start]]`: 1-based }. They are the
sections of the document that Asciidoctor builds from *source* with the safe mode `secure`, the source
map on, and the attribute `sectids` unset, taken depth first through the document and its sections only:
a section inside an AsciiDoc table cell or a delimited block is none. `[[TitleLine]]` is the line of the title that Asciidoctor reports. The mode `secure` turns
every `include::` into a link, so no file is read and the line numbers do not move.

NOTE: A heading that Asciidoctor does not parse as a section is no Section: a `==` line inside a
listing, a literal or a comment block, a `[discrete]` heading, a line a conditional (`ifdef::`)
removes. Attributes the file does not define itself, such as ones given on the command line of a
build, are not known, so a conditional that depends on one is read as if it were not set.

### 5.3 Title

`TitleText(line)` is the source of the title line without its marker: if the line starts with one or
more `=` or one or more `#` (all the same code point) and then U+0020 or U+0009, the text after the
marker and the blanks that follow it, without its trailing U+0020 and U+0009 and, when they follow a
blank, the closing marker (a run of the same code point as the marker); otherwise the line is a
two-line (setext) title and the title is the line without its leading and trailing U+0020 and U+0009.
No attribute reference, entity or formatting is resolved: `== *Fast* path` has the title `*Fast* path`.

### 5.4 Start

The `[[Start]]` of a Section is its `[[TitleLine]]`, moved up by one line for each directly preceding
line that is a block attribute line, until a line that is not one. A block attribute line is a line that, without its leading and trailing U+0020 and U+0009,
has more than two code points, starts with `[` and ends with `]`: `[#id]`, `[[id]]`, `[discrete]`.

NOTE: The anchor line belongs to the section it names, so a change to it is a change to that section
and to no other. A blank line, a comment or a block title (`.Title`) between the attribute line and
the title ends the climb.

### 5.5 End

`SectionEnd(i, sections, last)` is, for the Section *s* at index *i*, one less than the `[[Start]]` of
the first Section after *s* whose `[[Level]]` is not greater than that of *s*, or *last*, the number of
lines of the Source (the empty line after a final line terminator counts), if there is none. The
text of *s* is the lines of the Source from its `[[Start]]` to `SectionEnd`, joined with LF and followed
by an LF unless it reaches *last*, so it includes the title line, its subsections and the blank lines
that follow its content, and ends where the Source does for the last one.

## 6 Extract

`Extract({ path, text, select })` returns { `parts`, `diagnostics` }:

1. Let *selector* be ? `ParseSelector(select)`; where it raises, return the `error` of §4 NOTE.
2. Let *source* be `Source(text)`. Let *sections* be `Sections(source)`; where Asciidoctor raises,
   return `{ diagnostics: « d » }`, *d* an `error` with the code `parse-failed` whose message says
   that the file could not be parsed as AsciiDoc and holds no text of the parser.
3. Let *matches* be the Sections whose `[[Anchor]]` equals `selector.[[Anchor]]` for an Anchor
   selector, and whose `[[Title]]` equals `selector.[[Title]]` and, unless `selector.[[Level]]` is
   *none*, whose `[[Level]]` equals it, for a Title selector.
4. If *matches* is empty, return `NotFound` (§6.2). If it has more than one Section, return
   `{ diagnostics: « d » }`, *d* an `error` with the code `ambiguous-section` whose message names the
   `[[Start]]` of each Section and says to add a level or an anchor, or to rename one of them.
5. Otherwise return `{ parts: « p » }`, *p* the Part { `content`: the text of the match (§5.5),
   `focus`: `section "<Title>" (level <Level>)` with each code point of *Title* below U+0020 or equal
   to U+007F replaced by U+0020 (SPEC §8.7 step 3 refuses a `focus` of more than one line),
   `lines`: { `start`, `end` } }, `start` the `[[Start]]` of the match and `end` the line of the last
   character of its text, not less than `start`, counted in the Source.

NOTE: `focus` and `lines` are advisory: docstamp prints them in its changed-file report and never
hashes them, so they are not part of the compatibility of §7.

NOTE: Two Sections that the selector selects are an `error`, even when it has a `level` that both
have: this Plugin has no form that selects all of them. An Anchor selector selects two Sections only
when the file gives one id twice.

NOTE: Every byte of a section counts: a reformatted line, a changed list marker or a blank line added
before the next section is a change. docstamp already normalizes CR LF to LF; step 2 makes a caller
that does not get the same hashes. Text above the section, the other sections and an `include`d file
never change the hash.

### 6.1 ValidateSelect and codes

`ValidateSelect(select)` returns `{ }` if `ParseSelector(select)` (§4) does not raise, and otherwise
the `error` of §4 NOTE. docstamp calls it when the configuration loads (SPEC §8.7), so a selector that
is not valid is reported before any file is read; it never reads the file.

Every Diagnostic of this Plugin has a code (SPEC §8.7 step 3), stable across versions:

| Code | Severity | Where |
|---|---|---|
| `invalid-selector` | `error` | §4 NOTE, in `Extract` step 1 and in `ValidateSelect`; §4.1 step 1, in `ParseSelect` |
| `parse-failed` | `error` | `Extract` step 2, Asciidoctor raised |
| `ambiguous-section` | `error` | `Extract` step 4, more than one Section selected |
| `section-not-found` | `warning` | `NotFound`, no Section selected |

### 6.2 NotFound

`NotFound(selector, sections)` returns `{ diagnostics: « d » }`, *d* a `warning` with the code
`section-not-found` and no part, so docstamp raises `E_SELECT_NOT_FOUND` (SPEC §8.7 step 6) and prints
*d* with it. Its `message` is one line and names the selector as written (`No section "Install"`, with
`at level 3` when it has a level; `No section with the anchor "install"`), then the first of these
that applies, each Section written `<=s> <Title> (line <n>)`, in the order of the file, *n* its
`[[TitleLine]]`:

1. For a Title selector, *sections* is empty: the file has no sections. For an Anchor selector, no
   Section has an Anchor: the file has no section with an anchor.
2. For a Title selector, some Section has the title of the selector, so only the level is wrong: those
   Sections, at most 5, and an instruction to correct the level.
3. Some Section has a title (an Anchor, for an Anchor selector, among the Sections that have one)
   within an edit distance (Levenshtein, over code points) of the larger of 2 and a third of the
   length of the text of the selector (rounded down) of it, or equal to it but for case: the nearest,
   at most 5, ordered by distance, then by line, as `nearest: ...`.
4. Otherwise the first 10 Sections (of those that have an Anchor, for an Anchor selector), then
   `and <n> more` if there are others.

The message holds no path and no code point below U+0020 (each is replaced by U+0020), so the same
file gives the same message on every machine.

## 7 Compatibility

The hash of a section is part of the Dependency Hash of every file that depends on it, so a change to
`Source`, `Sections`, `Start` or `SectionEnd` that changes the hash of an existing section is breaking,
as is a change to the selector forms accepted in §4, to `files` or `meta.schema` in §3, or to what
§4.1 returns for a *raw*. Removing or renaming a code of §6.1 is breaking for those who act on it;
adding one is not. An Asciidoctor upgrade that changes where a section starts or ends, or the line it
reports for a title, is such a change, which is why the dependency is held to one minor line.
