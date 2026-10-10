// The only way the rest of src/ touches the file system. Paths are absolute.
export type EntryKind = 'file' | 'dir' | 'link' | 'other';

export interface DirEntry {
  // the raw bytes of the name: SPEC §7.4 refuses one that is not UTF-8
  readonly name: Buffer;
  readonly kind: EntryKind;
}

export interface FileSystem {
  // throws when the directory cannot be read
  readDir(dir: string): DirEntry[];
  // the kind of the entry itself (a link is not followed), or null when there is none
  kind(path: string): EntryKind | null;
  // follows links; false when there is none
  isDirectory(path: string): boolean;
  // throws when the file cannot be read
  readFile(path: string): Buffer;
  readLink(path: string): string;
  // writes a temporary file beside `path` and renames it over, so a reader sees all or nothing;
  // removes the temporary file and throws on any failure
  writeAtomic(path: string, content: string, options?: { keepMode?: boolean }): void;
}
