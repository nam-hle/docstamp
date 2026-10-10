import { resolve } from 'node:path';
import type { DirEntry, EntryKind, FileSystem, Host } from '../../src/host/fs.ts';

// A tree to build: a String is a file, { link } a symbolic link, { dir } an empty directory
export type Entry =
  | string
  | Buffer
  | { readonly link: string }
  | { readonly dir: true }
  | { readonly content: string | Buffer; readonly mode: number };

export interface MemoryOptions {
  // directories that cannot be listed, and files that cannot be read or written
  readonly unreadable?: readonly string[];
}

interface Node {
  kind: EntryKind;
  content?: Buffer;
  target?: string;
  mode: number;
}

// Windows separators and drive letters map to one POSIX tree, so a test reads the same everywhere
const normalize = (path: string): string => {
  const posix = path.replaceAll('\\', '/').replace(/^[A-Za-z]:/u, '');
  const parts: string[] = [];
  for (const part of posix.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
};

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/';

class MemoryFs implements FileSystem {
  private readonly nodes = new Map<string, Node>([['/', { kind: 'dir', mode: 0o755 }]]);
  private readonly unreadable: Set<string>;

  constructor(
    readonly root: string,
    tree: Readonly<Record<string, Entry>> = {},
    options: MemoryOptions = {},
  ) {
    this.unreadable = new Set((options.unreadable ?? []).map((path) => this.absolute(path)));
    this.makeDirectories(this.absolute(''));
    for (const [path, entry] of Object.entries(tree)) this.add(this.absolute(path), entry);
  }

  private absolute(path: string): string {
    return normalize(`${this.root}/${path}`);
  }

  private makeDirectories(path: string): void {
    for (let dir = path; dir !== '/'; dir = parentOf(dir)) {
      if (!this.nodes.has(dir)) this.nodes.set(dir, { kind: 'dir', mode: 0o755 });
    }
  }

  private add(path: string, entry: Entry): void {
    this.makeDirectories(parentOf(path));
    if (typeof entry === 'string' || Buffer.isBuffer(entry)) {
      this.nodes.set(path, { kind: 'file', content: Buffer.from(entry), mode: 0o644 });
    } else if ('link' in entry) {
      this.nodes.set(path, { kind: 'link', target: entry.link, mode: 0o777 });
    } else if ('dir' in entry) {
      this.makeDirectories(path);
    } else {
      this.nodes.set(path, { kind: 'file', content: Buffer.from(entry.content), mode: entry.mode });
    }
  }

  // what a test asserts on, never part of the port
  modeOf(path: string): number | undefined {
    return this.nodes.get(this.absolute(path))?.mode;
  }

  text(path: string): string | undefined {
    return this.nodes.get(this.absolute(path))?.content?.toString('utf8');
  }

  paths(): string[] {
    return [...this.nodes.keys()].filter((path) => path !== '/').sort();
  }

  set(path: string, entry: Entry): void {
    this.add(this.absolute(path), entry);
  }

  remove(path: string): void {
    this.nodes.delete(this.absolute(path));
  }

  // what a scenario does to its working tree
  removeTree(path: string): void {
    const target = this.absolute(path);
    for (const key of this.nodes.keys()) {
      if (key === target || key.startsWith(`${target}/`)) this.nodes.delete(key);
    }
  }

  rename(from: string, to: string): void {
    const source = this.absolute(from);
    const target = this.absolute(to);
    const moved = [...this.nodes].filter(([key]) => key === source || key.startsWith(`${source}/`));
    if (moved.length === 0) throw new Error(`ENOENT: ${from}`);
    this.makeDirectories(parentOf(target));
    for (const [key] of moved) this.nodes.delete(key);
    for (const [key, node] of moved) this.nodes.set(target + key.slice(source.length), node);
  }

  makeDirectory(path: string): void {
    this.makeDirectories(this.absolute(path));
  }

  append(path: string, text: string): void {
    const node = this.nodes.get(this.absolute(path));
    if (node?.kind !== 'file') throw new Error(`ENOENT: ${path}`);
    node.content = Buffer.concat([node.content!, Buffer.from(text, 'utf8')]);
  }

  // a mode without read permission makes the entry unreadable, as chmod 000 does
  setMode(path: string, mode: number): void {
    const target = this.absolute(path);
    const node = this.nodes.get(target);
    if (node === undefined) throw new Error(`ENOENT: ${path}`);
    node.mode = mode;
    if ((mode & 0o444) === 0) this.unreadable.add(target);
    else this.unreadable.delete(target);
  }

  names(path = ''): string[] {
    return this.readDir(this.absolute(path))
      .map((entry) => entry.name.toString('utf8'))
      .sort();
  }

  has(path: string): boolean {
    return this.nodes.has(this.absolute(path));
  }

  private resolve(path: string): { path: string; node: Node } | undefined {
    let current = normalize(path);
    for (let hops = 0; hops < 40; hops++) {
      const node = this.nodes.get(current);
      if (node === undefined || node.kind !== 'link') return node && { path: current, node };
      current = normalize(`${parentOf(current)}/${node.target!}`);
    }
    return undefined;
  }

  readDir(dir: string): DirEntry[] {
    const path = normalize(dir);
    const found = this.resolve(path);
    if (found?.node.kind !== 'dir' || this.unreadable.has(found.path)) {
      throw new Error(`EACCES: ${dir}`);
    }
    return [...this.nodes]
      .filter(([child]) => child !== found.path && parentOf(child) === found.path)
      .map(([child, node]) => ({
        name: Buffer.from(child.slice(child.lastIndexOf('/') + 1), 'utf8'),
        kind: node.kind,
      }));
  }

  kind(path: string): EntryKind | null {
    return this.nodes.get(normalize(path))?.kind ?? null;
  }

  isDirectory(path: string): boolean {
    return this.resolve(path)?.node.kind === 'dir';
  }

  readFile(path: string): Buffer {
    const found = this.resolve(path);
    if (found?.node.kind !== 'file' || this.unreadable.has(found.path)) {
      throw new Error(`ENOENT: ${path}`);
    }
    return Buffer.from(found.node.content!);
  }

  readLink(path: string): string {
    const node = this.nodes.get(normalize(path));
    if (node?.kind !== 'link') throw new Error(`EINVAL: ${path}`);
    return node.target!;
  }

  writeAtomic(path: string, content: string, options: { keepMode?: boolean } = {}): void {
    const target = normalize(path);
    const parent = this.nodes.get(parentOf(target));
    if (parent?.kind !== 'dir' || this.unreadable.has(target)) throw new Error(`EACCES: ${path}`);
    const existing = this.nodes.get(target);
    if (existing !== undefined && existing.kind !== 'file') throw new Error(`EISDIR: ${path}`);
    const mode = options.keepMode === true ? existing?.mode : undefined;
    if (options.keepMode === true && existing === undefined) throw new Error(`ENOENT: ${path}`);
    this.nodes.set(target, {
      kind: 'file',
      content: Buffer.from(content, 'utf8'),
      mode: mode ?? existing?.mode ?? 0o644,
    });
  }
}

export interface MemoryHost extends Host {
  readonly fs: MemoryFs;
  readonly root: string;
}

// A Host over a tree that lives in memory: `root` is where the files are, an absolute path of the
// platform (`/repo`, or `D:\repo` on Windows) so that path arithmetic on it behaves as in production
export function memoryHost(
  tree: Readonly<Record<string, Entry>> = {},
  options: MemoryOptions = {},
  root = resolve('/repo'),
): MemoryHost {
  return { fs: new MemoryFs(root, tree, options), root };
}

// `fn(...inMemory(tree))` calls a function that takes (host, root) on a tree that lives in memory
export function inMemory(
  tree: Readonly<Record<string, Entry>> = {},
  options: MemoryOptions = {},
): [MemoryHost, string] {
  const host = memoryHost(tree, options);
  return [host, host.root];
}
