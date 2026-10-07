import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStrictYaml, type YamlMap, type YamlValue } from '../config/yaml-profile.ts';
import { Raised, diag } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import { quote } from '../core/quote.ts';
import { isRepoPath } from '../core/repo-path.ts';
import type { Lock } from '../core/types.ts';

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
function rejectLegacyLock(root: string): void {
  if (!existsSync(join(root, LEGACY_LOCK))) return;
  throw new Raised([
    diag('E_LOCK_VERSION', {
      subject: LEGACY_LOCK,
      message:
        'The version 1 Lockfile docsync.lock is no longer read; delete docsync.lock, ' +
        'review every Dependent, then run "docstamp update --all".',
    }),
  ]);
}

// SPEC §11.1
export function readLock(root: string): Lock {
  rejectLegacyLock(root);
  const path = join(root, LOCK);
  if (!existsSync(path)) return { entries: new Map() };
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
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
  for (const [dependent, node] of files.entries) {
    const hash = node.plainSource ?? node.value;
    if (!isRepoPath(dependent) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) {
      throw fail('E_LOCK');
    }
    entries.set(dependent, hash);
  }
  return { entries };
}

// SPEC §11.2
export function lockText(lock: Lock): string {
  if (lock.entries.size === 0) return 'version: 3\nfiles: {}\n';
  let out = 'version: 3\nfiles:\n';
  for (const dependent of sortPaths([...lock.entries.keys()])) {
    out += `  ${quote(dependent)}: ${lock.entries.get(dependent)}\n`;
  }
  return out;
}

// SPEC §11.3
export function writeLock(root: string, lock: Lock): boolean {
  const path = join(root, LOCK);
  const text = lockText(lock);
  const temp = `${path}.tmp-${process.pid}`;
  try {
    if (existsSync(path)) {
      const current = readFileSync(path).toString('latin1').replaceAll('\r\n', '\n');
      if (current === Buffer.from(text, 'utf8').toString('latin1')) return false;
    }
    writeFileSync(temp, text, 'utf8');
    renameSync(temp, path);
  } catch {
    rmSync(temp, { force: true });
    throw new Raised([
      diag('E_UNREADABLE', {
        subject: LOCK,
        message: `Cannot write ${LOCK}; fix the permissions or remove the obstruction.`,
      }),
    ]);
  }
  return true;
}
