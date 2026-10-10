import { join } from 'node:path';
import { parseStrictYaml, type YamlMap, type YamlValue } from '../config/yaml-profile.ts';
import { Raised, diag } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import { quote } from '../core/quote.ts';
import { isRepoPath } from '../core/repo-path.ts';
import type { Lock } from '../core/types.ts';
import type { Host } from '../host/fs.ts';

const LOCK = 'docstamp-lock.yaml';
// Historical name from before the rename to docstamp; kept on purpose (§11.1).
const LEGACY_LOCK = 'docsync.lock';
const V2_LOCK_MESSAGE =
  'The version 2 Lockfile is no longer read; run "docstamp update --all" to rewrite it as ' +
  'version 3 (hashes are unchanged).';
const fail = (code: 'E_LOCK' | 'E_LOCK_VERSION') => new Raised([diag(code)]);
const isMap = (v: YamlValue | undefined): v is YamlMap =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const hasKeys = (map: YamlMap, keys: string[]): boolean => {
  const actual = [...map.entries.keys()].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
};

function decode(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw fail('E_LOCK');
  }
}

// SPEC §11.1 step 1
function rejectLegacyLock(host: Host, root: string): void {
  if (host.fs.kind(join(root, LEGACY_LOCK)) === null) return;
  throw new Raised([
    diag('E_LOCK_VERSION', {
      subject: LEGACY_LOCK,
      message:
        'The version 1 Lockfile docsync.lock is no longer read; delete docsync.lock, ' +
        'review every file, then run "docstamp update --all".',
    }),
  ]);
}

// SPEC §11.1
export function readLock(host: Host, root: string): Lock {
  rejectLegacyLock(host, root);
  const path = join(root, LOCK);
  if (host.fs.kind(path) === null) return { entries: new Map() };
  let bytes: Buffer;
  try {
    bytes = host.fs.readFile(path);
  } catch {
    throw fail('E_LOCK');
  }
  return parseLock(bytes);
}

// SPEC §11.1 steps 3 to 6
export function parseLock(bytes: Buffer): Lock {
  const doc = parseStrictYaml(decode(bytes));
  if (!doc || !isMap(doc.value)) throw fail('E_LOCK');
  const top = doc.value;
  const version = top.entries.get('version')?.plainSource;
  if (version === '2') {
    throw new Raised([diag('E_LOCK_VERSION', { message: V2_LOCK_MESSAGE })]);
  }
  if (version !== '3') throw fail('E_LOCK_VERSION');
  const files = top.entries.get('files')?.value;
  if (!hasKeys(top, ['files', 'version']) || !isMap(files)) throw fail('E_LOCK');
  const entries = new Map<string, string>();
  for (const [file, node] of files.entries) {
    const hash = node.plainSource ?? node.value;
    if (!isRepoPath(file) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) {
      throw fail('E_LOCK');
    }
    entries.set(file, hash);
  }
  return { entries };
}

// SPEC §11.2
export function lockText(lock: Lock): string {
  if (lock.entries.size === 0) return 'version: 3\nfiles: {}\n';
  let out = 'version: 3\nfiles:\n';
  for (const file of sortPaths([...lock.entries.keys()])) {
    out += `  ${quote(file)}: ${lock.entries.get(file)}\n`;
  }
  return out;
}

export const lockExists = (host: Host, root: string): boolean =>
  host.fs.kind(join(root, LOCK)) !== null;

// SPEC §11.3
export function writeLock(host: Host, root: string, lock: Lock): boolean {
  const path = join(root, LOCK);
  const text = lockText(lock);
  try {
    if (host.fs.kind(path) !== null) {
      const current = host.fs.readFile(path).toString('latin1').replaceAll('\r\n', '\n');
      if (current === Buffer.from(text, 'utf8').toString('latin1')) return false;
    }
    host.fs.writeAtomic(path, text);
  } catch {
    throw new Raised([
      diag('E_UNREADABLE', {
        subject: LOCK,
        message: `Cannot write ${LOCK}; fix the permissions or remove the obstruction.`,
      }),
    ]);
  }
  return true;
}
