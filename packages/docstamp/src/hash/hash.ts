import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import type { Host } from '../host/fs.ts';
import type { Universe } from '../universe/walk.ts';

// SPEC §10.3
const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// SPEC §10.1
export function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8192).includes(0);
}

// SPEC §10.2 step 4: bytes map one to one to latin1 code points, so lines survive the round trip
function withoutLines(body: Buffer, indexes: readonly number[]): Buffer {
  const dropped = new Set(indexes);
  const kept = body
    .toString('latin1')
    .split(/(?<=\n)/u)
    .filter((_, index) => !dropped.has(index));
  return Buffer.from(kept.join(''), 'latin1');
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

// SPEC §10.2, §9.6.3
export function normalizedContent(host: Host, root: string, u: Universe, path: string): Buffer {
  const abs = join(root, u.onDisk.get(path) ?? path);
  try {
    if (u.kinds.get(path) === 'link') {
      const target = host.fs.readLink(abs).replaceAll('\\', '/');
      return Buffer.concat([Buffer.from('link\u0000'), Buffer.from(target, 'utf8')]);
    }
    const bytes = host.fs.readFile(abs);
    if (isBinary(bytes)) return Buffer.concat([Buffer.from('file\u0000'), bytes]);
    const body = crlfToLf(bytes);
    const hashLines = u.marked?.get(path);
    const kept = hashLines === undefined ? body : withoutLines(body, hashLines);
    return Buffer.concat([Buffer.from('file\u0000'), kept]);
  } catch {
    throw new Raised([diag('E_UNREADABLE', { subject: path })]);
  }
}

const FILE_TAG = Buffer.from('file\u0000');

// SPEC §8.7: the text a Plugin sees is the normalized content of §10.2 as UTF-8
export function selectableText(host: Host, root: string, u: Universe, path: string): string {
  const content = normalizedContent(host, root, u, path);
  const fail = (why: string) =>
    new Raised([
      diag('E_SELECT', {
        subject: path,
        message: `The file is ${why}; a plugin reads only text.`,
      }),
    ]);
  if (!content.subarray(0, FILE_TAG.length).equals(FILE_TAG)) throw fail('a link');
  const body = content.subarray(FILE_TAG.length);
  if (isBinary(body)) throw fail('binary');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    throw fail('not valid UTF-8');
  }
}

// SPEC §10.3
export function fileHash(host: Host, root: string, u: Universe, path: string): string {
  return sha256Hex(normalizedContent(host, root, u, path));
}

export interface Fragment {
  readonly path: string;
  readonly select: string;
  readonly hashes: readonly string[];
}

// SPEC §10.4 step 3: one section per Selected Dependency, only when there is one
const fragmentSection = (fragment: Fragment): string => {
  const head = `select\u0000${fragment.path}\u0000${fragment.select}\u0000${fragment.hashes.length}\n`;
  const body = fragment.hashes.map((hash) => `${Buffer.byteLength(hash, 'utf8')}\u0000${hash}\n`);
  return head + body.join('');
};

// SPEC §10.4 (pure part: input already hashed)
export function dependencyHashFrom(
  entries: ReadonlyArray<[string, string]>,
  fragments: readonly Fragment[] = [],
): string {
  const parts = entries.map(([path, hash]) => `${path}\u0000${hash}\n`);
  return sha256Hex(Buffer.from(parts.join('') + fragments.map(fragmentSection).join(''), 'utf8'));
}
