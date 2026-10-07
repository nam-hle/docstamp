import { expect } from 'vitest';
import { scenario } from '../harness/index.ts';

const fixture = 'legacy';
const v2Config = (repo: { fixtureText: (path: string) => string }) =>
  repo.fixtureText('variants/docstamp.v2.yaml');

scenario(
  '§9.3 a version 1 configuration fails every command with E_CONFIG_VERSION',
  { fixture },
  async (repo) => {
    for (const args of [
      [],
      ['update', '--all'],
      ['update', 'CLAUDE.md'],
      ['list-dependencies'],
      ['list-dependents', 'src/a.ts'],
    ]) {
      const result = await repo.run(args, { show: ['docstamp.yaml'] });
      expect(result.exit, args.join(' ')).toBe(2);
      expect(result.stderr, args.join(' ')).toContain('error: E_CONFIG_VERSION');
      expect(result.stderr, args.join(' ')).toMatch(/files/u);
      expect(result.stderr, args.join(' ')).toMatch(/dependencies/u);
    }
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);

    const json = await repo.run(['--json']);
    expect(json.json()).toMatchObject({
      exitCode: 2,
      files: [],
      summary: { ok: 0, stale: 0, invalid: 0 },
    });
    expect(json.json().diagnostics[0]).toMatchObject({ code: 'E_CONFIG_VERSION', file: null });
  },
);

scenario(
  '§11.1 a version 2 lock names its migration and update --all performs it',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', v2Config(repo));
    await repo.run(['update', '--all'], { expectExit: 0 });
    const v3 = repo.read('docstamp-lock.yaml');
    const v2 = v3.replace('version: 3\nfiles:', 'version: 2\ndependents:');
    expect(v2).not.toBe(v3);
    repo.write('docstamp-lock.yaml', v2);

    const check = await repo.run([], { show: ['docstamp-lock.yaml'] });
    expect(check.exit).toBe(2);
    expect(check.stderr).toContain('error: E_LOCK_VERSION');
    expect(check.stderr).toContain('docstamp update --all');
    expect(check.stderr).toContain('version 3');

    const named = await repo.run(['update', 'CLAUDE.md']);
    expect(named.exit).toBe(2);
    expect(repo.read('docstamp-lock.yaml')).toBe(v2);

    const list = await repo.run(['list-dependencies']);
    expect(list.exit).toBe(0);

    const migrate = await repo.run(['update', '--all']);
    expect(migrate.exit).toBe(0);
    expect(repo.read('docstamp-lock.yaml')).toBe(v3);
    expect((await repo.run([])).exit).toBe(0);
  },
);

scenario(
  '§11.1 a legacy docsync.lock blocks check and update until deleted',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', v2Config(repo));
    repo.write('docsync.lock', 'version: 1\ndependents: {}\n');

    const check = await repo.run([]);
    expect(check.exit).toBe(2);
    expect(check.stderr).toContain('E_LOCK_VERSION: docsync.lock');
    expect(check.stderr).toContain('delete docsync.lock');
    expect((await repo.run(['update', 'CLAUDE.md'])).exit).toBe(2);
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);

    const list = await repo.run(['list-dependencies']);
    expect(list).toMatchObject({
      exit: 0,
      stdout: 'CLAUDE.md\n  depends   src/**\n  resolved  src/a.ts\n',
      stderr: '',
    });
    expect((await repo.run(['list-dependents', 'src/a.ts'])).exit).toBe(0);
  },
);

scenario(
  '§13.6 update --all recovers from docsync.lock but keeps the file',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', v2Config(repo));
    repo.write('docsync.lock', 'version: 1\ndependents: {}\n');
    const update = await repo.run(['update', '--all']);
    expect(update.exit).toBe(0);
    await repo.snapFile('docstamp-lock.yaml');
    expect(repo.exists('docsync.lock')).toBe(true);
    const stillBlocked = await repo.run([], { label: 'docsync.lock still present' });
    expect(stillBlocked.exit).toBe(2);
    expect(stillBlocked.stderr).toContain('E_LOCK_VERSION: docsync.lock');
    repo.remove('docsync.lock');
    expect(await repo.run([], { label: 'docsync.lock deleted' })).toMatchObject({
      exit: 0,
      stdout: '1 ok, 0 stale, 0 invalid\n',
    });
  },
);

scenario(
  '§11.1 docsync.lock blocks even when it is a directory or empty',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', v2Config(repo));
    repo.write('docsync.lock', '');
    expect((await repo.run([])).stderr).toContain('E_LOCK_VERSION: docsync.lock');
    repo.remove('docsync.lock');
    repo.mkdir('docsync.lock');
    expect((await repo.run([], { label: 'docsync.lock is a directory' })).stderr).toContain(
      'E_LOCK_VERSION: docsync.lock',
    );
  },
);
