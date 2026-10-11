## 16 Exit Codes

| Code | Meaning |
|---|---|
| 0 | check: every selected file is `ok`; update: the Lockfile was written or already current; list-dependencies, list-dependents: the answer was listed; stats: the statistics were listed; suggest: the proposal was listed, even when it is empty; help, version |
| 1 | check only: a selected file is `stale`, none is `invalid`, no global error |
| 2 | an error Diagnostic, an `invalid` file, or a usage error |
| 70 | an uncaught internal fault of the runtime, reported on standard error as `internal error: ` and the stack; for example a failed write to standard output. No input produces it: every failure caused by the command line, the Root or the file system is a Diagnostic and exit 2 |

Warnings never affect the exit code.
