$ docstamp list-dependencies --json README.md
exit: 0
--- stdout ---
{
  "version": 2,
  "mode": "list-dependencies",
  "exitCode": 0,
  "files": [
    {
      "file": "README.md",
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
      "resolvedFiles": [
        "docs/SPEC.md",
        "src/cli/run.ts"
      ],
      "diagnostics": []
    }
  ],
  "diagnostics": []
}
--- stderr ---
