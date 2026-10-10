import { expect } from 'vitest';
import { config, scenario, type Repo } from './harness/index.ts';

const fixture = 'docs-site';
const CLAUDE = { 'CLAUDE.md': ['src/**', '!src/**/*.test.ts'] };

async function reviewedRepo(repo: Repo): Promise<string> {
  repo.write('docstamp.yaml', config(CLAUDE));
  repo.remove('README.md');
  repo.remove('docs/guide.md');
  repo.write('src/c.ts', 'c\n');
  repo.write('src/d.ts', 'd\n');
  repo.commit('initial');
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  return repo.commit('review');
}

function changeEverything(repo: Repo): void {
  repo.append('src/util.ts', 'more\n');
  repo.write('src/new.ts', 'n\n');
  repo.remove('src/c.ts');
  repo.commit('edits');
  repo.append('src/d.ts', 'more\n');
  repo.write('src/untracked.ts', 'u\n');
}

const expectedText = (base: string) =>
  'STALE    CLAUDE.md  (content-changed)\n' +
  '  changed   2 modified, 2 added, 1 deleted\n' +
  '  deleted   src/c.ts\n' +
  '  modified  src/d.ts\n' +
  '  added     src/new.ts\n' +
  '  added     src/untracked.ts\n' +
  '  modified  src/util.ts\n' +
  `  review: git diff -M ${base} -- src/c.ts src/d.ts src/new.ts src/untracked.ts src/util.ts\n` +
  '  untracked: git add -N -- src/untracked.ts\n' +
  '0 ok, 1 stale, 0 invalid\n';

scenario(
  '§12.3 ChangedSince lists modified, added and deleted files, committed or not',
  { fixture },
  async (repo) => {
    const base = await reviewedRepo(repo);
    changeEverything(repo);

    const text = await repo.run([]);
    expect(text.exit).toBe(1);
    expect(text.stdout.startsWith(expectedText(base))).toBe(true);
    expect(text.stdout).not.toContain('depends');
    expect(text.stderr).toBe('');

    const json = await repo.run(['--json']);
    expect(json.json().files[0].changes).toEqual([
      { status: 'deleted', path: 'src/c.ts', via: ['src/**'] },
      { status: 'modified', path: 'src/d.ts', via: ['src/**'] },
      { status: 'added', path: 'src/new.ts', via: ['src/**'] },
      { status: 'added', path: 'src/untracked.ts', via: ['src/**'] },
      { status: 'modified', path: 'src/util.ts', via: ['src/**'] },
    ]);
    expect('resolvedFiles' in json.json().files[0]).toBe(false);
  },
);

scenario(
  '§12.3 outside a git work tree the report falls back to depends lines',
  { fixture: 'no-git', git: false },
  async (repo) => {
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    repo.append('src/a.ts', 'more\n');
    const result = await repo.run([]);
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('  depends   src/**\n');
    expect(result.stderr).toBe('');
    expect((await repo.run(['--json'])).json().files[0].changes).toBeNull();
  },
);

scenario('§5.4 Changes is null for ok and unrecorded files', { fixture }, async (repo) => {
  await reviewedRepo(repo);
  const ok = await repo.run(['--json']);
  expect(ok.json().files[0]).toMatchObject({ state: 'ok', changes: null });
  repo.write('docstamp.yaml', config({ ...CLAUDE, 'docs/new.md': ['src/**'] }));
  repo.write('docs/new.md', '# new\n');
  const unrecorded = await repo.run(['--json']);
  const entry = unrecorded.json().files.find((f: { file: string }) => f.file === 'docs/new.md');
  expect(entry).toMatchObject({ state: 'stale', reasons: ['unrecorded'], changes: null });
});

scenario(
  '§12.3 a sibling that removed the same Hash later is ignored',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', config({ ...CLAUDE, 'B.md': ['src/**'] }));
    repo.write('B.md', '# b\n');
    repo.remove('README.md');
    repo.remove('docs/guide.md');
    repo.commit('initial');
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.commit('review');
    repo.append('src/util.ts', 'x\n');
    repo.commit('x');
    repo.append('src/index.ts', 'y\n');
    await repo.run(['update', 'B.md'], { expectExit: 0 });
    repo.commit('review b');
    repo.write('src/z.ts', 'z\n');
    const doc = (await repo.run(['--json'])).json();
    const claude = doc.files.find((f: { file: string }) => f.file === 'CLAUDE.md');
    expect(claude.changes).toEqual([
      { status: 'modified', path: 'src/index.ts', via: ['src/**'] },
      { status: 'modified', path: 'src/util.ts', via: ['src/**'] },
      { status: 'added', path: 'src/z.ts', via: ['src/**'] },
    ]);
  },
);

scenario(
  '§12.3 a version 1 or 2 lock in history reads as absent, never an error',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    const v3 = repo.read('docstamp-lock.yaml');
    const hash = /[0-9a-f]{64}/u.exec(v3)![0];
    repo.write('docstamp-lock.yaml', `version: 2\ndependents:\n  "CLAUDE.md": ${hash}\n`);
    repo.commit('lock as version 2');
    repo.write('docstamp-lock.yaml', v3);
    repo.commit('lock as version 3 again');
    repo.append('src/util.ts', 'more\n');
    const result = await repo.run([]);
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('  modified  src/util.ts\n');
    expect(result.stderr).toBe('');
  },
);

scenario(
  '§12.3 only a legacy docsync.lock holding the Hash yields unknown, not an error',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', config(CLAUDE));
    repo.remove('README.md');
    repo.remove('docs/guide.md');
    repo.commit('initial');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    const hash = /[0-9a-f]{64}/u.exec(repo.read('docstamp-lock.yaml'))![0];
    repo.remove('docstamp-lock.yaml');
    repo.write('docsync.lock', `version: 1\ndependents:\n  CLAUDE.md:\n    hash: ${hash}\n`);
    repo.commit('legacy');
    repo.remove('docsync.lock');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    repo.append('src/util.ts', 'more\n');
    const result = await repo.run([]);
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('  depends   src/**\n');
    expect(result.stderr).toBe('');
  },
);

scenario('§14.2 a changed path with a space is quoted', { fixture }, async (repo) => {
  repo.write('src/my file.ts', 'm\n');
  await reviewedRepo(repo);
  repo.append('src/my file.ts', 'more\n');
  const result = await repo.run([]);
  expect(result.stdout).toContain('  modified  "src/my file.ts"\n');
});

scenario(
  '§12.3 step 6 and 7: via names the patterns, whitespaceOnly flags a change of white space',
  { fixture },
  async (repo) => {
    repo.write(
      'docstamp.yaml',
      config({ ...CLAUDE, 'NOTES.md': ['src', 'src/d.ts', '!src/c.ts'] }),
    );
    repo.write('NOTES.md', '# notes\n');
    repo.remove('README.md');
    repo.remove('docs/guide.md');
    repo.write('src/c.ts', 'c\n');
    repo.write('src/d.ts', 'd\n');
    repo.write('src/e.ts', 'let e = 1;\nlet f = 2;\n');
    repo.write('src/crlf.txt', 'one\ntwo\n');
    repo.commit('initial');
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.commit('review');

    repo.write('src/e.ts', '  let e = 1;   \n\n\n\tlet f = 2;\n');
    repo.write('src/crlf.txt', 'one\r\ntwo\r\n');
    repo.append('src/d.ts', 'more\n');
    repo.write('src/c.ts', 'c\n\n');
    const text = await repo.run([]);
    expect(text.exit).toBe(1);
    expect(text.stdout).toContain(
      'STALE    CLAUDE.md  (content-changed)\n' +
        '  modified  src/c.ts (whitespace only)\n' +
        '  modified  src/crlf.txt (whitespace only)\n' +
        '  modified  src/d.ts\n' +
        '  modified  src/e.ts (whitespace only)\n' +
        '  review: ',
    );
    expect(text.stdout).toContain(
      'STALE    NOTES.md  (content-changed)\n' +
        '  modified  src/crlf.txt (whitespace only)\n' +
        '  modified  src/d.ts\n' +
        '  modified  src/e.ts (whitespace only)\n' +
        '  review: ',
    );
    expect(text.stdout).not.toContain('via');

    const doc = (await repo.run(['--json'])).json();
    const byFile = (file: string) => doc.files.find((f: { file: string }) => f.file === file);
    expect(byFile('CLAUDE.md').changes).toEqual([
      { status: 'modified', path: 'src/c.ts', via: ['src/**'], whitespaceOnly: true },
      { status: 'modified', path: 'src/crlf.txt', via: ['src/**'], whitespaceOnly: true },
      { status: 'modified', path: 'src/d.ts', via: ['src/**'] },
      { status: 'modified', path: 'src/e.ts', via: ['src/**'], whitespaceOnly: true },
    ]);
    expect(byFile('NOTES.md').changes).toEqual([
      { status: 'modified', path: 'src/crlf.txt', via: ['src'], whitespaceOnly: true },
      { status: 'modified', path: 'src/d.ts', via: ['src', 'src/d.ts'] },
      { status: 'modified', path: 'src/e.ts', via: ['src'], whitespaceOnly: true },
    ]);
  },
);

scenario(
  '§12.3 step 7: a change of file mode is never whitespace only',
  // No POSIX mode bits on Windows.
  { fixture, skipIf: process.platform === 'win32' },
  async (repo) => {
    repo.write('docstamp.yaml', config(CLAUDE));
    repo.remove('README.md');
    repo.remove('docs/guide.md');
    repo.write('src/d.ts', 'd\n');
    repo.write('src/mode.sh', 'echo\n');
    repo.commit('initial');
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.commit('review');

    // The Dependency Hash reads content, not mode (§10.2): an edit makes the file stale.
    repo.append('src/d.ts', 'more\n');
    repo.chmod('src/mode.sh', 0o755);
    const text = await repo.run([]);
    expect(text.exit).toBe(1);
    expect(text.stdout).toContain(
      'STALE    CLAUDE.md  (content-changed)\n' +
        '  modified  src/d.ts\n' +
        '  modified  src/mode.sh\n',
    );
    expect(text.stdout).not.toContain('whitespace only');

    const doc = (await repo.run(['--json'])).json();
    expect(doc.files[0].changes).toEqual([
      { status: 'modified', path: 'src/d.ts', via: ['src/**'] },
      { status: 'modified', path: 'src/mode.sh', via: ['src/**'] },
    ]);
  },
);

scenario(
  '§12.3 step 1.4 an edited own list is reported, and the Reason stays content-changed',
  { fixture },
  async (repo) => {
    const base = await reviewedRepo(repo);
    repo.write(
      'docstamp.yaml',
      config({ 'CLAUDE.md': ['src/**', '!src/**/*.test.ts', '!src/c.ts'] }),
    );
    const removed = await repo.run([], { label: 'a pattern narrowed', show: ['docstamp.yaml'] });
    expect(removed.exit).toBe(1);
    expect(removed.stdout).toContain(
      'STALE    CLAUDE.md  (content-changed)\n' +
        '  edited    docstamp.yaml  (dependency list)\n' +
        '  removed   src/c.ts  (selection)\n' +
        `  review: git diff -M ${base} -- docstamp.yaml\n`,
    );
    const json = (await repo.run(['--json'])).json().files[0];
    expect(json).toMatchObject({
      reasons: ['content-changed'],
      changes: [],
      dependenciesEdited: true,
      selection: [{ status: 'removed', path: 'src/c.ts' }],
    });

    repo.append('src/util.ts', 'more\n');
    const both = await repo.run([], { label: 'and a dependency changed' });
    expect(both.stdout).toContain(
      '  edited    docstamp.yaml  (dependency list)\n' +
        '  removed   src/c.ts  (selection)\n' +
        '  modified  src/util.ts\n' +
        `  review: git diff -M ${base} -- src/util.ts docstamp.yaml\n`,
    );

    repo.write('docstamp.yaml', config(CLAUDE));
    const restored = await repo.run(['--json'], { label: 'own list restored' });
    expect(restored.json().files[0]).not.toHaveProperty('dependenciesEdited');
  },
);

scenario('§12.3 step 1.4 an inline file whose block lost a pattern', async (repo) => {
  const block = (deps: string[]) =>
    `---\ndocstamp:\n  dependencies:\n${deps.map((d) => `    - ${d}\n`).join('')}---\n# Guide\n`;
  repo.write('src/a.ts', 'a\n');
  repo.write('src/b.ts', 'b\n');
  repo.write('guide.md', block(['src/a.ts', 'src/b.ts']));
  repo.commit('initial');
  await repo.run(['update', 'guide.md'], { expectExit: 0 });
  const base = repo.commit('review');
  repo.write('guide.md', repo.read('guide.md').replace('    - src/b.ts\n', ''));
  const result = await repo.run([]);
  expect(result.exit).toBe(1);
  expect(result.stdout).toContain(
    'STALE    guide.md  (content-changed)\n' +
      '  edited    guide.md  (dependency list)\n' +
      '  removed   src/b.ts  (selection)\n' +
      `  review: git diff -M ${base} -- guide.md\n`,
  );
});

scenario(
  '§12.3 step 10 a dropped exclusion lists the files that entered the selection',
  async (repo) => {
    const exclusion = '    - "!**/*.test.ts"\n';
    repo.write('packages/a/src/x.ts', 'x\n');
    repo.write('packages/a/src/x.test.ts', 'x test\n');
    repo.write('packages/b/y.test.ts', 'y test\n');
    repo.write(
      'docs/guide.md',
      `---\ndocstamp:\n  dependencies:\n    - packages\n${exclusion}---\n# Guide\n`,
    );
    repo.commit('initial');
    await repo.run(['update', 'docs/guide.md'], { expectExit: 0 });
    const base = repo.commit('review');
    repo.write('docs/guide.md', repo.read('docs/guide.md').replace(exclusion, ''));
    repo.remove('packages/b/y.test.ts');
    const text = await repo.run([], { show: ['docs/guide.md'] });
    expect(text.exit).toBe(1);
    expect(text.stdout).toContain(
      'STALE    docs/guide.md  (content-changed)\n' +
        '  edited    docs/guide.md  (dependency list)\n' +
        '  added     packages/a/src/x.test.ts  (selection)\n' +
        '  deleted   packages/b/y.test.ts\n' +
        `  review: git diff -M ${base} -- packages/b/y.test.ts docs/guide.md\n`,
    );
    const json = (await repo.run(['--json'])).json().files[0];
    expect(json.changes).toEqual([
      { status: 'deleted', path: 'packages/b/y.test.ts', via: ['packages'] },
    ]);
    // a deleted file cannot be resolved against the Universe of now (§12.3 step 10 NOTE)
    expect(json.selection).toEqual([{ status: 'added', path: 'packages/a/src/x.test.ts' }]);
  },
);
