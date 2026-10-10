import { join } from 'node:path';
import type { ExpectStatic } from 'vitest';

// What every scenario repo shares, on disk or in memory: running the CLI, asserting its exit code,
// and writing the snapshot of the whole result. A scenario body cannot tell the two apart.
export interface Session {
  expect: ExpectStatic;
  skip: (reason: string) => never;
  slug: string;
  // a directory whose path is replaced by <tmp> in a snapshot
  base: string;
  // the folder that holds the snapshots of this scenario
  snapshotDir: string;
  counter: number;
  produced: Set<string>;
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

export interface Execution {
  exit: number;
  stdout: string;
  stderr: string;
}

const slugify = (text: string, max = 48): string =>
  text
    .replace(/[^A-Za-z0-9._]+/gu, '-')
    .replace(/^[-.]+|-+$/gu, '')
    .slice(0, max)
    .replace(/-+$/gu, '');

const shellQuote = (arg: string): string =>
  /^[A-Za-z0-9_@%+=:,./<>-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;

export abstract class ScenarioRepo {
  constructor(
    readonly root: string,
    protected readonly session: Session,
  ) {}

  abstract read(path: string): string;
  abstract exists(path: string): boolean;
  protected abstract execute(args: readonly string[], options: RunOptions): Promise<Execution>;

  async run(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    const { exit, stdout, stderr } = await this.execute(args, options);
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
    const line = ['docstamp', ...args].map((arg) => shellQuote(this.normalize(arg))).join(' ');
    return (
      `${label}$ ${line}\n${cwd}${env.join('')}exit: ${result.exit}\n` +
      `--- stdout ---\n${result.stdout}--- stderr ---\n${result.stderr}${shown.join('')}`
    );
  }

  protected normalize(text: string): string {
    const mapped = text.replaceAll(this.root, '<root>').replaceAll(this.session.base, '<tmp>');
    if (process.platform !== 'win32') return mapped;
    // docstamp prints paths with `/`, so map the forward-slash spelling of the same paths too.
    const slashed = mapped
      .replaceAll(this.root.replaceAll('\\', '/'), '<root>')
      .replaceAll(this.session.base.replaceAll('\\', '/'), '<tmp>')
      .replaceAll(this.root.replaceAll('\\', '\\\\'), '<root>')
      .replace(/(['"])(<root>|<tmp>)([^\s'"]*)\1/gu, '$2$3');
    return slashed.replace(
      /(<root>|<tmp>)([^\s'"]*)/gu,
      (_, token: string, tail: string) => token + tail.replaceAll('\\', '/'),
    );
  }

  protected async snapshot(name: string, text: string): Promise<void> {
    const session = this.session;
    session.counter += 1;
    const file = `${String(session.counter).padStart(2, '0')}-${name}.txt`;
    session.produced.add(file);
    const normalized = this.normalize(text).replaceAll('\r', '␍').replaceAll('﻿', '<BOM>');
    await session.expect(normalized).toMatchFileSnapshot(join(session.snapshotDir, file));
  }
}

export const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

export const config = (files: Record<string, string[]>, extra = ''): string => {
  const entries = Object.entries(files).map(
    ([file, patterns]) =>
      `  ${JSON.stringify(file)}:\n    dependencies:\n` +
      patterns.map((pattern) => `      - ${JSON.stringify(pattern)}\n`).join(''),
  );
  return `version: 2\n${extra}files:\n${entries.join('')}`;
};
