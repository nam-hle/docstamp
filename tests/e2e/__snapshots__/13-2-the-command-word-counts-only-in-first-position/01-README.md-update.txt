$ docstamp README.md update
exit: 2
--- stdout ---
STALE    README.md  (unrecorded)
  depends   src/index.ts
  depends   docs/guide.md
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update README.md
--- stderr ---
error: E_UNKNOWN_FILE: update: Name a file listed under "files" in the configuration file.
