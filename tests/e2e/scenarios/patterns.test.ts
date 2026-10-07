import { expect } from 'vitest';
import { config, scenario, type Repo } from '../harness/index.ts';

const fixture = 'patterns';

const staleFiles = async (repo: Repo, label: string): Promise<string[]> => {
  const result = await repo.run(['--json'], { label, snapshot: false });
  expect(result.exit, label).toBeLessThanOrEqual(1);
  return result
    .json()
    .files.filter((f: { state: string }) => f.state === 'stale')
    .map((f: { file: string }) => f.file);
};

scenario('§8 which declarations notice which edit', { fixture }, async (repo) => {
  await repo.run(['update', '--all'], { expectExit: 0 });
  const edit = async (path: string, label: string, expected: string[]) => {
    repo.append(path, '// edit\n');
    expect(await staleFiles(repo, label), label).toEqual(expected);
    await repo.run(['update', '--all'], { expectExit: 0 });
  };

  await edit('src/c.ts', '** reaches c.ts', ['docs/all.md', 'docs/negation.md']);
  await edit('src/b.ts', '{a,b} reaches b.ts', [
    'docs/all.md',
    'docs/alternation.md',
    'docs/negation.md',
  ]);
  await edit('src/a.test.ts', 'negation hides a test file', ['docs/all.md']);
  await edit('src/lib/x.ts', 'directory pattern reaches a nested file', [
    'docs/all.md',
    'docs/directory.md',
    'docs/negation.md',
  ]);
  await edit('src/lib/y.test.ts', 'directory pattern has no negation', [
    'docs/all.md',
    'docs/directory.md',
  ]);
  await edit('docs/extra.md', 'a second pattern', ['docs/two.md']);
  await edit('src/a.ts', 'a.ts is in several declarations', [
    'docs/all.md',
    'docs/alternation.md',
    'docs/negation.md',
    'docs/two.md',
  ]);
  const ok = await repo.run([], { label: 'all reviewed again' });
  expect(ok.stdout).toBe('5 ok, 0 stale, 0 invalid\n');
});

scenario(
  '§8.5 deleting everything a pattern selects makes the file invalid',
  { fixture },
  async (repo) => {
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.remove('src/lib');
    const result = await repo.run([], { label: 'src/lib deleted' });
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('error: E_EMPTY_DEPENDENCIES: docs/directory.md');
    expect(result.stderr).toContain('error: E_EMPTY_PATTERN: docs/directory.md: src/lib');
    expect(result.stdout).toContain('INVALID  docs/directory.md');
    expect(result.stdout).toContain('STALE    docs/all.md  (content-changed)');

    const list = await repo.run(['list-dependencies', 'docs/directory.md'], {
      label: 'same, listing',
    });
    expect(list.exit).toBe(2);

    const update = await repo.run(['update', 'docs/directory.md'], { label: 'update refuses' });
    expect(update.exit).toBe(2);
  },
);

scenario(
  '§8.5 one dead pattern among live ones is E_EMPTY_PATTERN only',
  { fixture },
  async (repo) => {
    repo.remove('docs/extra.md');
    const result = await repo.run([], { label: 'docs/extra.md deleted' });
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('error: E_EMPTY_PATTERN: docs/two.md: docs/extra.md');
    expect(result.stderr).not.toContain('E_EMPTY_DEPENDENCIES');
  },
);

scenario('§8.4 the last matching pattern wins, so a later pattern re-selects', async (repo) => {
  repo.write('DOC.md', '# doc\n');
  for (const file of ['src/a.ts', 'src/lib/x.ts', 'src/lib/y.ts']) repo.write(file, 'x\n');
  const resolvedBy = async (patterns: string[]) => {
    repo.write('docstamp.yaml', config({ 'DOC.md': patterns }));
    const result = await repo.run(['list-dependencies', '--json'], {
      label: patterns.join(' '),
      show: ['docstamp.yaml'],
    });
    return result.json().files[0].resolvedFiles as string[];
  };
  expect(await resolvedBy(['src/**', '!src/lib', 'src/lib/x.ts'])).toEqual([
    'src/a.ts',
    'src/lib/x.ts',
  ]);
  expect(await resolvedBy(['src/lib/x.ts', 'src/**', '!src/lib'])).toEqual(['src/a.ts']);
  expect(await resolvedBy(['src/*/*.ts', '!**/y.ts'])).toEqual(['src/lib/x.ts']);
  expect(await resolvedBy(['**/*.ts', '!src/a.ts', 'src/?.ts'])).toEqual([
    'src/a.ts',
    'src/lib/x.ts',
    'src/lib/y.ts',
  ]);
  expect(await resolvedBy(['src/[a-b].ts', 'src/lib/[!y].ts'])).toEqual([
    'src/a.ts',
    'src/lib/x.ts',
  ]);
  expect(await resolvedBy(['src/lib/*', '!src/lib/*.ts', 'src/lib/y.ts'])).toEqual([
    'src/lib/y.ts',
  ]);
});

scenario('§8.1 escapes make special characters literal', async (repo) => {
  repo.write('DOC.md', '# doc\n');
  repo.write('src/a*b.ts', 'star\n');
  repo.write('src/axb.ts', 'x\n');
  repo.write('src/[id].ts', 'bracket\n');
  repo.write('docstamp.yaml', config({ 'DOC.md': ['src/a\\*b.ts', 'src/\\[id\\].ts'] }));
  const result = await repo.run(['list-dependencies', '--json'], { show: ['docstamp.yaml'] });
  expect(result.json().files[0].resolvedFiles).toEqual(['src/[id].ts', 'src/a*b.ts']);
});

scenario('§14.2 paths with special characters are quoted in text and in lists', async (repo) => {
  repo.write('DOC.md', '# doc\n');
  repo.write('src/with space.ts', 's\n');
  repo.write('src/paren(1).ts', 'p\n');
  repo.write('src/tab\there.ts', 't\n');
  repo.write('src/quote"d.ts', 'q\n');
  repo.write('src/plain.ts', 'plain\n');
  repo.write('src/ünï.ts', 'unicode\n');
  repo.write('docstamp.yaml', config({ 'DOC.md': ['src/**'] }));
  const result = await repo.run(['list-dependencies'], { show: ['docstamp.yaml'] });
  expect(result.stdout).toContain('  resolved  "src/with space.ts"\n');
  expect(result.stdout).toContain('  resolved  "src/paren(1).ts"\n');
  expect(result.stdout).toContain('  resolved  "src/tab\\there.ts"\n');
  expect(result.stdout).toContain('  resolved  "src/quote\\"d.ts"\n');
  expect(result.stdout).toContain('  resolved  src/plain.ts\n');
  expect(result.stdout).toContain('  resolved  src/ünï.ts\n');
  const json = await repo.run(['list-dependencies', '--json']);
  expect(json.stdout).toContain('"src/tab\\there.ts"');
  expect(json.json().files[0].resolvedFiles).toContain('src/quote"d.ts');
});

scenario('§3.3 path order is by UTF-16 code unit, not by locale', async (repo) => {
  repo.write('DOC.md', '# doc\n');
  for (const name of ['B.ts', 'a.ts', 'Z.ts', '_.ts', 'é.ts', 'e.ts', '10.ts', '9.ts']) {
    repo.write(`src/${name}`, `${name}\n`);
  }
  repo.write('docstamp.yaml', config({ 'DOC.md': ['src/**'] }));
  const result = await repo.run(['list-dependencies', '--json'], {
    env: { LC_ALL: 'sv_SE.UTF-8', LANG: 'sv_SE.UTF-8' },
  });
  expect(result.json().files[0].resolvedFiles).toEqual([
    'src/10.ts',
    'src/9.ts',
    'src/B.ts',
    'src/Z.ts',
    'src/_.ts',
    'src/a.ts',
    'src/e.ts',
    'src/é.ts',
  ]);
});

const WARNING =
  'warning: W_EMPTY_EXCLUSION: docs/all.md: !src/**/__test__/**: ' +
  'The exclusion matches no file, so it excludes nothing; remove it, or keep it for later.\n';

scenario(
  '§8.5 an exclusion that matches nothing is a warning and never changes the verdict',
  { fixture },
  async (repo) => {
    repo.write(
      'docstamp.yaml',
      config({
        'docs/all.md': ['src/**', '!src/**/__test__/**'],
        'docs/negation.md': ['src/**', '!src/**/*.test.ts'],
      }),
    );
    const first = await repo.run([], { label: 'no __test__ folder yet', show: ['docstamp.yaml'] });
    expect(first.exit).toBe(1);
    expect(first.stderr).toBe(WARNING);
    expect(first.stdout).toContain('STALE    docs/all.md  (unrecorded)');

    const update = await repo.run(['update', '--all'], { expectExit: 0 });
    expect(update.stderr).toBe(WARNING);

    const ok = await repo.run([], { label: 'reviewed, the warning stays' });
    expect([ok.exit, ok.stdout, ok.stderr]).toEqual([0, '2 ok, 0 stale, 0 invalid\n', WARNING]);

    const json = await repo.run(['--json'], { label: 'json carries the warning on the file' });
    expect(json.exit).toBe(0);
    expect(json.stderr).toBe('');
    const doc = json.json();
    expect(doc.exitCode).toBe(0);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.files.map((f: { state: string }) => f.state)).toEqual(['ok', 'ok']);
    expect(doc.files[0].diagnostics).toEqual([
      {
        code: 'W_EMPTY_EXCLUSION',
        severity: 'warning',
        file: 'docs/all.md',
        subject: '!src/**/__test__/**',
        message: expect.any(String),
      },
    ]);
    expect(doc.files[1].diagnostics).toEqual([]);

    repo.write('src/lib/__test__/t.ts', 'a test\n');
    const present = await repo.run([], { label: 'the folder appears, the exclusion works' });
    expect([present.exit, present.stdout, present.stderr]).toEqual([
      1,
      expect.stringContaining('STALE    docs/negation.md  (content-changed)'),
      '',
    ]);
    expect(present.stdout).not.toContain('docs/all.md');

    repo.remove('src/lib/__test__');
    const gone = await repo.run([], { label: 'the folder is deleted again: ok, not invalid' });
    expect([gone.exit, gone.stdout, gone.stderr]).toEqual([
      0,
      '2 ok, 0 stale, 0 invalid\n',
      WARNING,
    ]);

    const list = await repo.run(['list-dependencies', '--json', 'docs/all.md'], {
      label: 'list-dependencies shows it too',
    });
    expect(list.exit).toBe(0);
    expect(list.json().files[0].diagnostics.map((d: { code: string }) => d.code)).toEqual([
      'W_EMPTY_EXCLUSION',
    ]);
  },
);

scenario(
  '§8.5 a file whose patterns select nothing stays E_EMPTY_DEPENDENCIES, with the warning',
  { fixture },
  async (repo) => {
    for (const name of ['only', 'mixed']) repo.write(`docs/${name}.md`, `# ${name}\n`);
    repo.write(
      'docstamp.yaml',
      config({
        'docs/all.md': ['src/**'],
        'docs/only.md': ['!nothing', '!src/a.ts'],
        'docs/mixed.md': ['nothing/**', '!nothing/x'],
      }),
    );
    const text = await repo.run([], { label: 'text', show: ['docstamp.yaml'] });
    expect(text.exit).toBe(2);
    expect(text.stderr).toBe(
      'error: E_EMPTY_DEPENDENCIES: docs/mixed.md: Correct the patterns in "dependencies"; together they select no file.\n' +
        'error: E_EMPTY_PATTERN: docs/mixed.md: nothing/**: Correct or remove the pattern; it matches no file.\n' +
        'warning: W_EMPTY_EXCLUSION: docs/mixed.md: !nothing/x: The exclusion matches no file, so it excludes nothing; remove it, or keep it for later.\n' +
        'error: E_EMPTY_DEPENDENCIES: docs/only.md: Correct the patterns in "dependencies"; together they select no file.\n' +
        'warning: W_EMPTY_EXCLUSION: docs/only.md: !nothing: The exclusion matches no file, so it excludes nothing; remove it, or keep it for later.\n',
    );
    const json = await repo.run(['--json'], { label: 'json' });
    expect(json.exit).toBe(2);
    const codes = (file: string) =>
      json
        .json()
        .files.find((f: { file: string }) => f.file === file)
        .diagnostics.map((d: { code: string; severity: string }) => `${d.severity} ${d.code}`);
    expect(codes('docs/only.md')).toEqual([
      'error E_EMPTY_DEPENDENCIES',
      'warning W_EMPTY_EXCLUSION',
    ]);
    expect(codes('docs/all.md')).toEqual([]);
  },
);

scenario(
  '§8.5 the position of an exclusion does not change its warning or the result',
  async (repo) => {
    repo.write('DOC.md', '# doc\n');
    for (const file of ['src/a.ts', 'src/lib/x.ts']) repo.write(file, 'x\n');
    const run = async (patterns: string[]) => {
      repo.write('docstamp.yaml', config({ 'DOC.md': patterns }));
      const result = await repo.run(['list-dependencies', '--json'], {
        label: patterns.join(' '),
        show: ['docstamp.yaml'],
      });
      expect(result.exit).toBe(0);
      const [file] = result.json().files;
      return [file.resolvedFiles, file.diagnostics.map((d: { subject: string }) => d.subject)];
    };
    const same = [['src/a.ts', 'src/lib/x.ts'], ['!nothing']];
    expect(await run(['!nothing', 'src/**'])).toEqual(same);
    expect(await run(['src/**', '!nothing'])).toEqual(same);
    expect(await run(['src/a.ts', '!nothing', 'src/lib'])).toEqual(same);
    expect(await run(['src/**', '!src/lib', 'src/lib/x.ts', '!nothing'])).toEqual(same);
  },
);

scenario('§8.5 an inline block gets the same warning', async (repo) => {
  repo.write('src/a.ts', 'a\n');
  repo.write('DOC.md', '---\ndocstamp:\n  dependencies: [src/**, "!src/gone/**"]\n---\n# doc\n');
  const first = await repo.run([], { label: 'inline, unrecorded' });
  expect(first.exit).toBe(1);
  expect(first.stderr).toContain('warning: W_EMPTY_EXCLUSION: DOC.md: !src/gone/**');
  await repo.run(['update', 'DOC.md'], { expectExit: 0 });
  const ok = await repo.run([], { label: 'inline, reviewed' });
  expect([ok.exit, ok.stdout]).toEqual([0, '1 ok, 0 stale, 0 invalid\n']);
  expect(ok.stderr).toContain('W_EMPTY_EXCLUSION');
});
