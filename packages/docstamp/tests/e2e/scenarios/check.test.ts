import { expect } from 'vitest';
import { scenario } from '../harness/index.ts';

const fixture = 'docs-site';

scenario(
  '§13 workflow: unrecorded, update, ok, edit, stale, update, ok',
  { fixture },
  async (repo) => {
    const first = await repo.run([]);
    expect(first.exit).toBe(1);
    expect(first.stdout).toContain('STALE    CLAUDE.md  (unrecorded)');
    expect(first.stdout).toContain('0 ok, 3 stale, 0 invalid');
    expect(first.stderr).toBe('');

    const update = await repo.run(['update', '--all']);
    expect(update.exit).toBe(0);
    expect(update.stdout).toBe('written  CLAUDE.md\nwritten  README.md\nwritten  docs/guide.md\n');
    await repo.snapFile('docstamp-lock.yaml');

    const ok = await repo.run([]);
    expect(ok).toMatchObject({ exit: 0, stdout: '3 ok, 0 stale, 0 invalid\n', stderr: '' });

    repo.append('src/util.ts', 'export const triple = (n: number): number => n * 3;\n');
    const stale = await repo.run([]);
    expect(stale.exit).toBe(1);
    expect(stale.stdout).toContain('STALE    CLAUDE.md  (content-changed)\n  depends   src/**\n');
    expect(stale.stdout).toContain('2 ok, 1 stale, 0 invalid');
    expect(stale.stdout).toContain('next: review each stale file against its dependencies');
    expect(stale.stdout).toContain('docstamp update CLAUDE.md\n  run update only after the review');

    const rewritten = await repo.run(['update', 'CLAUDE.md']);
    expect(rewritten.stdout).toBe('written  CLAUDE.md\n');
    await repo.snapFile('docstamp-lock.yaml', 'lock after update CLAUDE.md');
    expect((await repo.run([])).exit).toBe(0);
  },
);

scenario('§12.1 reasons: unrecorded and content-changed together', { fixture }, async (repo) => {
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  repo.append('src/util.ts', '// changed\n');
  const text = await repo.run([]);
  expect(text.exit).toBe(1);
  expect(text.stdout).toContain('STALE    CLAUDE.md  (content-changed)');
  expect(text.stdout).toContain('STALE    README.md  (unrecorded)');
  expect(text.stdout).toContain('STALE    docs/guide.md  (unrecorded)');
  const doc = (await repo.run(['--json'])).json();
  expect(doc.files.map((f: { reasons: string[] }) => f.reasons)).toEqual([
    ['content-changed'],
    ['unrecorded'],
    ['unrecorded'],
  ]);
});

scenario('§12.1 what changes a verdict in a dependency', { fixture }, async (repo) => {
  await repo.run(['update', '--all'], { expectExit: 0 });
  const verdict = async (label: string, exit: number) => {
    const result = await repo.run(['--json'], { snapshot: false });
    expect(result.exit, label).toBe(exit);
    return result.json();
  };

  repo.append('CLAUDE.md', 'edited itself\n');
  await verdict('editing the stamped file itself', 0);

  repo.append('src/util.test.ts', '// excluded by the negation\n');
  await verdict('editing a negated file', 0);

  repo.write('src/new.ts', 'export const added = 1;\n');
  const added = await verdict('a new file selected by the patterns', 1);
  expect(added.files[0].reasons).toEqual(['content-changed']);
  await repo.run([]);

  repo.remove('src/new.ts');
  await verdict('deleting the new file restores the old verdict', 0);

  repo.remove('src/util.ts');
  await verdict('deleting a dependency', 1);
  await repo.run([]);
  repo.write('src/util.ts', 'export const double = (n: number): number => n * 2;\n');
  await verdict('restoring identical content', 0);

  repo.rename('src/util.ts', 'src/helpers.ts');
  await verdict('renaming a dependency', 1);
  await repo.run([]);
});

scenario('§13.3 selecting a subset of files in check', { fixture }, async (repo) => {
  await repo.run(['update', 'CLAUDE.md', 'README.md'], { expectExit: 0 });
  repo.append('src/index.ts', '// changed\n');

  const all = await repo.run([]);
  expect(all.exit).toBe(1);
  expect(all.stdout).toContain('0 ok, 3 stale, 0 invalid');

  const one = await repo.run(['CLAUDE.md']);
  expect(one.exit).toBe(1);
  expect(one.stdout).toContain('1 stale');
  expect(one.stdout).not.toContain('README.md  (');

  const unchanged = await repo.run(['check', 'docs/guide.md']);
  expect(unchanged.stdout).toContain('docs/guide.md  (unrecorded)');

  const two = await repo.run(['README.md', 'CLAUDE.md', 'README.md']);
  expect(two.stdout).toContain('0 ok, 2 stale, 0 invalid');
  expect(two.stdout.indexOf('CLAUDE.md')).toBeLessThan(two.stdout.indexOf('README.md'));

  const unknown = await repo.run(['CLAUDE.md', 'nope.md']);
  expect(unknown.exit).toBe(2);
  expect(unknown.stderr).toContain('E_UNKNOWN_FILE');
  expect(unknown.stderr).toContain('nope.md');
  expect(unknown.stdout).toBe('');

  const notStamped = await repo.run(['src/util.ts']);
  expect(notStamped.exit).toBe(2);
  expect(notStamped.stderr).toContain('E_UNKNOWN_FILE: src/util.ts');

  const json = await repo.run(['--json', 'README.md']);
  expect(json.json().files).toHaveLength(1);
});

scenario('§14.5 check JSON has the documented shape', { fixture }, async (repo) => {
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  repo.append('src/util.ts', '// changed\n');
  const result = await repo.run(['--json']);
  const doc = result.json();
  expect(Object.keys(doc)).toEqual([
    'version',
    'mode',
    'exitCode',
    'summary',
    'files',
    'diagnostics',
  ]);
  expect(doc).toMatchObject({
    version: 2,
    mode: 'check',
    exitCode: 1,
    summary: { ok: 0, stale: 3, invalid: 0 },
    diagnostics: [],
  });
  expect(Object.keys(doc.files[0])).toEqual([
    'file',
    'state',
    'reasons',
    'dependencies',
    'changes',
    'diagnostics',
  ]);
  expect(doc.files[0]).toMatchObject({
    file: 'CLAUDE.md',
    state: 'stale',
    reasons: ['content-changed'],
    dependencies: ['src/**', '!src/**/*.test.ts'],
    changes: null,
    diagnostics: [],
  });
  expect(result.stdout.endsWith('}\n')).toBe(true);
  expect(result.stderr).toBe('');
});

scenario('§14.1 report on stdout, diagnostics on stderr', { fixture }, async (repo) => {
  repo.write(
    'docstamp.yaml',
    repo.read('docstamp.yaml') + '  GONE.md:\n    dependencies: [src/**]\n',
  );
  const text = await repo.run([]);
  expect(text.exit).toBe(2);
  expect(text.stdout).toContain('INVALID  GONE.md');
  expect(text.stdout).not.toContain('E_FILE_MISSING');
  expect(text.stderr).toContain('error: E_FILE_MISSING: GONE.md');
  expect(text.stderr).not.toContain('STALE');

  const json = await repo.run(['--json']);
  expect(json.stderr).toBe('');
  expect(json.json().files[1]).toMatchObject({ file: 'GONE.md', state: 'invalid' });
});

scenario('§13.5 explicit check equals bare check', { fixture }, async (repo) => {
  const bare = await repo.run([]);
  const explicit = await repo.run(['check']);
  expect(explicit).toMatchObject({ exit: bare.exit, stdout: bare.stdout, stderr: bare.stderr });
});

scenario(
  '§13.5 --only-stale leaves the ok files out of the JSON list, --quiet out of success',
  { fixture },
  async (repo) => {
    await repo.run(['update', '--all'], { expectExit: 0 });

    const quietOk = await repo.run(['--quiet'], { label: 'quiet, everything ok' });
    expect(quietOk).toMatchObject({ exit: 0, stdout: '', stderr: '' });
    const onlyOk = await repo.run(['--json', '--only-stale'], { label: 'only stale, all ok' });
    expect(onlyOk.json().files).toEqual([]);
    expect(onlyOk.json().summary).toEqual({ ok: 3, stale: 0, invalid: 0 });

    repo.append('src/util.ts', 'export const triple = (n: number): number => n * 3;\n');
    const plain = await repo.run([], { label: 'plain, one stale' });
    const quiet = await repo.run(['--quiet'], { label: 'quiet, one stale' });
    expect(quiet).toMatchObject({ exit: 1, stdout: plain.stdout, stderr: '' });
    const only = await repo.run(['--json', '--only-stale'], { label: 'only stale, one stale' });
    expect(only.exit).toBe(1);
    expect(only.json().files.map((f: { file: string }) => f.file)).toEqual(['CLAUDE.md']);
    expect(only.json().summary).toEqual({ ok: 2, stale: 1, invalid: 0 });
    const full = await repo.run(['--json'], { snapshot: false });
    expect(full.json().files).toHaveLength(3);
    const text = await repo.run(['--only-stale'], { label: 'only stale in text mode' });
    expect(text.stdout).toBe(plain.stdout);

    const withJson = await repo.run(['--json', '--quiet'], {
      label: 'quiet has no effect on json',
    });
    expect(withJson.json()).toEqual(full.json());
  },
);

scenario(
  '§13.5 --quiet still reports an invalid file, and --only-stale keeps it',
  { fixture },
  async (repo) => {
    repo.write(
      'docstamp.yaml',
      repo.read('docstamp.yaml') + '  GONE.md:\n    dependencies: [src/**]\n',
    );
    const result = await repo.run(['--quiet']);
    expect(result.exit).toBe(2);
    expect(result.stdout).toContain('INVALID  GONE.md\n');
    expect(result.stdout).toContain('0 ok, 3 stale, 1 invalid\n');
    expect(result.stderr).toContain('error: E_FILE_MISSING: GONE.md');
    const only = await repo.run(['--json', '--only-stale']);
    expect(only.json().files.map((f: { state: string }) => f.state)).toEqual([
      'stale',
      'invalid',
      'stale',
      'stale',
    ]);
  },
);
