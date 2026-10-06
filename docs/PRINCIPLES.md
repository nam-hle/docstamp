# Principles

The constitution of this tool; every change, an agent's most of all, is bound by it. A principle
that has to bend is named in the commit message. Each reads _prefer X over Y_.

1. **Agent as primary user**: a report an agent can act on over prose a person skims. The agent
   is usually the one reading `check` output and doing the review; the human gets the same truth.
2. **Deterministic over clever**: the same tree gives the same verdict and the same bytes, on any
   machine, every run. No LLM, no network, no clock, no git history, no locale in any result.
3. **Content over history**: what a file contains now, never how it got there. Rebase, squash and
   cherry-pick cannot change a verdict.
4. **Precise over noisy**: a false stale costs more trust than it saves. Flag only what a binding
   covers, and only when its content changed.
5. **Doable output over prose**: data on stdout, messages on stderr, every finding names the
   command that resolves it. A missing input fails rather than prompts.
6. **Explicit over implicit**: stated defaults, refusal over guesswork. A pattern that matches
   nothing, an unknown key, a doc declared twice: each is an error, never ignored.
7. **Verified over claimed**: the whole gate, and what was not checked is said. A Write means a
   review happened; the tool cannot check that, so nothing in it may write the Lockfile on its
   own.
8. **Consistency over local convenience**: one idea, one name, wording, shape and failure; an
   unexplained difference is a defect. `--json` is the same content, machine-formatted.
9. **Non-breaking over breaking**: the lockfile and the JSON output are versioned contracts.
   Added fields over removed or renamed ones; consumers tolerate unknown fields.
10. **The smaller change over the larger**: add over alter, narrow over widen. Few commands, few
    states, few options.
11. **Automation over manual work**: a test or lint over a sentence that asks for it; a
    "never do X" in a doc is a missing check.
12. **One fact, one place over duplicates**: behavior is defined once, in
    [SPEC.md](SPEC.md). Code and tests cite its clause numbers; a copy is pinned by a test or
    removed.
