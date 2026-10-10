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
        "content-changed"
      ],
      "dependencies": [
        "src/index.ts",
        "docs/guide.md"
      ],
      "changes": null,
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
--- stderr ---
