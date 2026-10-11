## 2 Conformance

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in
RFC 2119.

For the same Root contents and the same command line, a conforming implementation MUST produce
the same exit code, byte-identical Lockfile contents, and byte-identical standard output, on any
host operating system, locale, time zone, wall-clock time and version-control history. The only
permitted variations are:

- the text of a Diagnostic's `[[Message]]` (§5.5), which is informative;
- the output of `--version`, `--help` and `help` (§13.11);
- color escape sequences (§14.1);
- the choice of Root by the upward search of §6, which `--root` removes;
- Unicode normalization (§7.4) and case mapping (§7.5) of code points that are unassigned in the
  Unicode version of the implementation's runtime;
- the changed-file report (`[[Changes]]`, §5.4), which depends on the repository history available
  on the host, for example a shallow clone against a full clone;
- the output of `stats` (§13.9), which depends on the repository history and, for `--since`, on the
  wall-clock time;
- the `staleRate` of `suggest` (§13.10), which depends on the repository history and the wall-clock
  time, and is *none* when the history cannot answer.

A conforming implementation MUST NOT perform network access. It MAY invoke `git`, read-only, only
to compute the changed-file report (§12.3), the replay of `stats` and `suggest` (§12.4) and the
renamed path named in the `[[Message]]` of `E_EMPTY_PATTERN` (§12.7). The
verdict (states and reasons), the Lockfile and the exit code of every command MUST NOT depend on
`git`, except that `stats` fails with exit 2 when the history it needs is missing (§12.4); `suggest`
never fails for want of history. `stats` and `suggest` are the only places that read the wall-clock
time: `stats` only for `--since`, `suggest` for its fixed window of 30 days.
