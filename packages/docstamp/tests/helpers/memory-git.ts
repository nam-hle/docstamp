import { createHash } from 'node:crypto';
import type { Git, LogEntry, LogWindow, RawChange } from '../../src/host/git.ts';
import { isIgnored, parseIgnoreLines, type IgnoreRule } from '../../src/universe/ignore.ts';
import type { MemoryFs } from './memory-fs.ts';

// A git repository in memory: a straight line of commits over the work tree of a MemoryFs. It does
// what `git add -A && git commit` does and answers the questions of the Git port; branches, merges,
// rebases and shallow clones are for the real thing. Object ids are computed as git computes them
// (blob, tree and commit objects hashed with SHA-1), so a commit made here has the id the same
// commit gets from git, and the port's contract test holds the two to the same answers.

const AUTHOR = 'Docstamp E2E <e2e@example.invalid>';

interface Blob {
  readonly id: string;
  readonly mode: string;
  readonly content: Buffer;
}

interface Commit {
  readonly id: string;
  readonly seconds: number;
  readonly files: ReadonlyMap<string, Blob>;
}

const sha1 = (bytes: Buffer): string => createHash('sha1').update(bytes).digest('hex');
const object = (type: string, body: Buffer): Buffer =>
  Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);

const blobOf = (content: Buffer, mode: string): Blob => ({
  id: sha1(object('blob', content)),
  mode,
  content,
});

// git sorts tree entries by name, a directory as if its name ended with a slash
function treeId(files: ReadonlyMap<string, Blob>, prefix = ''): string {
  const children = new Map<string, Blob | 'dir'>();
  for (const [path, blob] of files) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) children.set(rest, blob);
    else children.set(rest.slice(0, slash), 'dir');
  }
  const names = [...children.keys()].sort((a, b) => {
    const left = children.get(a) === 'dir' ? `${a}/` : a;
    const right = children.get(b) === 'dir' ? `${b}/` : b;
    return Buffer.compare(Buffer.from(left), Buffer.from(right));
  });
  const body = Buffer.concat(
    names.map((name) => {
      const child = children.get(name)!;
      const isDir = child === 'dir';
      const mode = isDir ? '40000' : child.mode;
      const id = isDir ? treeId(files, `${prefix}${name}/`) : child.id;
      return Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(id, 'hex')]);
    }),
  );
  return sha1(object('tree', body));
}

const lineKey = (content: Buffer): string =>
  content
    .toString('utf8')
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ''))
    .filter((line) => line !== '')
    .join('\n');

export class MemoryGit implements Git {
  private readonly commits: Commit[] = [];
  private readonly tags = new Map<string, string>();

  constructor(private readonly fs: MemoryFs) {}

  // `git add -A && git commit`: tracked files stay, new ones are added unless ignored
  commit(message: string, seconds: number): string {
    const head = this.commits.at(-1);
    const files = new Map<string, Blob>();
    const ignored = this.ignoredPaths();
    for (const entry of this.fs.workTree()) {
      const tracked = head?.files.has(entry.path) === true;
      if (!tracked && ignored.has(entry.path)) continue;
      files.set(entry.path, blobOf(entry.content, modeOf(entry)));
    }
    const header =
      `tree ${treeId(files)}\n` +
      (head === undefined ? '' : `parent ${head.id}\n`) +
      `author ${AUTHOR} ${seconds} +0000\ncommitter ${AUTHOR} ${seconds} +0000\n\n${message}\n`;
    const id = sha1(object('commit', Buffer.from(header)));
    this.commits.push({ id, seconds, files });
    return id;
  }

  private ignoredPaths(): Set<string> {
    const all = this.fs.workTree();
    const texts = new Map(
      all.filter((e) => e.path.endsWith('.gitignore')).map((e) => [e.path, e.content.toString()]),
    );
    const rulesAt = (dir: string): IgnoreRule[] => {
      const parts = dir === '' ? [] : dir.split('/');
      const chain = ['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))];
      return chain.flatMap((d) => {
        const file = d === '' ? '.gitignore' : `${d}/.gitignore`;
        return texts.has(file) ? parseIgnoreLines(texts.get(file)!, d) : [];
      });
    };
    const ignored = new Set<string>();
    for (const { path } of all) {
      const parts = path.split('/');
      for (let i = 0; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        const rel = parts.slice(0, i + 1).join('/');
        if (isIgnored(rel, i < parts.length - 1, rulesAt(dir))) {
          ignored.add(path);
          break;
        }
      }
    }
    return ignored;
  }

  tag(name: string, rev: string): void {
    this.tags.set(name, this.require(rev).id);
  }

  // HEAD, a tag or a commit id, followed by any of ^ (the first parent) and ~N (N parents back)
  private find(rev: string): Commit | undefined {
    const parsed = /^(HEAD|[0-9a-f]{40}|[A-Za-z][\w.-]*)((?:\^|~\d+)*)$/u.exec(rev);
    if (parsed === null) return undefined;
    const name = parsed[1]!;
    const id = this.tags.get(name) ?? name;
    // the one branch is `main`, and it is HEAD
    let commit =
      name === 'HEAD' || name === 'main'
        ? this.commits.at(-1)
        : this.commits.find((c) => c.id === id);
    for (const [step] of (parsed[2] ?? '').matchAll(/\^|~\d+/gu)) {
      const back = step === '^' ? 1 : Number(step.slice(1));
      for (let i = 0; i < back && commit !== undefined; i++) commit = this.parentOf(commit);
    }
    return commit;
  }

  private require(rev: string): Commit {
    const found = this.find(rev);
    if (found === undefined) throw new Error(`unknown revision ${rev}`);
    return found;
  }

  private parentOf(commit: Commit): Commit | undefined {
    return this.commits[this.commits.indexOf(commit) - 1];
  }

  isShallow(): boolean {
    return false;
  }

  hasCommit(): boolean {
    return this.commits.length > 0;
  }

  resolve(rev: string): string | null {
    return this.find(rev)?.id ?? null;
  }

  pickaxe(path: string, needle: string): string[] {
    const count = (commit: Commit | undefined): number =>
      commit?.files.get(path)?.content.toString('utf8').split(needle).length ?? 1;
    return [...this.commits]
      .reverse()
      .filter((commit) => count(commit) !== count(this.parentOf(commit)))
      .map((commit) => commit.id);
  }

  fileAt(rev: string, path: string): string {
    const blob = this.require(rev).files.get(path);
    if (blob === undefined) throw new Error(`${path} is not in ${rev}`);
    return blob.content.toString('utf8');
  }

  lastCommitTouching(path: string): string | null {
    const touched = [...this.commits]
      .reverse()
      .find((commit) => commit.files.get(path)?.id !== this.parentOf(commit)?.files.get(path)?.id);
    return touched?.id ?? null;
  }

  objectAt(rev: string, path: string): string | null {
    const blob = this.find(rev)?.files.get(path);
    return blob !== undefined && blob.mode !== '120000' ? blob.id : null;
  }

  objectsAt(rev: string): ReadonlyMap<string, string> {
    const objects = new Map<string, string>();
    for (const [path, blob] of this.require(rev).files) {
      if (blob.mode !== '120000') objects.set(path, blob.id);
    }
    return objects;
  }

  hashWorkFiles(paths: readonly string[]): string[] {
    const work = new Map(this.fs.workTree().map((entry) => [entry.path, entry]));
    return paths.map((path) => {
      const entry = work.get(path);
      if (entry === undefined) throw new Error(`no such file ${path}`);
      return blobOf(entry.content, modeOf(entry)).id;
    });
  }

  changesSince(rev: string): RawChange[] | null {
    const base = this.require(rev).files;
    const index = this.commits.at(-1)?.files ?? new Map<string, Blob>();
    const work = new Map(this.fs.workTree().map((entry) => [entry.path, entry]));
    const changes: RawChange[] = [];
    for (const path of new Set([...base.keys(), ...index.keys()])) {
      const old = base.get(path);
      const entry = index.has(path) ? work.get(path) : undefined;
      if (old !== undefined && entry === undefined) changes.push({ status: 'D', path });
      else if (old === undefined && entry !== undefined) changes.push({ status: 'A', path });
      else if (old !== undefined && entry !== undefined) {
        const now = blobOf(entry.content, modeOf(entry));
        if (now.id !== old.id || now.mode !== old.mode) {
          changes.push({
            status: (old.mode === '120000') !== (now.mode === '120000') ? 'T' : 'M',
            path,
          });
        }
      }
    }
    return changes.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  untracked(): string[] {
    const index = this.commits.at(-1)?.files ?? new Map<string, Blob>();
    const ignored = this.ignoredPaths();
    return this.fs
      .workTree()
      .map((entry) => entry.path)
      .filter((path) => !index.has(path) && !ignored.has(path));
  }

  isWhitespaceOnly(rev: string, path: string): boolean {
    const old = this.find(rev)?.files.get(path);
    const entry = this.fs.workTree().find((candidate) => candidate.path === path);
    // git diff shows nothing for a path that neither the revision nor the index knows
    if (old === undefined)
      return entry === undefined || this.commits.at(-1)?.files.has(path) !== true;
    if (entry === undefined) return false;
    if (modeOf(entry) !== old.mode) return false;
    return lineKey(entry.content) === lineKey(old.content);
  }

  log(window: LogWindow): LogEntry[] {
    const head = this.commits.at(-1);
    if (head === undefined) return [];
    const after = 'after' in window ? this.commits.findIndex((c) => c.id === window.after) : -1;
    return [...this.commits]
      .map((commit, index) => ({ commit, index }))
      .filter(({ commit, index }) =>
        'maxAge' in window ? commit.seconds >= window.maxAge : index > after,
      )
      .reverse()
      .map(({ commit }) => {
        const parent = this.parentOf(commit)?.files ?? new Map<string, Blob>();
        const changed = new Set<string>();
        for (const path of new Set([...commit.files.keys(), ...parent.keys()])) {
          if (commit.files.get(path)?.id !== parent.get(path)?.id) changed.add(path);
        }
        return { seconds: commit.seconds, paths: [...changed].sort() };
      });
  }
}

const modeOf = (entry: { kind: 'file' | 'link'; mode: number }): string => {
  if (entry.kind === 'link') return '120000';
  return (entry.mode & 0o111) === 0 ? '100644' : '100755';
};
