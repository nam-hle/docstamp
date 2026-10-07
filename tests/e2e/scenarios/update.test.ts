import { statSync, utimesSync } from 'node:fs';
import { expect } from 'vitest';
import { config, scenario } from '../harness/index.ts';

const fixture = 'docs-site';
const ROOT_ENTRIES = [
  'CLAUDE.md',
  'README.md',
  'docs',
  'docstamp-lock.yaml',
  'docstamp.yaml',
  'src',
];

scenario('§13.6 update --all writes every entry in canonical form', { fixture }, async (repo) => {
  const result = await repo.run(['update', '--all']);
  expect(result).toMatchObject({
    exit: 0,
    stdout: 'written  CLAUDE.md\nwritten  README.md\nwritten  docs/guide.md\n',
    stderr: '',
  });
  await repo.snapFile('docstamp-lock.yaml');
  const lock = repo.read('docstamp-lock.yaml');
  expect(lock).toMatch(/^version: 3\nfiles:\n {2}"CLAUDE\.md": [0-9a-f]{64}\n {2}"README\.md": /u);
  expect(lock.endsWith('\n')).toBe(true);
  expect(lock).not.toContain('\r');
  expect(repo.list()).toEqual(ROOT_ENTRIES);
});

scenario('§13.6 update <file> records only the named file', { fixture }, async (repo) => {
  await repo.run(['update', 'README.md'], { expectExit: 0 });
  await repo.snapFile('docstamp-lock.yaml', 'lock with README.md only');
  expect(repo.read('docstamp-lock.yaml')).toMatch(
    /^version: 3\nfiles:\n {2}"README\.md": [0-9a-f]{64}\n$/u,
  );

  await repo.run(['update', 'docs/guide.md', 'CLAUDE.md'], { expectExit: 0 });
  await repo.snapFile('docstamp-lock.yaml', 'lock with three files');
  const names = [...repo.read('docstamp-lock.yaml').matchAll(/^ {2}"(\S+)": /gmu)].map((m) => m[1]);
  expect(names).toEqual(['CLAUDE.md', 'README.md', 'docs/guide.md']);
});

scenario('§11.3 an unchanged lock is left untouched', { fixture }, async (repo) => {
  await repo.run(['update', '--all'], { expectExit: 0 });
  const lockPath = repo.path('docstamp-lock.yaml');
  const before = repo.read('docstamp-lock.yaml');
  const old = new Date('2001-01-01T00:00:00Z');
  utimesSync(lockPath, old, old);
  const inode = statSync(lockPath).ino;

  const again = await repo.run(['update', '--all']);
  expect(again.exit).toBe(0);
  expect(again.stdout).toBe('written  CLAUDE.md\nwritten  README.md\nwritten  docs/guide.md\n');
  expect(repo.read('docstamp-lock.yaml')).toBe(before);
  expect(statSync(lockPath).mtimeMs).toBe(old.getTime());
  expect(statSync(lockPath).ino).toBe(inode);

  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  expect(statSync(lockPath).mtimeMs).toBe(old.getTime());
});

scenario(
  '§11.3 a changed lock is replaced atomically, leaving no temp files',
  { fixture },
  async (repo) => {
    await repo.run(['update', '--all'], { expectExit: 0 });
    const old = new Date('2001-01-01T00:00:00Z');
    utimesSync(repo.path('docstamp-lock.yaml'), old, old);
    repo.append('src/util.ts', '// changed\n');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    expect(statSync(repo.path('docstamp-lock.yaml')).mtimeMs).toBeGreaterThan(old.getTime());
    expect(repo.list()).toEqual(ROOT_ENTRIES);
  },
);

scenario('§11.3 a lock checked out with CRLF counts as current', { fixture }, async (repo) => {
  await repo.run(['update', '--all'], { expectExit: 0 });
  const crlf = repo.read('docstamp-lock.yaml').replaceAll('\n', '\r\n');
  repo.write('docstamp-lock.yaml', crlf);
  expect((await repo.run([])).exit).toBe(0);
  await repo.run(['update', '--all'], { expectExit: 0 });
  expect(repo.read('docstamp-lock.yaml')).toBe(crlf);
});

scenario('§13.6 update removes entries that lost their Declaration', { fixture }, async (repo) => {
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.write('docstamp.yaml', config({ 'CLAUDE.md': ['src/**', '!src/**/*.test.ts'] }));

  const check = await repo.run([]);
  expect(check.exit).toBe(0);
  expect(check.stderr).toContain('warning: W_ORPHAN: README.md');
  expect(check.stderr).toContain('warning: W_ORPHAN: docs/guide.md');

  const update = await repo.run(['update', 'CLAUDE.md']);
  expect(update.stdout).toBe('written  CLAUDE.md\nremoved  README.md\nremoved  docs/guide.md\n');
  expect(update.stderr).toBe('');
  await repo.snapFile('docstamp-lock.yaml');
  const after = await repo.run([]);
  expect(after).toMatchObject({ exit: 0, stdout: '1 ok, 0 stale, 0 invalid\n', stderr: '' });
});

scenario('§14.5 update JSON adds written and removed', { fixture }, async (repo) => {
  const result = await repo.run(['update', '--json', 'CLAUDE.md']);
  expect(result.exit).toBe(0);
  expect(result.stderr).toBe('');
  const doc = result.json();
  expect(Object.keys(doc)).toEqual([
    'version',
    'mode',
    'exitCode',
    'summary',
    'files',
    'diagnostics',
    'removed',
  ]);
  expect(Object.keys(doc.files[0])).toEqual([
    'file',
    'state',
    'reasons',
    'dependencies',
    'changes',
    'diagnostics',
    'written',
  ]);
  expect(doc).toMatchObject({
    mode: 'update',
    exitCode: 0,
    summary: { ok: 1, stale: 0, invalid: 0 },
    removed: [],
  });
  expect(doc.files[0]).toMatchObject({
    file: 'CLAUDE.md',
    state: 'ok',
    reasons: [],
    written: true,
    changes: null,
  });
  const check = await repo.run(['--json', 'CLAUDE.md'], { snapshot: false });
  expect(check.json().files[0]).toMatchObject({ state: 'ok', reasons: [] });
  repo.append('src/util.ts', '// edit\n');
  const stale = await repo.run(['--json', 'CLAUDE.md'], { snapshot: false });
  expect(stale.json().files[0]).toMatchObject({ state: 'stale', reasons: ['content-changed'] });
  const again = await repo.run(['update', '--json', 'CLAUDE.md'], { snapshot: false });
  expect(again.json().files[0]).toMatchObject({ state: 'ok', reasons: [], written: true });
});

scenario(
  '§13.6 update refuses and writes nothing when a target is invalid',
  { fixture },
  async (repo) => {
    await repo.run(['update', 'README.md'], { expectExit: 0 });
    const lock = repo.read('docstamp-lock.yaml');
    repo.write(
      'docstamp.yaml',
      repo.read('docstamp.yaml') + '  GONE.md:\n    dependencies: [src/**]\n',
    );

    const named = await repo.run(['update', 'GONE.md', 'CLAUDE.md']);
    expect(named.exit).toBe(2);
    expect(named.stderr).toContain('E_FILE_MISSING');
    expect(repo.read('docstamp-lock.yaml')).toBe(lock);

    const all = await repo.run(['update', '--all']);
    expect(all.exit).toBe(2);
    expect(repo.read('docstamp-lock.yaml')).toBe(lock);

    const json = await repo.run(['update', '--json', 'GONE.md']);
    expect(json.exit).toBe(2);
    expect(json.json().files[0]).toMatchObject({
      file: 'GONE.md',
      state: 'invalid',
      written: false,
    });
    expect(json.json().files[0].diagnostics[0].code).toBe('E_FILE_MISSING');

    const fine = await repo.run(['update', 'CLAUDE.md']);
    expect(fine.exit).toBe(0);
  },
);

scenario('§13.6 update with an unknown file argument writes nothing', { fixture }, async (repo) => {
  const result = await repo.run(['update', 'CLAUDE.md', 'missing.md']);
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_UNKNOWN_FILE: missing.md');
  expect(repo.exists('docstamp-lock.yaml')).toBe(false);
});

scenario('§13.4 update resolves file arguments against cwd', { fixture }, async (repo) => {
  const fromSrc = await repo.run(['update', '../CLAUDE.md'], { cwd: 'src' });
  expect(fromSrc.exit).toBe(0);
  expect(fromSrc.stdout).toBe('written  CLAUDE.md\n');

  const fromDocs = await repo.run(['update', 'guide.md', '../README.md'], { cwd: 'docs' });
  expect(fromDocs.stdout).toBe('written  README.md\nwritten  docs/guide.md\n');

  const wrong = await repo.run(['update', 'docs/guide.md'], { cwd: 'docs' });
  expect(wrong.exit).toBe(2);
  expect(wrong.stderr).toContain('E_UNKNOWN_FILE: docs/guide.md');

  const absolute = await repo.run(['update', repo.path('CLAUDE.md')], { cwd: 'src' });
  expect(absolute.exit).toBe(0);
  await repo.snapFile('docstamp-lock.yaml');
});

scenario('§13.6 update --all recovers from a corrupt lock', { fixture }, async (repo) => {
  repo.write('docstamp-lock.yaml', 'garbage: [');
  const check = await repo.run([]);
  expect(check.exit).toBe(2);
  expect(check.stderr).toContain('E_LOCK');

  const named = await repo.run(['update', 'CLAUDE.md']);
  expect(named.exit).toBe(2);
  expect(repo.read('docstamp-lock.yaml')).toBe('garbage: [');

  expect((await repo.run(['update', '--all'])).exit).toBe(0);
  await repo.snapFile('docstamp-lock.yaml');
  expect(await repo.run([])).toMatchObject({ exit: 0, stdout: '3 ok, 0 stale, 0 invalid\n' });
});

scenario(
  '§11.1 conflict markers in the lock refuse update and stay untouched',
  { fixture },
  async (repo) => {
    await repo.run(['update', '--all'], { expectExit: 0 });
    const good = repo.read('docstamp-lock.yaml');
    const conflicted =
      '<<<<<<< HEAD\n' +
      good +
      '=======\n' +
      good.replace(/[0-9a-f]{64}/u, 'f'.repeat(64)) +
      '>>>>>>> feature\n';
    repo.write('docstamp-lock.yaml', conflicted);

    const check = await repo.run([]);
    expect(check.exit).toBe(2);
    expect(check.stderr).toContain('E_LOCK');
    expect(check.stderr).toContain('take either side');
    const update = await repo.run(['update', 'CLAUDE.md']);
    expect(update.exit).toBe(2);
    expect(update.stderr).toContain('E_LOCK');
    const listing = await repo.run(['list-dependents', 'src/util.ts']);
    expect(listing.exit).toBe(0);
    expect(repo.read('docstamp-lock.yaml')).toBe(conflicted);

    expect((await repo.run(['update', '--all'], { expectExit: 0 })).exit).toBe(0);
    expect(repo.read('docstamp-lock.yaml')).toBe(good);
  },
);
