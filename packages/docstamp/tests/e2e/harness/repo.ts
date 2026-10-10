import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIRST_COMMIT_TIME,
  ScenarioRepo,
  type Execution,
  type RunOptions,
  type Session,
} from '../../harness/core.ts';

export const E2E_DIR = fileURLToPath(new URL('..', import.meta.url));
export const REPO_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const BIN = join(REPO_DIR, 'dist/index.js');

export interface DiskSession extends Session {
  home: string;
  clock: number;
  fixtureDir: string | undefined;
}

export const hermeticEnv = (home: string): Record<string, string> => ({
  PATH: process.env['PATH'] ?? '',
  HOME: home,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
});

const GIT_FLAGS = [
  '-c',
  'init.defaultBranch=main',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
  '-c',
  'core.quotepath=false',
];

export class Repo extends ScenarioRepo {
  private pinnedTime: string | undefined;

  constructor(
    root: string,
    protected readonly session: DiskSession,
  ) {
    super(root, session);
  }

  path(...segments: string[]): string {
    return join(this.root, ...segments);
  }

  at(dir: string): Repo {
    return new Repo(isAbsolute(dir) ? dir : join(this.session.base, dir), this.session);
  }

  write(path: string, content: string | Uint8Array): void {
    mkdirSync(dirname(this.path(path)), { recursive: true });
    writeFileSync(this.path(path), content);
  }

  append(path: string, text: string): void {
    appendFileSync(this.path(path), text);
  }

  read(path: string): string {
    return readFileSync(this.path(path), 'utf8');
  }

  exists(path: string): boolean {
    try {
      lstatSync(this.path(path));
      return true;
    } catch {
      return false;
    }
  }

  isDirectory(path: string): boolean {
    try {
      return lstatSync(this.path(path)).isDirectory();
    } catch {
      return false;
    }
  }

  list(path = ''): string[] {
    return readdirSync(this.path(path))
      .filter((name) => name !== '.git')
      .sort();
  }

  mkdir(path: string): void {
    mkdirSync(this.path(path), { recursive: true });
  }

  remove(path: string): void {
    rmSync(this.path(path), { recursive: true, force: true });
  }

  rename(from: string, to: string): void {
    mkdirSync(dirname(this.path(to)), { recursive: true });
    renameSync(this.path(from), this.path(to));
  }

  symlink(path: string, target: string): void {
    mkdirSync(dirname(this.path(path)), { recursive: true });
    symlinkSync(target, this.path(path));
  }

  chmod(path: string, mode: number): void {
    chmodSync(this.path(path), mode);
  }

  fixtureText(path: string): string {
    if (this.session.fixtureDir === undefined) throw new Error('scenario has no fixture');
    return readFileSync(join(this.session.fixtureDir, path), 'utf8');
  }

  skip(reason: string): never {
    return this.session.skip(reason);
  }

  git(...args: string[]): string {
    const result = spawnSync('git', [...GIT_FLAGS, ...args], {
      cwd: this.root,
      encoding: 'utf8',
      env: { ...hermeticEnv(this.session.home), ...this.commitEnv() },
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout;
  }

  // `at` pins the commit time, an ISO instant such as 2026-02-03T10:00:00Z
  commit(message: string, at?: string): string {
    this.git('add', '-A');
    this.pinnedTime = at;
    try {
      this.git('commit', '-q', '--no-verify', '--allow-empty', '-m', message);
    } finally {
      this.pinnedTime = undefined;
    }
    this.session.clock += 1;
    return this.git('rev-parse', 'HEAD').trim();
  }

  private commitEnv(): Record<string, string> {
    const seconds =
      this.pinnedTime === undefined
        ? FIRST_COMMIT_TIME + this.session.clock * 60
        : Date.parse(this.pinnedTime) / 1000;
    const date = `${seconds} +0000`;
    return {
      GIT_AUTHOR_NAME: 'Docstamp E2E',
      GIT_AUTHOR_EMAIL: 'e2e@example.invalid',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: 'Docstamp E2E',
      GIT_COMMITTER_EMAIL: 'e2e@example.invalid',
      GIT_COMMITTER_DATE: date,
    };
  }

  copyTo(dir: string): Repo {
    const target = join(this.session.base, dir);
    cpSync(this.root, target, { recursive: true, verbatimSymlinks: true });
    return this.at(target);
  }

  shallowClone(dir: string): Repo {
    const target = join(this.session.base, dir);
    this.git('clone', '-q', '--depth', '1', `file://${this.root}`, target);
    return this.at(target);
  }

  protected async execute(args: readonly string[], options: RunOptions): Promise<Execution> {
    if (!existsSync(BIN)) throw new Error('dist/index.js is missing: run `pnpm build` first');
    const cwd = join(this.root, options.cwd ?? '');
    const spawned = spawnSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...hermeticEnv(this.session.home), ...options.env },
    });
    if (spawned.status === null) throw new Error(`docstamp was killed: ${spawned.signal}`);
    return { exit: spawned.status, stdout: spawned.stdout, stderr: spawned.stderr };
  }
}

export function copyFixture(name: string, into: string): string {
  const source = join(E2E_DIR, 'fixtures', name);
  cpSync(source, into, { recursive: true, verbatimSymlinks: true });
  return source;
}

export function restoreModes(dir: string): void {
  try {
    if (!lstatSync(dir).isDirectory()) return;
    chmodSync(dir, 0o755);
    for (const name of readdirSync(dir)) restoreModes(join(dir, name));
  } catch {
    // a name that is not valid UTF-8 cannot be addressed as a string; rmSync removes it anyway
  }
}
