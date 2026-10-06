import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import { comparePaths } from '../core/order.ts';
import { isRepoPath } from '../core/repo-path.ts';
import type { Binding, Config, Diagnostic } from '../core/types.ts';
import { parsePattern } from '../pattern/parse.ts';
import {
  parseStrictYaml,
  type YamlMap,
  type YamlNodeInfo,
  type YamlValue,
} from './yaml-profile.ts';

const TOP_KEYS = ['version', 'gitignore', 'ignore', 'dependents'];

const isMap = (v: YamlValue | undefined): v is YamlMap =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: YamlValue | undefined): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

function readText(root: string): string {
  const path = join(root, 'docstamp.yaml');
  let bytes: Buffer;
  try {
    if (!lstatSync(path).isFile()) throw new Error('not a file');
    bytes = readFileSync(path);
  } catch {
    throw new Raised([diag('E_CONFIG_MISSING')]);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Raised([diag('E_CONFIG')]);
  }
}

function collectBinding(
  key: string,
  info: YamlNodeInfo,
  fatal: Diagnostic[],
  attached: Diagnostic[],
  out: Binding[],
): void {
  if (!isRepoPath(key)) {
    fatal.push(diag('E_CONFIG', { subject: key }));
    return;
  }
  const value = info.value;
  const covers = isMap(value) ? value.entries.get('covers')?.value : undefined;
  if (!isMap(value) || !isStrings(covers) || covers.length === 0) {
    fatal.push(diag('E_CONFIG', { dependent: key }));
    return;
  }
  for (const k of value.entries.keys()) {
    if (k !== 'covers') fatal.push(diag('E_UNKNOWN_KEY', { dependent: key, subject: k }));
  }
  for (const pattern of covers) {
    if (!parsePattern(pattern)) {
      attached.push(diag('E_PATTERN', { dependent: key, subject: pattern }));
    }
  }
  out.push({ dependent: key, covers });
}

// SPEC §9.3
export function readConfig(root: string): { config: Config; attached: Diagnostic[] } {
  const doc = parseStrictYaml(readText(root));
  if (!doc || !isMap(doc.value)) throw new Raised([diag('E_CONFIG')]);
  const top = doc.value.entries;
  if (top.get('version')?.plainSource !== '1') throw new Raised([diag('E_CONFIG_VERSION')]);

  const fatal: Diagnostic[] = [];
  const attached: Diagnostic[] = [];
  for (const key of top.keys()) {
    if (!TOP_KEYS.includes(key)) fatal.push(diag('E_UNKNOWN_KEY', { subject: key }));
  }
  const gitignore = top.get('gitignore')?.value;
  if (gitignore !== undefined && typeof gitignore !== 'boolean') {
    fatal.push(diag('E_CONFIG', { subject: 'gitignore' }));
  }
  const ignore = top.get('ignore')?.value;
  if (ignore !== undefined && !isStrings(ignore)) {
    fatal.push(diag('E_CONFIG', { subject: 'ignore' }));
  }

  const bindings: Binding[] = [];
  const dependents = top.get('dependents')?.value;
  if (!isMap(dependents)) {
    fatal.push(diag('E_CONFIG', { subject: 'dependents' }));
  } else {
    for (const [key, info] of dependents.entries) {
      collectBinding(key, info, fatal, attached, bindings);
    }
  }
  if (fatal.length > 0) throw new Raised(fatal);
  bindings.sort((a, b) => comparePaths(a.dependent, b.dependent));
  return {
    config: {
      ignore: isStrings(ignore) ? ignore : [],
      useGitignore: gitignore !== false,
      bindings,
    },
    attached,
  };
}
