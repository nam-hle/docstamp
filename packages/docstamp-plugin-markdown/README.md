# docstamp-plugin-markdown

A [docstamp](https://github.com/nam-hle/docstamp#readme) plugin: depend on one **section** of a
Markdown file, by its heading, so a doc goes stale only when that section changes.

> Not published yet: the first release follows the first docstamp release that has the plugin API
> (0.6.0). Until then it is built and tested in the repository.

```sh
pnpm add -D docstamp docstamp-plugin-markdown
```

Plugins are registered in a script configuration (`docstamp.config.ts` or `.js`):

```ts
import { defineConfig } from 'docstamp';
import markdown from 'docstamp-plugin-markdown';

export default defineConfig({
  version: 2,
  plugins: [markdown],
  files: {
    'CLAUDE.md': {
      dependencies: [{ path: 'guide.md', select: 'Install' }],
    },
  },
});
```

`CLAUDE.md` now depends on the `Install` section of `guide.md` and on nothing else. Real output:

```
$ docstamp
STALE    CLAUDE.md  (unrecorded)
  depends   "guide.md#\"Install\""
0 ok, 1 stale, 0 invalid

$ docstamp update CLAUDE.md
written  CLAUDE.md
```

An edit to `## Usage` leaves it `ok`. An edit to the `Install` section makes it stale:

```
$ docstamp
STALE    CLAUDE.md  (content-changed)
  fragment  "guide.md#\"Install\""  (changed)  section "Install" (level 2) (lines 3-6)
  review: git diff -M <commit> -- guide.md
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md
```

The report names the section and its lines because this plugin returns them with the hash (`focus` and `lines`, [SPEC §6](SPEC.md#6-extract)).

## The selector

- `select: 'Install'` names the heading `Install`, at any level.
- `select: { heading: 'Install', level: 2 }` names only a level 2 heading.
- The text is matched **as written in the file**, without the `#`s and the closing sequence:
  `## *Fast* path` is selected by `'*Fast* path'`. Nothing is decoded or stripped, so a formatting
  edit to the heading makes the selector match nothing (`E_SELECT_NOT_FOUND`) instead of silently
  tracking a different heading.
- A heading that appears twice is `E_SELECT_AMBIGUOUS`; rename one of them.

## What is hashed

The **source text** of the section: the heading line and everything up to the next heading of the
same or a higher level, subsections included. Every byte counts, so a reformatted line or a blank
line added before the next heading is a change. Text above the heading, the other sections and the
YAML frontmatter never change the hash.

- Only top-level headings start a section. A heading inside a quote, a list or an HTML block does
  not, and a `#` line in a code block or an HTML comment is not a heading.
- An invalid selector is reported as `E_SELECT` without detail; the forms above are the only valid
  ones.

The full contract is [SPEC.md](SPEC.md). The plugin parses with [`marked`](https://github.com/markedjs/marked)
only to find where sections begin and end.
