$ docstamp ../b/README.md
cwd: packages/a
exit: 1
--- stdout ---
STALE    packages/b/README.md  (unrecorded)
  depends   packages/b/src/**
  depends   packages/a/src/index.ts
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update ../../packages/b/README.md
  run update only after the review, never --all just to pass; see docstamp help agents
--- stderr ---
