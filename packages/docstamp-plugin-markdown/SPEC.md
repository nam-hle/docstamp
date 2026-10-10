# docstamp-plugin-markdown Specification

The contract of the plugin: which part of a Markdown file a selector names, and what is hashed.
How docstamp calls a plugin, counts matches and reports errors is the contract of docstamp
([SPEC §8.7](../docstamp/docs/SPEC.md#87-selected-dependencies)); this document does not repeat it.

## 1 Scope

The plugin registers for Markdown files and lets a dependency name one *section* by its heading, so a
doc that rests on one section of a long guide goes stale only when that section changes. It parses
Markdown with `marked` (CommonMark with GitHub Flavored Markdown, default options) only to find where
sections begin and end; it hashes the source text of the section, never a rendering.

## 2 Terms

- *Body*: the text of the file without its YAML frontmatter (§5.1).
- *Heading*: a top-level ATX or setext heading of the Body (§5.2).
- *Section*: a Heading and the source text that follows it, up to the next Heading of the same or a
  higher rank (§5.3).
- *Selector*: the `select` value of a dependency (§4).

## 3 The Plugin

The default export is a docstamp plugin (SPEC §8.7) with `name` `docstamp-plugin-markdown`,
`apiVersion` 1 and `files` « `**/*.md`, `**/*.markdown` ». Its `extract` is `Extract` (§6).

## 4 Selector

`ParseSelector(v)` returns { `[[Heading]]`: a String, `[[Level]]`: a Number or *none* }, or raises:

1. If *v* is a String, let *heading* be *v* and *level* be *none*.
2. Else if *v* is a Map whose keys are all `heading` or `level`, let *heading* be its `heading` and
   *level* its `level`, or *none* if absent.
3. Otherwise raise.
4. Remove from *heading* its leading and trailing U+0020 and U+0009. Raise if *heading* is not a
   String or is empty.
5. Raise unless *level* is *none* or an integer from 1 to 6.

NOTE: A selector that raises is reported by docstamp as `E_SELECT` (the plugin threw). A selector
that is valid but matches nothing is `E_SELECT_NOT_FOUND`.

## 5 Body, Headings, Sections

### 5.1 Body

`Body(text)`: if the first line of *text* is exactly `---` and a later line is exactly `---` or `...`,
return *text* after the line terminator of the first such later line; otherwise return *text*.

NOTE: A frontmatter block is not Markdown. Without this rule its `# comment` lines would be
headings, and an edit to the frontmatter would change a section.

### 5.2 Headings

`Headings(body)` returns the List of Headings in source order, each { `[[Depth]]`: 1 to 6, `[[Text]]`,
`[[Start]]`: an offset into *body* }. A Heading is a top-level block of *body* that is an ATX or a
setext heading (CommonMark §4.2, §4.3); `[[Start]]` is the offset of the first code unit of the
block's source, and `[[Text]]` is the source of its content, without the leading `#`s, the closing
sequence and the surrounding spaces, exactly as written: no entity or escape is decoded and no
emphasis is removed.

NOTE: A heading inside a block quote, a list item or an HTML block is not top-level, so it is no
Heading. A `#` line inside a fenced or an indented code block, an HTML comment or a paragraph that
does not start with it is not a heading.

### 5.3 Sections

`SectionEnd(h, headings, body)` is the `[[Start]]` of the first Heading after *h* whose `[[Depth]]` is
not greater than that of *h*, or the length of *body* if there is none. The Section of *h* is `body`
from `h.[[Start]]` to `SectionEnd`, so it includes the Heading line, its subsections and the blank
lines that follow its content.

## 6 Extract

`Extract({ path, text, select })` returns { `hashes`, `focus`, `lines` }:

1. Let *selector* be ? `ParseSelector(select)`.
2. Let *body* be `Body(text)` with every CR LF replaced by LF, and *headings* be `Headings(body)`.
3. Let *matches* be the Headings *h* with `h.[[Text]]` equal to `selector.[[Heading]]` and, unless
   `selector.[[Level]]` is *none*, `h.[[Depth]]` equal to it.
4. Return `hashes`, the List, in source order, of the lower-case hexadecimal SHA-256 of the UTF-8
   encoding of the Section of each match; and, when there is a match, `focus`, the List of the Strings
   `section "<Text>" (level <Depth>)` of the matches, and `lines`, the List of { `start`, `end` } of
   their Sections: the line of the Heading and the line of the last character of the Section, counted
   in *text* (the argument, frontmatter included, CR LF read as LF).

NOTE: `focus` and `lines` are advisory: docstamp prints them in its changed-file report and never
hashes them, so they are not part of the compatibility of §7.

NOTE: Two Headings with the same text give two hashes, so docstamp reports `E_SELECT_AMBIGUOUS`
unless the dependency says `match: all`, which depends on every one.

NOTE: Every byte of a Section counts: a reformatted line, a changed list marker or a blank line added
before the next Heading is a change. docstamp already normalizes CR LF to LF; step 2 makes a caller
that does not get the same hashes.
Text above the Heading, other Sections and the frontmatter never change the hash.

## 7 Compatibility

The hash of a Section is part of the Dependency Hash of every file that depends on it, so a change to
`Body`, `Headings` or `SectionEnd` that changes the hash of an existing Section is breaking, as is a
change to the selector forms accepted in §4 or to `files` in §3. A parser upgrade that changes where a
Heading starts or ends is such a change.
