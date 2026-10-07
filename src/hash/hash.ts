import { createHash } from 'node:crypto';
import { readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import type { Universe } from '../universe/walk.ts';

// SPEC §10.3
const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// SPEC §10.1
function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8192).includes(0);
}

function crlfToLf(bytes: Buffer): Buffer {
  const out = Buffer.alloc(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    out[length++] = bytes[i]!;
  }
  return out.subarray(0, length);
}

// SPEC §10.2
export function normalizedContent(root: string, u: Universe, path: string): Buffer {
  const abs = join(root, u.onDisk.get(path) ?? path);
  try {
    if (u.kinds.get(path) === 'link') {
      const target = readlinkSync(abs, 'utf8').replaceAll('\\', '/');
      return Buffer.concat([Buffer.from('link\u0000'), Buffer.from(target, 'utf8')]);
    }
    const bytes = readFileSync(abs);
    return Buffer.concat([Buffer.from('file\u0000'), isBinary(bytes) ? bytes : crlfToLf(bytes)]);
  } catch {
    throw new Raised([diag('E_UNREADABLE', { subject: path })]);
  }
}

// SPEC §10.3
export function fileHash(root: string, u: Universe, path: string): string {
  return sha256Hex(normalizedContent(root, u, path));
}

// SPEC §10.4 (pure part: input already hashed)
export function dependencyHashFrom(entries: ReadonlyArray<[string, string]>): string {
  const parts = entries.map(([path, hash]) => `${path}\u0000${hash}\n`);
  return sha256Hex(Buffer.from(parts.join(''), 'utf8'));
}
