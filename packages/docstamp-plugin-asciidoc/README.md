# docstamp-plugin-asciidoc

A [docstamp](https://github.com/nam-hle/docstamp#readme) plugin: depend on one **section** of an
AsciiDoc file, by its title or its anchor, so a doc goes stale only when that section changes.

> Not published yet: the first release follows the first docstamp release that has the plugin API
> (0.6.0). Until then it is built and tested in the repository.

```sh
pnpm add -D docstamp docstamp-plugin-asciidoc
```

This plugin is about the file a doc depends **on**: any doc, in any format, can name a section of an
AsciiDoc file. The format of the doc that declares the dependency is a separate matter: an inline
declaration exists for Markdown frontmatter only, so every other doc, an AsciiDoc one included, is
declared in the configuration file.

Plugins are registered in a script configuration (`docstamp.config.ts` or `.js`). A repository with
only a `docstamp.yaml` needs one to use a plugin
([SPEC §9.5](https://github.com/nam-hle/docstamp/blob/main/packages/docstamp/docs/spec/09-configuration-file.md#95-script-carriers)):

```ts
import { defineConfig } from 'docstamp';
import asciidoc from 'docstamp-plugin-asciidoc';

export default defineConfig({
  version: 2,
  plugins: [asciidoc],
  files: {
    'CLAUDE.md': {
      dependencies: [{ path: 'docs/guide.adoc', select: 'Install' }, 'src/install.ts'],
    },
  },
});
```

`CLAUDE.md` now depends on the `Install` section of `docs/guide.adoc`, on `src/install.ts`
and on nothing else: an edit to any other section of the guide leaves it `ok`.

## The selector

- `select: 'Install'` names the section titled `Install`, at any level.
- `select: { title: 'Install', level: 2 }` names only a level 2 section: the number of `=` of its
  title, so `== Install`.
- `select: { anchor: 'install-steps' }` names the section that has the anchor `[#install-steps]`
  (or `[[install-steps]]`, or `[id=install-steps]`) above its title. Use it when a title appears twice.
- They fit in one string next to the path: `'docs/guide.adoc:Install'`, `'docs/guide.adoc:== Install'`
  and `'docs/guide.adoc:#install-steps'`. A comma or an equals sign inside a title needs no escape
  ([SPEC §4.1](SPEC.md#41-parseselect)).
- A selector that is not one of these shapes, such as `level: 9`, an unknown key or an anchor with a
  title, is refused before any file is read, with the place and what was expected.
- The title is matched **as written in the file**, without the `=`s: `== *Fast* path` is selected by
  `'*Fast* path'`. Nothing is resolved, so a formatting edit to the title makes the selector match
  nothing (`E_SELECT_NOT_FOUND`) instead of silently tracking a different section.
- An anchor is only one the author wrote. An id that Asciidoctor would make from the title is not an
  anchor, so renaming a title never changes what an anchor names.
- A section that is not there is `E_SELECT_NOT_FOUND`, with a warning naming the nearest titles or
  the level it has. A title that appears twice is an `E_SELECT` whose message names both lines; add
  a level or an anchor, or rename one of them.

## What is hashed

The **source text** of the section: its title line, the attribute lines (`[#id]`) directly above it,
and everything up to the next section of the same or a higher level, subsections included. Every byte
counts, so a reformatted line or a blank line added before the next section is a change. Text above
the section, the other sections and the document header never change the hash.

- `include::` is **not** followed and no other file is read. A doc that renders code from an included
  snippet lists that file as a dependency of its own.
- Only sections Asciidoctor parses count. A `==` line in a listing, literal or comment block is not
  one, and neither is a `[discrete]` heading.
- Attributes the file does not set itself (for example ones passed to your build on its command line)
  are not known, so `ifdef::` blocks that depend on them are read as if the attribute were unset.
- Asciidoctor's own warnings (a duplicate id, a skipped level) are not printed.

## Reading an AsciiDoc doc that declares dependencies

`docstamp suggest` and `docstamp check --undeclared` find the paths a doc mentions, and without this
plugin they only know Markdown syntax. For a doc this plugin claims (`.adoc`, `.asciidoc`, `.asc`) it
reads the AsciiDoc ([SPEC §7](SPEC.md#7-mentions)):

- the targets of `include::`, `image::`, `image:`, `link:` and `xref:` macros, relative to the doc
  (`include::./snippets/a.ts[tags="demo"]` mentions `snippets/a.ts` next to the doc);
- code spans (`` `src/a.ts` ``) and bare words that contain a `/`;
- nothing inside a listing (`----`), literal (`....`), comment (`////`) or passthrough (`++++`)
  block, nor on a `//` comment line.

This needs a docstamp that calls `mentions` (the member is ignored by one that does not), and a doc
that is declared in the configuration file, as above.

The full contract is [SPEC.md](SPEC.md). The plugin parses with
[`@asciidoctor/core`](https://github.com/asciidoctor/asciidoctor.js) only to find where sections begin
and end. It is held to the 3.0 line, the last one with a synchronous API, which docstamp plugins need.
