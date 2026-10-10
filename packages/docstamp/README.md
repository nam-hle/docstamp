# docstamp

A deterministic snapshot gate for hidden links between files. A file declares the files it
depends on; `docstamp` fails when they changed since the file was last reviewed, and
`docstamp update <file>` records the review. No LLM, no network, no clock.

```sh
pnpm add -D docstamp
pnpm exec docstamp
```

- Documentation, examples and the full command reference: the
  [repository README](https://github.com/nam-hle/docstamp#readme).
- The contract (formats, algorithms, output, exit codes):
  [`docs/SPEC.md`](docs/SPEC.md), shipped in this package.
- Configuration schemas: `docstamp/schema.json` and `docstamp/schema-frontmatter.json`.
