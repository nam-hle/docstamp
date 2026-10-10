import {
  chmodSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
  type Stats,
} from 'node:fs';
import type { DirEntry, EntryKind, FileSystem, Host } from './fs.ts';

const kindOf = (entry: Dirent<Buffer> | Stats): EntryKind => {
  if (entry.isDirectory()) return 'dir';
  if (entry.isSymbolicLink()) return 'link';
  return entry.isFile() ? 'file' : 'other';
};

export const nodeFs: FileSystem = {
  readDir: (dir): DirEntry[] =>
    readdirSync(dir, { withFileTypes: true, encoding: 'buffer' }).map((entry) => ({
      name: entry.name,
      kind: kindOf(entry),
    })),
  kind: (path) => {
    try {
      return kindOf(lstatSync(path));
    } catch {
      return null;
    }
  },
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  readFile: (path) => readFileSync(path),
  readLink: (path) => readlinkSync(path, 'utf8'),
  writeAtomic: (path, content, options = {}) => {
    const temp = `${path}.tmp-${process.pid}`;
    try {
      writeFileSync(temp, content, 'utf8');
      if (options.keepMode === true) chmodSync(temp, statSync(path).mode);
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  },
};

export const nodeHost: Host = { fs: nodeFs };
