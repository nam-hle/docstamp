$ docstamp README.md
exit: 1
--- stdout ---
STALE    README.md  (unrecorded)
  depends   src/cli
  depends   !**/*.test.ts (preset tests)
  depends   !**/__test__/** (preset tests)
  depends   docs/SPEC.md (preset spec)
0 ok, 1 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update README.md
  run update only after the review, never --all just to pass; see docstamp help agents
--- stderr ---
