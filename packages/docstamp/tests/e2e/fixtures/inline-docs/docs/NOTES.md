---
defaults: &defaults
  retries: 3
job:
  <<: *defaults
  name: nightly
---

Notes with frontmatter that uses YAML anchors and merge keys, and no docstamp block.
