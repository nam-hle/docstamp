$ docstamp suggest --json README.md --root <root>
exit: 0
--- stdout ---
{
  "version": 2,
  "mode": "suggest",
  "exitCode": 0,
  "files": [
    {
      "file": "README.md",
      "suggestions": [
        {
          "pattern": "docs/guide",
          "resolvedCount": 1,
          "staleRate": null,
          "status": null
        }
      ],
      "ignored": [],
      "declared": null,
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
--- stderr ---
