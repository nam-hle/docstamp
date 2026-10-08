import { expect } from 'vitest';
import { config, scenario, type Repo } from '../harness/index.ts';

const fixture = 'renames';

async function reviewed(repo: Repo): Promise<void> {
  repo.commit('initial');
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.commit('review');
}

scenario('§12.1 renaming a dependency inside a dependency directory', { fixture }, async (repo) => {
  await reviewed(repo);
  repo.rename('src/lib/old-name.ts', 'src/lib/new-name.ts');
  const result = await repo.run([]);
  expect(result.exit).toBe(1);
  expect(result.stdout).toContain(
    'STALE    README.md  (content-changed)\n  renamed   src/lib/old-name.ts -> src/lib/new-name.ts\n',
  );
  expect(result.stdout).toContain(
    'STALE    docs/api.md  (content-changed)\n  renamed   src/lib/old-name.ts -> src/lib/new-name.ts\n',
  );
  expect(result.stdout).toContain('0 ok, 2 stale, 0 invalid');

  repo.commit('rename');
  const committed = await repo.run(['--json'], { label: 'rename committed' });
  expect(committed.json().files[0].changes).toEqual([
    { status: 'added', path: 'src/lib/new-name.ts', via: ['src/**'], pair: 'src/lib/old-name.ts' },
    {
      status: 'deleted',
      path: 'src/lib/old-name.ts',
      via: ['src/**'],
      pair: 'src/lib/new-name.ts',
    },
  ]);

  repo.append('src/lib/new-name.ts', 'edited after the move\n');
  const edited = await repo.run([], { label: 'renamed and edited' });
  expect(edited.stdout).toContain(
    'STALE    README.md  (content-changed)\n  added     src/lib/new-name.ts\n  deleted   src/lib/old-name.ts\n',
  );
  repo.git('checkout', '--', 'src/lib/new-name.ts');

  repo.rename('src/lib/new-name.ts', 'src/lib/old-name.ts');
  expect((await repo.run([], { label: 'renamed back' })).exit).toBe(0);
});

scenario('§12.1 moving a dependency out of every pattern', { fixture }, async (repo) => {
  await reviewed(repo);
  repo.rename('src/lib/keep.ts', 'elsewhere/keep.ts');
  const result = await repo.run([]);
  expect(result.exit).toBe(1);
  expect(result.stdout).toContain('  deleted   src/lib/keep.ts\n');
  expect(result.stdout).not.toContain('elsewhere');
});

scenario(
  '§9.4 renaming the stamped file itself is E_FILE_MISSING plus an orphan',
  { fixture },
  async (repo) => {
    await reviewed(repo);
    repo.rename('README.md', 'GUIDE.md');
    const result = await repo.run([]);
    expect(result.exit).toBe(2);
    expect(result.stdout).toContain('INVALID  README.md');
    expect(result.stdout).toContain('1 ok, 0 stale, 1 invalid');
    expect(result.stderr).toContain('error: E_FILE_MISSING: README.md');

    const list = await repo.run(['list-dependencies', 'README.md']);
    expect(list.exit).toBe(2);

    repo.write('docstamp.yaml', repo.read('docstamp.yaml').replace('README.md', 'GUIDE.md'));
    const renamedKey = await repo.run([], {
      label: 'config key renamed too',
      show: ['docstamp.yaml'],
    });
    expect(renamedKey.exit).toBe(1);
    expect(renamedKey.stdout).toContain('STALE    GUIDE.md  (unrecorded)');
    expect(renamedKey.stderr).toContain('warning: W_ORPHAN: README.md');

    const update = await repo.run(['update', 'GUIDE.md']);
    expect(update.stdout).toBe('written  GUIDE.md\nremoved  README.md\n');
    await repo.snapFile('docstamp-lock.yaml');
    expect((await repo.run([])).exit).toBe(0);
  },
);

scenario(
  '§12.1 a rename that changes nothing a pattern selects leaves the file ok',
  { fixture },
  async (repo) => {
    await reviewed(repo);
    repo.write('notes/draft.txt', 'outside every pattern\n');
    repo.rename('notes/draft.txt', 'notes/final.txt');
    const result = await repo.run([]);
    expect(result).toMatchObject({ exit: 0, stdout: '2 ok, 0 stale, 0 invalid\n' });
  },
);

scenario(
  '§12.7 E_EMPTY_PATTERN names the path a literal dependency was renamed to',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', config({ 'docs/api.md': ['src/lib/old-name.ts'] }));
    await reviewed(repo);
    const hint = 'git shows it renamed to src/lib/new-name.ts; depend on the new path.';
    repo.git('mv', 'src/lib/old-name.ts', 'src/lib/new-name.ts');
    const staged = await repo.run([], { label: 'renamed, not committed' });
    expect(staged.exit).toBe(2);
    expect(staged.stderr).toContain(`error: E_EMPTY_PATTERN: docs/api.md: src/lib/old-name.ts: `);
    expect(staged.stderr).toContain(hint);

    repo.commit('rename');
    const committed = await repo.run(['--json'], { label: 'renamed and committed' });
    expect(committed.exit).toBe(2);
    const empty = committed
      .json()
      .files[0].diagnostics.find((d: { code: string }) => d.code === 'E_EMPTY_PATTERN');
    expect(empty).toMatchObject({ subject: 'src/lib/old-name.ts' });
    expect(empty.message).toContain(hint);
    const listed = await repo.run(['list-dependencies'], { snapshot: false });
    expect(listed.stderr).toContain(hint);

    const shallow = repo.shallowClone('shallow');
    const fromShallow = await shallow.run([], { label: 'a shallow clone', snapshot: false });
    expect(fromShallow.exit).toBe(2);
    expect(fromShallow.stderr).toContain('E_EMPTY_PATTERN');
    expect(fromShallow.stderr).not.toContain('renamed');

    repo.append('src/lib/new-name.ts', 'edited after the move\n');
    const edited = await repo.run([], { label: 'renamed and edited' });
    expect(edited.exit).toBe(2);
    expect(edited.stderr).toContain(
      'error: E_EMPTY_PATTERN: docs/api.md: src/lib/old-name.ts: ' +
        'Correct or remove the pattern; it matches no file.\n',
    );
  },
);

scenario(
  '§12.7 without git the E_EMPTY_PATTERN message names no renamed path',
  { fixture, git: false },
  async (repo) => {
    repo.write('docstamp.yaml', config({ 'docs/api.md': ['src/lib/old-name.ts'] }));
    repo.rename('src/lib/old-name.ts', 'src/lib/new-name.ts');
    const result = await repo.run(['--root', '.']);
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain(
      'error: E_EMPTY_PATTERN: docs/api.md: src/lib/old-name.ts: ' +
        'Correct or remove the pattern; it matches no file.\n',
    );
  },
);

const numbered = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);

scenario(
  '§14.3 moving a directory: group lines, diagnostics under INVALID, capped next lines',
  async (repo) => {
    const stale = numbered('docs/stale-', 12).map((name) => `${name}.md`);
    const invalid = numbered('docs/invalid-', 11).map((name) => `${name}.md`);
    repo.write(
      'docstamp.yaml',
      config({
        ...Object.fromEntries(stale.map((name) => [name, ['src']])),
        ...Object.fromEntries(invalid.map((name) => [name, ['src/old']])),
      }),
    );
    for (const name of [...stale, ...invalid]) repo.write(name, `# ${name}\n`);
    for (const name of numbered('src/old/file-', 13)) repo.write(`${name}.ts`, `${name}\n`);
    repo.write('src/keep.ts', 'keep\n');
    await reviewed(repo);
    repo.git('mv', 'src/old', 'src/new');

    const text = await repo.run([]);
    expect(text.exit).toBe(2);
    expect(text.stdout.match(/^STALE {4}/gmu)).toHaveLength(12);
    expect(text.stdout.match(/^INVALID {2}/gmu)).toHaveLength(11);
    expect(text.stdout).toContain(
      'STALE    docs/stale-01.md  (content-changed)\n' +
        '  changed   13 renamed\n' +
        '  renamed   src/old/ -> src/new/  (13 files)\n',
    );
    expect(text.stdout).not.toContain('file-01.ts');
    expect(text.stdout).toContain('0 ok, 12 stale, 11 invalid\n');
    expect(text.stdout).toContain('docs/stale-10.md\n  and 2 more\n');
    expect(text.stdout).toContain('docs/invalid-10.md\n  and 1 more\n');
    expect(text.stderr.match(/^error: E_EMPTY_PATTERN: /gmu)).toHaveLength(11);

    const alone = await repo.run(['docs/stale-01.md', 'docs/invalid-01.md'], {
      label: 'two files named',
    });
    expect(alone.stdout).not.toContain(' more');

    const json = await repo.run(['--json', 'docs/stale-01.md']);
    expect(json.json().files[0].changes).toHaveLength(26);
  },
);
