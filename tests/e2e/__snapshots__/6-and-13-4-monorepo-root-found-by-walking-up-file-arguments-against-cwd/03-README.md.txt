$ docstamp README.md
cwd: packages/a
exit: 1
--- stdout ---
STALE    packages/a/README.md  (unrecorded)
  depends   packages/a/src/**
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update packages/a/README.md
--- stderr ---
