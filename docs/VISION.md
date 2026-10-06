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

## What docsync is

**A deterministic snapshot gate between files and the files that depend on them**, built first
for docs and the code they describe.

Each doc declares which code it covers. `docsync stamp` records a content hash of every covered
file. `docsync check` recomputes them and fails CI when a doc's covered code changed since its
last review, listing exactly which files were modified, added or removed.

The review itself is not docsync's job. An agent (or a person) reads the report, re-checks the
doc against the changed files, edits it if needed, and stamps it again. docsync decides *when* a
review is due and *what* it must look at; it never decides whether the doc is right.

## Beyond docs

Docs are the main case, not the only one. The same problem appears wherever one file silently
depends on another and nothing links them: a test fixture and the schema it mirrors, a
translation and its source text, a hand-written type and the API it describes, a runbook and the
deploy script. docsync treats any file in the repository (the same scope git sees) as a possible
*Dependent* and any file as something it may cover. Markdown declares its links in frontmatter;
every other file declares them in `docsync.yaml`.

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
- **TypeScript symbols** (`src/api.ts#createUser`), hashed by public shape, so an internal
  refactor does not ask for a doc review.
- **Structured paths** (`package.json#scripts`) and **Markdown headings** as targets.
- **A public extractor API** for other languages, once two or three built-in ones show its shape.

## What it will not become

- **An LLM wrapper.** No model call inside the tool, ever. Agents call docsync, not the reverse.
- **A doc generator.** It says a doc may be stale; it does not write the doc.
- **A git tool.** Verdicts come from file content alone, so history rewrites cannot affect them.
