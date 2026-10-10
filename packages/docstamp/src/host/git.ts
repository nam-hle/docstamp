// The only way the rest of src/ asks git a question: read-only, and typed, so the history
// algorithms (SPEC §12.3, §12.4, §12.7) run on answers, not on command lines or their output.
// Every method throws when git cannot answer (not installed, not a work tree, no such revision);
// the callers decide what that means. Paths are relative to the Root.

// SPEC §12.3 step 2: a line of `git diff --name-status`, before the status is read
export interface RawChange {
  readonly status: string;
  readonly path: string;
}

// SPEC §12.4 step 5: a commit of the window, with the paths it touches
export interface LogEntry {
  readonly seconds: number;
  readonly paths: readonly string[];
}

// SPEC §12.4 steps 3 and 4: the commits younger than a time, or those after a commit
export type LogWindow = { readonly maxAge: number } | { readonly after: string };

// A revision is a commit id, `HEAD`, or one of those followed by `^` (its first parent).
export interface Git {
  isShallow(): boolean;
  hasCommit(): boolean;
  // the commit id of a revision, or null when there is none
  resolve(rev: string): string | null;
  // the commits, newest first, whose change of `path` adds or removes `needle` (git log -S)
  pickaxe(path: string, needle: string): string[];
  // the text of a file at a revision; throws when it is not there
  fileAt(rev: string, path: string): string;
  lastCommitTouching(path: string): string | null;
  // the object name of a regular file at a revision, or null
  objectAt(rev: string, path: string): string | null;
  // the object name of every regular file at a revision
  objectsAt(rev: string): ReadonlyMap<string, string>;
  // the object names the work tree files would have, in order
  hashWorkFiles(paths: readonly string[]): string[];
  // the work tree against a revision, staged and unstaged edits included; null when git reports a
  // status the caller cannot read
  changesSince(rev: string): RawChange[] | null;
  // the paths git does not track and does not ignore
  untracked(): string[];
  // true when only white space (and blank lines) differ, and the file mode is the same
  isWhitespaceOnly(rev: string, path: string): boolean;
  // the commits of a window, merges left out, newest first; null when git's output is unreadable
  log(window: LogWindow): LogEntry[] | null;
}
