# README moved under docs
$ docstamp --json
exit: 0
--- stdout ---
{
  "version": 2,
  "mode": "check",
  "exitCode": 0,
  "summary": {
    "ok": 2,
    "stale": 0,
    "invalid": 0
  },
  "files": [
    {
      "file": "docs/GUIDE.md",
      "state": "ok",
      "reasons": [],
      "dependencies": [
        "src/core"
      ],
      "changes": null,
      "diagnostics": []
    },
    {
      "file": "docs/OVERVIEW.md",
      "state": "ok",
      "reasons": [],
      "dependencies": [
        "src/cli",
        "docs/GUIDE.md"
      ],
      "changes": null,
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
--- stderr ---
