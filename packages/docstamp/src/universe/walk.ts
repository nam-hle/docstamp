import { dirname, join, resolve } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import { comparePaths } from '../core/order.ts';
import type { Config, Diagnostic } from '../core/types.ts';
import type { DirEntry, Host } from '../host/fs.ts';
import { CONFIG_NAMES } from '../config/value.ts';
import { isIgnored, parseIgnoreLines, type IgnoreRule } from './ignore.ts';

type Kind = 'file' | 'link';
export interface Universe {
  paths: string[];
  kinds: Map<string, Kind>;
  onDisk: Map<string, string>;
  // SPEC §7.2 step 3.4: the entries a rule skipped, not the ones below a skipped directory
  ignored: string[];
  // SPEC §9.6.3: inline files and the lines of their hash keys, set once they are read
  marked?: Map<string, readonly number[]>;
}

const hasEntry = (host: Host, dir: string, name: string): boolean =>
  host.fs.kind(join(dir, name)) !== null;

// SPEC §6: the nearest configuration file, else the nearest .git
export function determineRoot(host: Host, cwd: string, rootOption: string | undefined): string {
  if (rootOption !== undefined) {
    const dir = resolve(cwd, rootOption);
    if (!host.fs.isDirectory(dir)) throw new Raised([diag('E_ROOT')]);
    return dir;
  }
  const nearest = (found: (dir: string) => boolean): string | null => {
    for (let dir = cwd; ; dir = dirname(dir)) {
      if (found(dir)) return dir;
      if (dirname(dir) === dir) return null;
    }
  };
  const root =
    nearest((dir) => CONFIG_NAMES.some((name) => hasEntry(host, dir, name))) ??
    nearest((dir) => hasEntry(host, dir, '.git'));
  if (root === null) throw new Raised([diag('E_CONFIG_MISSING')]);
  return root;
}

const joinPath = (prefix: string, name: string) => (prefix === '' ? name : `${prefix}/${name}`);
const isValidUtf8 = (name: Buffer) => Buffer.from(name.toString('utf8'), 'utf8').equals(name);

// SPEC §7.2, §7.4, §7.5
export function computeUniverse(
  host: Host,
  root: string,
  config: Pick<Config, 'ignore' | 'useGitignore'>,
): Universe {
  const errors: Diagnostic[] = [];
  const found: Array<{ path: string; kind: Kind }> = [];
  const ignored: string[] = [];
  const configRules = config.ignore.flatMap((line) => parseIgnoreLines(line, ''));
  let rules: IgnoreRule[] = [];

  const walk = (abs: string, prefix: string): void => {
    let entries: DirEntry[];
    try {
      entries = host.fs.readDir(abs);
    } catch {
      errors.push(diag('E_UNREADABLE', { subject: prefix }));
      return;
    }
    const before = rules;
    const hasGitignore = entries.some(
      (e) => e.name.toString() === '.gitignore' && e.kind === 'file',
    );
    if (config.useGitignore && hasGitignore) {
      try {
        const text = host.fs.readFile(join(abs, '.gitignore')).toString('utf8');
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
      const { kind } = e;
      if (kind === 'other') continue;
      const rel = joinPath(prefix, name);
      if (isIgnored(rel, kind === 'dir', activeRules)) {
        ignored.push(rel.normalize('NFC'));
        continue;
      }
      if (kind !== 'dir') {
        found.push({ path: rel, kind });
        continue;
      }
      const childAbs = join(abs, name);
      if (!hasEntry(host, childAbs, '.git')) walk(childAbs, rel);
    }
    rules = before;
  };
  walk(root, '');

  const universe: Universe = { paths: [], kinds: new Map(), onDisk: new Map(), ignored };
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

// SPEC §13.8 step 4.4: an entry of any kind, found by exact name in each directory listing
export function existsUnderRoot(host: Host, root: string, path: string): boolean {
  let dir = root;
  const segments = path.split('/');
  for (const [i, segment] of segments.entries()) {
    try {
      const entry = host.fs
        .readDir(dir)
        .find((e) => e.name.toString('utf8').normalize('NFC') === segment);
      if (entry === undefined) return false;
      dir = join(dir, entry.name.toString('utf8'));
      if (i < segments.length - 1 && entry.kind !== 'dir') return false;
    } catch {
      return false;
    }
  }
  return true;
}

// SPEC §8.5 NOTE: a path that exists under Root, is not in the Universe, and is ignored
export function isIgnoredPath(host: Host, root: string, universe: Universe, path: string): boolean {
  const ignored = new Set(universe.ignored);
  const segments = path.split('/');
  const aboveOrSelf = segments.some((_, i) => ignored.has(segments.slice(0, i + 1).join('/')));
  const below = universe.ignored.some((entry) => entry.startsWith(`${path}/`));
  return (aboveOrSelf || below) && hasEntry(host, root, path);
}
