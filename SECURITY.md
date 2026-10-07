# Security policy

## Supported versions

Only the latest minor release receives security fixes.

## Reporting a vulnerability

Report privately through GitHub: open the repository's **Security** tab, choose **Report a vulnerability**, and describe the issue with steps to reproduce. Please do not open a public issue or pull request for a vulnerability.

I will acknowledge a report and keep you informed as it is investigated. This is a volunteer-maintained project, so no response or fix times are promised.

## Scope

In scope:

- **Path handling.** Patterns, file arguments and `--root` that read, hash or write outside the repository root.
- **Symlinks.** Following or hashing links in a way that escapes the root or changes the verdict.
- **Git invocation.** `git` is called only for the advisory changed-file report, with an argument array and no shell. Any way to inject arguments or run something else is a vulnerability.
- **Lock writing.** Any way to make `docstamp update` write outside `docstamp-lock.yaml` or write it without a named request.

Not in scope:

- **Script configuration files.** `docstamp.config.ts`, `.mts`, `.js` and `.mjs` are executed by design, with the privileges of the user running docstamp. Running docstamp on a repository means trusting that repository's configuration file, as with any build tool. Executing a hostile repository's config is not a vulnerability; a way to make docstamp execute code from a file that is not the selected configuration file is.
- Vulnerabilities in dependencies that docstamp's usage does not reach; report those upstream.
