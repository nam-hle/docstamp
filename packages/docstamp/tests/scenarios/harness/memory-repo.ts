import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { run, type Io } from '../../../src/cli/run.ts';
import { memoryHost, type Entry, type MemoryHost } from '../../helpers/memory-fs.ts';
import {
  FIRST_COMMIT_TIME,
  ScenarioRepo,
  type Execution,
  type RunOptions,
  type Session,
} from '../../harness/core.ts';

const needsRealGit = (what: string): never => {
  throw new Error(`${what} needs a real repository: write this scenario under tests/e2e`);
};

// A fixture directory read into a tree, links and empty directories included
export function loadTree(dir: string, prefix = ''): Record<string, Entry> {
  const tree: Record<string, Entry> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const key = prefix === '' ? name : `${prefix}/${name}`;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) tree[key] = { link: readlinkSync(path) };
    else if (stat.isDirectory()) {
      const inner = loadTree(path, key);
      if (Object.keys(inner).length === 0) tree[key] = { dir: true };
      else Object.assign(tree, inner);
    } else tree[key] = readFileSync(path);
  }
  return tree;
}

// The working tree of a scenario, in memory: the same methods as the disk repo, and `run` calls the
// CLI in this process. There is no git: a scenario that needs history is an e2e test.
export class MemoryRepo extends ScenarioRepo {
  private readonly host: MemoryHost;
  private commits = 0;

  constructor(
    host: MemoryHost,
    session: Session,
    private readonly fixtureDir: string | undefined,
  ) {
    super(host.root, session);
    this.host = host;
  }

  path(...segments: string[]): string {
    return join(this.root, ...segments);
  }

  write(path: string, content: string | Uint8Array): void {
    this.host.fs.set(path, typeof content === 'string' ? content : Buffer.from(content));
  }

  append(path: string, text: string): void {
    this.host.fs.append(path, text);
  }

  read(path: string): string {
    const text = this.host.fs.text(path);
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  }

  exists(path: string): boolean {
    return this.host.fs.has(path);
  }

  isDirectory(path: string): boolean {
    return this.host.fs.kind(this.path(path)) === 'dir';
  }

  list(path = ''): string[] {
    return this.host.fs.names(path).filter((name) => name !== '.git');
  }

  mkdir(path: string): void {
    this.host.fs.makeDirectory(path);
  }

  remove(path: string): void {
    this.host.fs.removeTree(path);
  }

  rename(from: string, to: string): void {
    this.host.fs.rename(from, to);
  }

  symlink(path: string, target: string): void {
    this.host.fs.set(path, { link: target });
  }

  chmod(path: string, mode: number): void {
    this.host.fs.setMode(path, mode);
  }

  fixtureText(path: string): string {
    if (this.fixtureDir === undefined) throw new Error('scenario has no fixture');
    return readFileSync(join(this.fixtureDir, path), 'utf8');
  }

  skip(reason: string): never {
    return this.session.skip(reason);
  }

  at(): never {
    return needsRealGit('at()');
  }

  // only what a scenario asks of the history it made: the id of HEAD
  git(...args: string[]): string {
    if (args.join(' ') === 'rev-parse HEAD') return `${this.host.repo.resolve('HEAD') ?? 'HEAD'}\n`;
    if (args[0] === 'tag' && args.length === 3) {
      this.host.repo.tag(args[1]!, args[2]!);
      return '';
    }
    return needsRealGit(`git ${args.join(' ')}`);
  }

  // `at` pins the commit time, an ISO instant such as 2026-02-03T10:00:00Z
  commit(message: string, at?: string): string {
    const seconds =
      at === undefined ? FIRST_COMMIT_TIME + this.commits * 60 : Date.parse(at) / 1000;
    this.commits += 1;
    return this.host.repo.commit(message, seconds);
  }

  copyTo(): never {
    return needsRealGit('copyTo()');
  }

  shallowClone(): never {
    return needsRealGit('shallowClone()');
  }

  protected async execute(args: readonly string[], options: RunOptions): Promise<Execution> {
    let stdout = '';
    let stderr = '';
    const io: Io = {
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
      isTty: false,
      env: { ...options.env },
    };
    const exit = run(this.host, args, join(this.root, options.cwd ?? ''), io);
    return { exit, stdout, stderr };
  }
}

export const newHost = (tree: Record<string, Entry>, git: boolean): MemoryHost =>
  memoryHost(git ? { '.git/HEAD': 'ref: refs/heads/main\n', ...tree } : tree, {}, ROOT);

// far from any real path, so a git command run against it finds no repository
const ROOT = join(process.platform === 'win32' ? 'C:\\' : '/', 'docstamp-memory', 'repo');
