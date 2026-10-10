# Vision

> **Draft.** Meant to be argued with; correct it where it guesses wrong.

## The problem

Code changes every day. The docs that describe it, and the context files coding agents load
(`CLAUDE.md`, `AGENTS.md`, `README.md`), change when someone remembers. Nobody remembers. An
agent then works from instructions that were true three months ago, and nothing tells it so.

The tools that try to fix this fall in two groups. Some ask an LLM whether the docs still match
the code: expensive on every run, different answers on different runs, and false alarms that
teach people to ignore it. Others track at the level of "something in the repo changed", too
coarse to say which doc needs a look.

## What docstamp is

**A deterministic snapshot gate between files and the files that depend on them**, built first
for docs and the code they describe.

Each doc declares which code it depends on. `docstamp update` records one hash over the paths and
contents of every dependency. `docstamp` recomputes it and fails CI when a doc's dependencies
changed since its last review (an edit, a new file, a deletion, a rename), naming the doc
and the patterns to look at. The lock stays one line per doc however many dependencies it has.

The review itself is not docstamp's job. An agent (or a person) reads the report, re-checks the
doc against the changed files, edits it if needed, and writes it again. docstamp decides *when* a
review is due and *what* it must look at; it never decides whether the doc is right.

## Beyond docs

Docs are the main case, not the only one. The same problem appears wherever one file silently
depends on another and nothing links them: a test fixture and the schema it mirrors, a
translation and its source text, a hand-written type and the API it describes, a runbook and the
deploy script. docstamp treats any file in the repository (the same scope git sees) as a possible
file with dependencies, and any file as a dependency. A link is declared in the configuration file
(`docstamp.yaml` or a `docstamp.config.*` script), which works for any file because the file
itself carries no marker. A Markdown doc may instead declare its own links in its frontmatter,
so a repository of docs needs no configuration file and no lock, and the declaration travels
with the doc when it moves.

## Who it is for

- **Teams whose agents read repo docs as context**, where a stale `CLAUDE.md` silently makes
  every session worse.
- **Projects with architecture and how-to docs** that rot unnoticed.
- **CI pipelines** that want a cheap, reproducible gate: zero tokens when nothing drifted.

## The bet

**Drift detection should be boring and exact; judgment should be scoped.** A hash comparison
costs nothing and never lies about whether content changed. An LLM is good at judging whether a
doc is still true, and becomes cheap and reliable when it is handed one doc and the handful of
files that changed, instead of the whole repo and a vague question.

## Where it goes

Roughly in order of how settled each is:

- **Files, folders and globs** as targets: the proof of concept.
- **Parts of a file, through plugins.** A plugin per format hashes a part of a file (a Markdown
  heading, a TypeScript symbol by its public shape, a key of `package.json`), so an unrelated
  edit or an internal refactor does not ask for a doc review. The plugin defines what a selector
  means; docstamp only compares the hashes it returns. Shipped so far: the plugin API, and a
  Markdown plugin (sections by heading) in its own package, not published yet.
- **More first-party plugins** as separate packages (JavaScript and TypeScript next, by declaration
  kind and name), once the API has met a few real plugins.

## What it will not become

- **An LLM wrapper.** No model call inside the tool, ever. Agents call docstamp, not the reverse.
- **A doc generator.** It says a doc may be stale; it does not write the doc.
- **A git tool.** Verdicts come from file content alone, so history rewrites cannot affect them.
