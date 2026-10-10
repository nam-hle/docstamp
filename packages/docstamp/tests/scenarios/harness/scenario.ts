import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { it } from 'vitest';
import { slugOf, type Session } from '../../harness/core.ts';
import { E2E_DIR } from '../../e2e/harness/repo.ts';
import { MemoryRepo, loadTree, newHost } from './memory-repo.ts';

export interface ScenarioOptions {
  fixture?: string;
  git?: boolean;
  skipIf?: boolean;
}

type Body = (repo: MemoryRepo) => Promise<void> | void;

const SCENARIOS_DIR = join(E2E_DIR, '..', 'scenarios');
const seen = new Set<string>();

function assertNoObsoleteSnapshots(session: Session): void {
  const present = existsSync(session.snapshotDir) ? readdirSync(session.snapshotDir) : [];
  const obsolete = present.filter((file) => !session.produced.has(file));
  if (obsolete.length > 0) {
    throw new Error(`obsolete snapshot files in ${session.snapshotDir}: ${obsolete.join(', ')}`);
  }
}

// An in-process scenario: the working tree lives in memory and `run` calls the CLI directly
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
    const fixtureDir =
      options.fixture === undefined ? undefined : join(E2E_DIR, 'fixtures', options.fixture);
    const host = newHost(
      fixtureDir === undefined ? {} : loadTree(fixtureDir),
      options.git !== false,
    );
    const session: Session = {
      expect: context.expect,
      skip: (reason) => context.skip(reason),
      slug,
      base: dirname(host.root),
      snapshotDir: join(SCENARIOS_DIR, '__snapshots__', slug),
      counter: 0,
      produced: new Set<string>(),
    };
    await body(new MemoryRepo(host, session, fixtureDir));
    assertNoObsoleteSnapshots(session);
  });
}
