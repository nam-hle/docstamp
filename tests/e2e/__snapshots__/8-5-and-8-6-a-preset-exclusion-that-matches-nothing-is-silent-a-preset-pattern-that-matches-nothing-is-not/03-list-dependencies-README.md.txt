$ docstamp list-dependencies README.md
exit: 2
--- stdout ---
README.md
--- stderr ---
error: E_EMPTY_PATTERN: README.md: docs/MISSING.md: Correct or remove the pattern; it matches no file. It comes from the preset "spec".
--- setup: docstamp.yaml ---
version: 2
presets:
  tests:
    - "!**/*.test.ts"
    - "!**/__test__/**"
  spec:
    - docs/MISSING.md
files:
  CLAUDE.md:
    dependencies:
      - src
    use:
      - tests
