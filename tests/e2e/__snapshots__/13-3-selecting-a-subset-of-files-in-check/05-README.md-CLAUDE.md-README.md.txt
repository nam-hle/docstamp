$ docstamp README.md CLAUDE.md README.md
exit: 1
--- stdout ---
STALE    CLAUDE.md  (content-changed)
  depends   src/**
  depends   !src/**/*.test.ts
STALE    README.md  (content-changed)
  depends   src/index.ts
  depends   docs/guide.md
0 ok, 2 stale, 0 invalid
next: review each stale file against its dependencies, then run: docstamp update CLAUDE.md README.md
--- stderr ---
