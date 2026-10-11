## 1 Scope

docstamp tracks hidden dependencies between files: a file whose correctness
rests on the content of other files (its *dependencies*). The primary case is documentation that
describes code, but any file may have dependencies and any file in the Universe may be one: a
fixture and the schema it mirrors, generated types and their source, a translation and its
original.

The workflow it serves:

1. CI runs `docstamp`. It exits 1 when a file's dependencies changed since its last Review.
2. A person or an agent reviews each stale file against its dependencies and edits it if
   needed.
3. They run `docstamp update <file>` to record the Review in the Lockfile. CI passes.

A file declares its dependencies in the Configuration file, or inline, in a `docstamp` block in
the frontmatter of a Markdown file (§5.6, §9.6). Both kinds of file are evaluated alike.

This specification defines how a Root is determined (§6), the Universe (§7), patterns (§8), the
Configuration file (§9), hashing (§10), the Lockfile (§11), evaluation (§12), the command line
(§13), output (§14), diagnostics (§15), exit codes (§16) and compatibility (§17).
