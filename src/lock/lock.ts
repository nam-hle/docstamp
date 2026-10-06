import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStrictYaml, type YamlMap, type YamlValue } from '../config/yaml-profile.ts';
import { Raised, diag } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import { quote } from '../core/quote.ts';
import { isRepoPath } from '../core/repo-path.ts';
import type { Lock, LockEntry } from '../core/types.ts';

const LOCK = 'docsync.lock';
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

function readEntry(info: YamlMap): LockEntry {
  const covers = info.entries.get('covers')?.value;
  const hashNode = info.entries.get('hash');
  const hash = hashNode?.plainSource ?? hashNode?.value;
  const validCovers =
    Array.isArray(covers) && covers.length > 0 && covers.every((c) => typeof c === 'string');
  if (!validCovers || typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) {
    throw fail('E_LOCK');
  }
  return { covers: covers as string[], hash };
}

// SPEC §11.1
export function readLock(root: string): Lock {
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

// SPEC §11.1 steps 2 to 5
export function parseLock(bytes: Buffer): Lock {
  const doc = parseStrictYaml(decode(bytes));
  if (!doc || !isMap(doc.value)) throw fail('E_LOCK');
  const top = doc.value;
  if (top.entries.get('version')?.plainSource !== '1') throw fail('E_LOCK_VERSION');
  const dependents = top.entries.get('dependents')?.value;
  if (!hasKeys(top, ['dependents', 'version']) || !isMap(dependents)) throw fail('E_LOCK');
  const entries = new Map<string, LockEntry>();
  for (const [dependent, info] of dependents.entries) {
    if (!isRepoPath(dependent) || !isMap(info.value) || !hasKeys(info.value, ['covers', 'hash'])) {
      throw fail('E_LOCK');
    }
    entries.set(dependent, readEntry(info.value));
  }
  return { entries };
}

// SPEC §11.2
export function lockText(lock: Lock): string {
  if (lock.entries.size === 0) return 'version: 1\ndependents: {}\n';
  let out = 'version: 1\ndependents:\n';
  for (const dependent of sortPaths([...lock.entries.keys()])) {
    const entry = lock.entries.get(dependent)!;
    out += `  ${quote(dependent)}:\n    covers:\n`;
    for (const pattern of entry.covers) out += `      - ${quote(pattern)}\n`;
    out += `    hash: ${entry.hash}\n`;
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
        message: 'Cannot write docsync.lock; fix the permissions or remove the obstruction.',
      }),
    ]);
  }
  return true;
}
