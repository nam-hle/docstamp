import { expect } from 'vitest';
import { config, scenario, type Repo } from '../harness/index.ts';

const fixture = 'gitignore';

const resolved = async (repo: Repo, label: string): Promise<string[]> => {
  const result = await repo.run(['list-dependencies', '--json'], {
    label,
    show: ['docstamp.yaml'],
  });
  expect(result.exit).toBe(0);
  return result.json().files[0].resolvedFiles;
};

const addGeneratedFiles = (repo: Repo): void => {
  repo.write('build/out.js', 'built\n');
  repo.write('debug.log', 'log\n');
  repo.write('src/b.gen.ts', 'generated\n');
  repo.write('other/x.gen.ts', 'generated elsewhere\n');
  repo.write('src/c.ts', 'c\n');
};

scenario('§7.3 .gitignore: root, nested and negated rules', { fixture }, async (repo) => {
  addGeneratedFiles(repo);
  const files = await resolved(repo, 'default: gitignore is honoured');
  expect(files).toEqual([
    '.gitignore',
    'keep.log',
    'other/x.gen.ts',
    'src/.gitignore',
    'src/a.ts',
    'src/c.ts',
  ]);
});

scenario(
  '§7.2 ignored files never make a file stale, tracked ones do',
  { fixture },
  async (repo) => {
    addGeneratedFiles(repo);
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.append('build/out.js', 'rebuilt\n');
    repo.write('build/new.js', 'new\n');
    repo.append('debug.log', 'more\n');
    repo.append('src/b.gen.ts', 'more\n');
    const ignored = await repo.run([], { label: 'only ignored files changed' });
    expect(ignored).toMatchObject({ exit: 0, stdout: '1 ok, 0 stale, 0 invalid\n' });

    repo.append('keep.log', 'edit\n');
    const negated = await repo.run([], { label: 'a negated-ignore file changed' });
    expect(negated.exit).toBe(1);
    await repo.run(['update', '--all'], { expectExit: 0 });

    repo.append('other/x.gen.ts', 'edit\n');
    expect((await repo.run([], { label: 'a file the nested rule does not scope' })).exit).toBe(1);
  },
);

scenario(
  '§7.3 a negation cannot re-include a file inside an ignored directory',
  { fixture },
  async (repo) => {
    repo.write('.gitignore', repo.read('.gitignore') + '!build/keep.js\n');
    repo.write('build/keep.js', 'kept?\n');
    const files = await resolved(repo, 'build/ is ignored, so !build/keep.js has no effect');
    expect(files).not.toContain('build/keep.js');
  },
);

scenario('§9.3 gitignore: false includes ignored files', { fixture }, async (repo) => {
  addGeneratedFiles(repo);
  repo.write('docstamp.yaml', config({ 'DOC.md': ['**'] }, 'gitignore: false\n'));
  const files = await resolved(repo, 'gitignore: false');
  expect(files).toEqual([
    '.gitignore',
    'build/out.js',
    'debug.log',
    'keep.log',
    'other/x.gen.ts',
    'src/.gitignore',
    'src/a.ts',
    'src/b.gen.ts',
    'src/c.ts',
  ]);
});

scenario('§9.3 the ignore list adds rules scoped to the Root', { fixture }, async (repo) => {
  addGeneratedFiles(repo);
  repo.write(
    'docstamp.yaml',
    config({ 'DOC.md': ['**'] }, 'ignore:\n  - "*.gen.ts"\n  - /src/c.ts\n  - "!keep.log"\n'),
  );
  const files = await resolved(repo, 'ignore: *.gen.ts and /src/c.ts');
  expect(files).toEqual(['.gitignore', 'keep.log', 'src/.gitignore', 'src/a.ts']);

  repo.write(
    'docstamp.yaml',
    config(
      { 'DOC.md': ['**'] },
      'gitignore: false\nignore:\n  - build/\n  - "*.log"\n  - "!keep.log"\n',
    ),
  );
  const combined = await resolved(repo, 'gitignore: false with its own ignore list');
  expect(combined).toContain('keep.log');
  expect(combined).not.toContain('build/out.js');
  expect(combined).not.toContain('debug.log');
  expect(combined).toContain('src/b.gen.ts');
});

scenario(
  '§7.2 .git and nested repositories are never entered',
  { fixture, git: false },
  async (repo) => {
    repo.write('vendor/lib/.git/HEAD', 'ref: refs/heads/main\n');
    repo.write('vendor/lib/x.ts', 'vendored\n');
    repo.write('plain/x.ts', 'plain\n');
    repo.mkdir('.git');
    repo.write('.git/config', 'ignored\n');
    const files = await resolved(repo, 'nested repository vendor/lib and .git are skipped');
    expect(files).toContain('plain/x.ts');
    expect(files.some((f) => f.startsWith('vendor/') || f.startsWith('.git/'))).toBe(false);
  },
);

scenario(
  '§7.2 an ignored directory that holds a stamped file still works',
  { fixture },
  async (repo) => {
    repo.write('.gitignore', repo.read('.gitignore') + 'notes/\n');
    repo.write('notes/NOTE.md', '# note\n');
    repo.write('docstamp.yaml', config({ 'DOC.md': ['src/**'], 'notes/NOTE.md': ['src/**'] }));
    const result = await repo.run([], { show: ['docstamp.yaml'] });
    expect(result.stdout).toContain('notes/NOTE.md  (unrecorded)');
    expect(result.stderr).toBe('');
  },
);

scenario(
  '§7.2 core.excludesFile and .git/info/exclude are never read',
  { fixture },
  async (repo) => {
    repo.write('.git/info/exclude', 'src/a.ts\n');
    const files = await resolved(repo, 'info/exclude does not hide src/a.ts');
    expect(files).toContain('src/a.ts');
  },
);
