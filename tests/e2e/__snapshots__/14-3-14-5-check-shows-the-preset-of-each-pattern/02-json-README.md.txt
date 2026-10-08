$ docstamp --json README.md
exit: 1
--- stdout ---
{
  "version": 2,
  "mode": "check",
  "exitCode": 1,
  "summary": {
    "ok": 0,
    "stale": 1,
    "invalid": 0
  },
  "files": [
    {
      "file": "README.md",
      "state": "stale",
      "reasons": [
        "unrecorded"
      ],
      "dependencies": [
        "src/cli",
        "!**/*.test.ts",
        "!**/__test__/**",
        "docs/SPEC.md"
      ],
      "use": [
        "tests",
        "spec"
      ],
      "origins": [
        null,
        "tests",
        "tests",
        "spec"
      ],
      "changes": null,
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
--- stderr ---
