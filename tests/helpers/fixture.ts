import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type TreeSpec = Record<string, string | { link: string }>;

const created: string[] = [];

export function makeTree(spec: TreeSpec): string {
  const root = mkdtempSync(join(tmpdir(), 'docsync-'));
  created.push(root);
  for (const [rel, value] of Object.entries(spec)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    if (typeof value === 'string') writeFileSync(abs, value);
    else symlinkSync(value.link, abs);
  }
  return root;
}

const restoreDirs = (dir: string): void => {
  if (!lstatSync(dir).isDirectory()) return;
  chmodSync(dir, 0o755);
  for (const name of readdirSync(dir)) restoreDirs(join(dir, name));
};

export function cleanupTrees(): void {
  for (const root of created.splice(0)) {
    restoreDirs(root);
    rmSync(root, { recursive: true, force: true });
  }
}
