---
title: Depend on part of a file
---

# Depend on part of a file

A pattern depends on a whole file. When a doc rests on one section of a long guide, an edit to any
other section still makes it stale. A *plugin* teaches docstamp to hash one part of a file: you
register it in a script configuration and name the part with `select`. docstamp stays
format-agnostic; the plugin decides what a selector means.

## Use a plugin

Register it under `plugins` of `docstamp.config.ts` and add an entry `{ path, select }` next to the
patterns. Here `CLAUDE.md` depends on `src` and on the `Install` section of `docs/guide.md` only:

```ts
// docstamp.config.ts
import { defineConfig } from 'docstamp';
import headings from './tools/headings.ts';

export default defineConfig({
  version: 2,
  plugins: [headings],
  files: {
    'CLAUDE.md': {
      dependencies: ['src/**', { path: 'docs/guide.md', select: 'Install' }],
    },
  },
});
```

The same entry fits in one string: `'docs/guide.md:Install'`. What follows the first `:` is the
plugin's own text: with a `parseSelect` (below) the plugin turns it into the `select`, as the
Markdown plugin does for `'docs/guide.md:## Install'`; without one it is the `select` as a String.
Reports print the string as written (`docs/guide.md:Install`), where a map entry is printed in the
canonical form of the output below ([SPEC §14.2](/spec/output#142-paths-and-patterns-in-text)).

Editing another section of `docs/guide.md` leaves `CLAUDE.md` `ok`; editing `Install` makes it stale,
and the report names the part that changed:

```console
$ docstamp
STALE    CLAUDE.md  (content-changed)
  fragment  "docs/guide.md#\"Install\""  (changed)  section "Install" (level 2) (lines 3-6)
  review: git diff -M <commit> -- docs/guide.md
0 ok, 1 stale, 0 invalid
```

`plugins` is a key of a script configuration only, not of `docstamp.yaml` or an inline block, so a
YAML-only or frontmatter-only repository needs a `docstamp.config.ts` with `defineConfig` and the plugin
imported, as above, to use a plugin ([SPEC §9.5](/spec/configuration-file#95-script-carriers)).

## Ready-made plugins

Three plugins live in this repository, and docstamp itself ships only the JSON and YAML plugins
described in [Declare dependencies](/guide/declare#depend-on-one-value-of-a-json-or-yaml-file):

- [Markdown plugin](/plugins/markdown): a section of a Markdown file, by its heading
  ([specification](/plugins/markdown-spec)).
- [JavaScript plugin](/plugins/js): a top-level declaration of a JavaScript or TypeScript file, by
  its name ([specification](/plugins/js-spec)).
- [AsciiDoc plugin](/plugins/asciidoc): a section of an AsciiDoc file, by its title or its anchor
  ([specification](/plugins/asciidoc-spec)).

## Write your own

A plugin is an object with a `name`, `apiVersion: 1`, the `files` patterns it handles, and a
synchronous `extract({ path, text, select })` that returns `{ parts, diagnostics }`. A part is
`{ content, focus?, lines? }`: docstamp hashes `content`, and the report prints `focus` and `lines`
so a reviewer knows where to look. A diagnostic with severity `error` makes the file `invalid`. A diagnostic may carry a `code` (`a-z`, `0-9` and `-`, from a letter, up to 64 characters),
a stable identifier such as `heading-not-found`: it is printed after the message and is the
`pluginCode` of `--json`, and changes no state, hash or exit code.

A plugin may also have a synchronous `validateSelect(select)` that returns `{ diagnostics }` of
errors only. docstamp calls it when the configuration loads, so a malformed selector is reported as
`E_SELECT` for the file and pattern before any file is read. It must not read the file; a plugin
without it behaves as before.

A plugin defines its own `select` format, as an ESLint rule defines its options; docstamp checks
only the shape. Two optional members say so:

```ts
const plugin = {
  name: 'headings',
  apiVersion: 1,
  files: ['**/*.md'],
  meta: {
    schema: {
      type: ['string', 'object'],
      required: ['heading'],
      properties: { heading: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 6 } },
      additionalProperties: false,
    },
  },
  parseSelect: (raw) => {
    const marker = /^(#{1,6}) (.+)$/u.exec(raw);
    return marker ? { select: { heading: marker[2], level: marker[1].length } } : { select: raw };
  },
  extract,
};
```

- `meta.schema` is a small subset of JSON Schema. docstamp checks every `select` against it before
  `validateSelect` and `extract`, and a failure is an `E_SELECT` naming the JSON Pointer of the first
  problem. A schema that uses anything outside the subset makes the plugin invalid (`E_PLUGIN`).
- `parseSelect(raw)` is synchronous, pure and deterministic. docstamp calls it only for the
  `path:selector` string, with the text after the first `:`, and takes `{ select }` or
  `{ diagnostics }` back (errors may carry a `code`). The parsed value is what is hashed, so the
  shorthand and the written form of the same `select` share one Dependency Hash. A plugin without
  it gets the text as a String.

Both are optional and additive, so `apiVersion` stays 1. The exact subset and the order in which
failures are reported are [SPEC §8.7](/spec/patterns#87-selected-dependencies).

A plugin runs in your process, so determinism is its author's duty: keep it independent of the
clock, the network and the environment. The contract, with every error case, is
[SPEC §8.7](/spec/patterns#87-selected-dependencies).
