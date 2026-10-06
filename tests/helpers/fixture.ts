import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type TreeSpec = Record<string, string | { link: string }>;

export function makeTree(spec: TreeSpec): string {
  const root = mkdtempSync(join(tmpdir(), 'docsync-'));
  for (const [rel, value] of Object.entries(spec)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    if (typeof value === 'string') writeFileSync(abs, value);
    else symlinkSync(value.link, abs);
  }
  return root;
}
