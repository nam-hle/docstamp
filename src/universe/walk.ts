import { lstatSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import { comparePaths } from '../core/order.ts';
import type { Config, Diagnostic } from '../core/types.ts';
import { CONFIG_NAMES } from '../config/value.ts';
import { isIgnored, parseIgnoreLines, type IgnoreRule } from './ignore.ts';

type Kind = 'file' | 'link';
export interface Universe {
  paths: string[];
  kinds: Map<string, Kind>;
  onDisk: Map<string, string>;
  // SPEC §9.6.3: inline files and the lines of their hash keys, set once they are read
  marked?: Map<string, readonly number[]>;
}

const hasEntry = (dir: string, name: string): boolean => {
  try {
    lstatSync(join(dir, name));
    return true;
  } catch {
    return false;
  }
};

const isDirectory = (dir: string): boolean => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

// SPEC §6: the nearest configuration file, else the nearest .git
export function determineRoot(cwd: string, rootOption: string | undefined): string {
  if (rootOption !== undefined) {
    const dir = resolve(cwd, rootOption);
    if (!isDirectory(dir)) throw new Raised([diag('E_ROOT')]);
    return dir;
  }
  const nearest = (found: (dir: string) => boolean): string | null => {
    for (let dir = cwd; ; dir = dirname(dir)) {
      if (found(dir)) return dir;
      if (dirname(dir) === dir) return null;
    }
  };
  const root =
    nearest((dir) => CONFIG_NAMES.some((name) => hasEntry(dir, name))) ??
    nearest((dir) => hasEntry(dir, '.git'));
  if (root === null) throw new Raised([diag('E_CONFIG_MISSING')]);
  return root;
}

const joinPath = (prefix: string, name: string) => (prefix === '' ? name : `${prefix}/${name}`);
const isValidUtf8 = (name: Buffer) => Buffer.from(name.toString('utf8'), 'utf8').equals(name);

// SPEC §7.2, §7.4, §7.5
export function computeUniverse(
  root: string,
  config: Pick<Config, 'ignore' | 'useGitignore'>,
): Universe {
  const errors: Diagnostic[] = [];
  const found: Array<{ path: string; kind: Kind }> = [];
  const configRules = config.ignore.flatMap((line) => parseIgnoreLines(line, ''));
  let rules: IgnoreRule[] = [];

  const walk = (abs: string, prefix: string): void => {
    let entries: Dirent<Buffer>[];
    try {
      entries = readdirSync(abs, { withFileTypes: true, encoding: 'buffer' });
    } catch {
      errors.push(diag('E_UNREADABLE', { subject: prefix }));
      return;
    }
    const before = rules;
    const hasGitignore = entries.some((e) => e.name.toString() === '.gitignore' && e.isFile());
    if (config.useGitignore && hasGitignore) {
      try {
        const text = readFileSync(join(abs, '.gitignore'), 'utf8');
        rules = [...rules, ...parseIgnoreLines(text, prefix)];
      } catch {
        errors.push(diag('E_UNREADABLE', { subject: joinPath(prefix, '.gitignore') }));
      }
    }
    const activeRules = [...rules, ...configRules];
    for (const e of entries) {
      if (!isValidUtf8(e.name)) {
        errors.push(diag('E_PATH_ENCODING', { subject: prefix }));
        continue;
      }
      const name = e.name.toString('utf8');
      if (name === '.git') continue;
      const kind = e.isDirectory()
        ? 'dir'
        : e.isSymbolicLink()
          ? 'link'
          : e.isFile()
            ? 'file'
            : null;
      if (kind === null) continue;
      const rel = joinPath(prefix, name);
      if (isIgnored(rel, kind === 'dir', activeRules)) continue;
      if (kind !== 'dir') {
        found.push({ path: rel, kind });
        continue;
      }
      const childAbs = join(abs, name);
      if (!hasEntry(childAbs, '.git')) walk(childAbs, rel);
    }
    rules = before;
  };
  walk(root, '');

  const universe: Universe = { paths: [], kinds: new Map(), onDisk: new Map() };
  for (const { path, kind } of found) {
    if ((CONFIG_NAMES as readonly string[]).includes(path) || path === 'docstamp-lock.yaml')
      continue;
    const nfc = path.normalize('NFC');
    if (universe.kinds.has(nfc)) errors.push(diag('E_PATH_COLLISION', { subject: nfc }));
    universe.kinds.set(nfc, kind);
    universe.onDisk.set(nfc, path);
  }
  universe.paths = [...universe.kinds.keys()].sort(comparePaths);
  const lowered = new Map<string, string>();
  for (const path of universe.paths) {
    const first = lowered.get(path.toLowerCase());
    if (first === undefined) lowered.set(path.toLowerCase(), path);
    else errors.push(diag('E_PATH_COLLISION', { subject: first }));
  }
  if (errors.length > 0) throw new Raised(errors);
  return universe;
}
