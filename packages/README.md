# packages

Workspace packages published from this repository, one folder per package, each with its own
`package.json`, `src/` and `tests/`. `pnpm-workspace.yaml` lists `packages/*`.

- [`docstamp`](docstamp): the command and the library.
- [`docstamp-plugin-markdown`](docstamp-plugin-markdown): select a section of a Markdown file by
  its heading.
- [`docstamp-plugin-js`](docstamp-plugin-js): select a top-level declaration of a JavaScript or
  TypeScript file by its name. Each plugin has a `SPEC.md` for its selectors and what it hashes; the plugin
  interface itself is [SPEC §8.7](docstamp/docs/SPEC.md#87-selected-dependencies).
