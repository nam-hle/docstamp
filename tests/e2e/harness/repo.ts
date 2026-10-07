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
import type { ExpectStatic } from 'vitest';

export const E2E_DIR = fileURLToPath(new URL('..', import.meta.url));
export const REPO_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const BIN = join(REPO_DIR, 'dist/index.js');
const FIRST_COMMIT_TIME = 1_767_225_600;

export interface Session {
  expect: ExpectStatic;
  skip: (reason: string) => never;
  slug: string;
  base: string;
  home: string;
  counter: number;
  clock: number;
  fixtureDir: string | undefined;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  expectExit?: number;
  snapshot?: boolean;
  label?: string;
  show?: string[];
}

interface Doc {
  [key: string]: any;
}

export interface RunResult {
  exit: number;
  stdout: string;
  stderr: string;
  json: () => Doc;
}

const slugify = (text: string, max = 48): string =>
  text
    .replace(/[^A-Za-z0-9._]+/gu, '-')
    .replace(/^[-.]+|-+$/gu, '')
    .slice(0, max)
    .replace(/-+$/gu, '');

const shellQuote = (arg: string): string =>
  /^[A-Za-z0-9_@%+=:,./<>-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;

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

export class Repo {
  constructor(
    readonly root: string,
    private readonly session: Session,
  ) {}

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

  commit(message: string): string {
    this.git('add', '-A');
    this.git('commit', '-q', '--no-verify', '--allow-empty', '-m', message);
    this.session.clock += 1;
    return this.git('rev-parse', 'HEAD').trim();
  }

  private commitEnv(): Record<string, string> {
    const date = `${FIRST_COMMIT_TIME + this.session.clock * 60} +0000`;
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

  async run(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    if (!existsSync(BIN)) throw new Error('dist/index.js is missing: run `pnpm build` first');
    const cwd = join(this.root, options.cwd ?? '');
    const spawned = spawnSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...hermeticEnv(this.session.home), ...options.env },
    });
    if (spawned.status === null) throw new Error(`docstamp was killed: ${spawned.signal}`);
    const { status: exit, stdout, stderr } = spawned;
    if (options.expectExit !== undefined && exit !== options.expectExit) {
      throw new Error(
        `docstamp ${args.join(' ')}: expected exit ${options.expectExit}, got ${exit}\n` +
          `stdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
    const result: RunResult = { exit, stdout, stderr, json: () => JSON.parse(stdout) as Doc };
    if (options.snapshot !== false) {
      await this.snapshot(
        slugify(options.label ?? this.normalize(args.join(' '))) || 'no-args',
        this.describeRun(args, options, result),
      );
    }
    return result;
  }

  async snapFile(path: string, label = path): Promise<void> {
    const body = this.exists(path) ? this.read(path) : '(absent)\n';
    await this.snapshot(`file-${slugify(label)}`, `file: ${path}\n--- content ---\n${body}`);
  }

  async snap(label: string, text: string): Promise<void> {
    await this.snapshot(slugify(label), `${label}\n--- text ---\n${text}`);
  }

  private describeRun(args: readonly string[], options: RunOptions, result: RunResult): string {
    const env = Object.entries(options.env ?? {}).map(([k, v]) => `env: ${k}=${v}\n`);
    const cwd = options.cwd === undefined ? '' : `cwd: ${options.cwd}\n`;
    const label = options.label === undefined ? '' : `# ${options.label}\n`;
    const shown = (options.show ?? []).map((path) => {
      const body = this.exists(path) ? this.read(path) : '(absent)\n';
      const text = body === '' ? '(empty)\n' : body;
      return `--- setup: ${path} ---\n${text}${text.endsWith('\n') ? '' : '\n(no final newline)\n'}`;
    });
    const line = ['docstamp', ...args].map(shellQuote).join(' ');
    return (
      `${label}$ ${line}\n${cwd}${env.join('')}exit: ${result.exit}\n` +
      `--- stdout ---\n${result.stdout}--- stderr ---\n${result.stderr}${shown.join('')}`
    );
  }

  private normalize(text: string): string {
    return text.replaceAll(this.root, '<root>').replaceAll(this.session.base, '<tmp>');
  }

  private async snapshot(name: string, text: string): Promise<void> {
    const session = this.session;
    session.counter += 1;
    const file = `${String(session.counter).padStart(2, '0')}-${name}.txt`;
    const normalized = this.normalize(text);
    await session
      .expect(normalized)
      .toMatchFileSnapshot(join(E2E_DIR, '__snapshots__', session.slug, file));
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
