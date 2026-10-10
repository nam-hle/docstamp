$ docstamp update --json README.md
exit: 0
--- stdout ---
{
  "version": 2,
  "mode": "update",
  "exitCode": 0,
  "summary": {
    "ok": 1,
    "stale": 0,
    "invalid": 0
  },
  "files": [
    {
      "file": "README.md",
      "state": "ok",
      "reasons": [],
      "dependencies": [
        "src/index.ts",
        "docs/guide.md"
      ],
      "changes": null,
      "diagnostics": [],
      "written": false
    }
  ],
  "diagnostics": [],
  "removed": []
}
--- stderr ---
