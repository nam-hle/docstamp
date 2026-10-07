import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { REPO_DIR, Repo, copyFixture, hermeticEnv, restoreModes, type Session } from './repo.ts';
import { spawnSync } from 'node:child_process';

export interface ScenarioOptions {
  fixture?: string;
  git?: boolean;
  linkLib?: boolean;
  skipIf?: boolean;
}

type Body = (repo: Repo) => Promise<void> | void;

const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

const seen = new Set<string>();

function prepare(options: ScenarioOptions, session: Session): Repo {
  const root = join(session.base, 'repo');
  mkdirSync(root);
  mkdirSync(session.home);
  if (options.fixture !== undefined) {
    session.fixtureDir = copyFixture(options.fixture, root);
  }
  if (options.linkLib === true) {
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(REPO_DIR, join(root, 'node_modules', 'docstamp'));
  }
  if (options.git !== false) {
    const init = spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], {
      cwd: root,
      env: hermeticEnv(session.home),
    });
    if (init.status !== 0) throw new Error(`git init failed: ${String(init.stderr)}`);
  }
  return new Repo(root, session);
}

export function scenario(name: string, body: Body): void;
export function scenario(name: string, options: ScenarioOptions, body: Body): void;
export function scenario(name: string, second: ScenarioOptions | Body, third?: Body): void {
  const options = typeof second === 'function' ? {} : second;
  const body = typeof second === 'function' ? second : third;
  if (body === undefined) throw new Error('scenario needs a body');
  const slug = slugOf(name);
  if (seen.has(slug)) throw new Error(`duplicate scenario name: ${name}`);
  seen.add(slug);
  const register = options.skipIf === true ? it.skip : it;
  register(name, async (context) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'docstamp-e2e-')));
    const session: Session = {
      expect: context.expect,
      skip: (reason) => context.skip(reason),
      slug,
      base,
      home: join(base, 'home'),
      counter: 0,
      clock: 0,
      fixtureDir: undefined,
    };
    try {
      await body(prepare(options, session));
    } finally {
      restoreModes(base);
      rmSync(base, { recursive: true, force: true });
    }
  });
}

export const config = (files: Record<string, string[]>, extra = ''): string => {
  const entries = Object.entries(files).map(
    ([file, patterns]) =>
      `  ${JSON.stringify(file)}:\n    dependencies:\n` +
      patterns.map((pattern) => `      - ${JSON.stringify(pattern)}\n`).join(''),
  );
  return `version: 2\n${extra}files:\n${entries.join('')}`;
};
