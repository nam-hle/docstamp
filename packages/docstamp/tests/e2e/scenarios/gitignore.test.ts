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

scenario(
  '§8.5 an exclusion that matches only ignored files matches nothing',
  { fixture },
  async (repo) => {
    repo.write('build/out.js', 'built\n');
    repo.write('docstamp.yaml', config({ 'DOC.md': ['**', '!build/out.js'] }));
    const ignored = await repo.run([], { label: 'build/ is ignored', show: ['docstamp.yaml'] });
    expect(ignored.exit).toBe(1);
    expect(ignored.stderr).toContain('warning: W_EMPTY_EXCLUSION: DOC.md: !build/out.js');

    repo.write(
      'docstamp.yaml',
      config({ 'DOC.md': ['**', '!build/out.js'] }, 'gitignore: false\n'),
    );
    const listed = await repo.run(['list-dependencies', '--json'], {
      label: 'gitignore: false, the exclusion has something to exclude',
      show: ['docstamp.yaml'],
    });
    expect(listed.stderr).toBe('');
    expect(listed.json().files[0].resolvedFiles).not.toContain('build/out.js');
  },
);

const PLAIN = 'Correct or remove the pattern; it matches no file.';
const IGNORED =
  'Correct or remove the pattern; it matches no file: it exists but is ignored by .gitignore ' +
  'or the ignore list; depend on its source, or remove that rule (gitignore: false skips ' +
  '.gitignore files).';

const emptyPatterns = (stderr: string): string[] =>
  stderr.split('\n').filter((line) => line.includes('E_EMPTY_PATTERN'));

scenario(
  '§8.5 a pattern that names an existing ignored path says it is ignored',
  { fixture },
  async (repo) => {
    repo.write('.gitignore', repo.read('.gitignore') + '.npmrc\n');
    repo.write('.npmrc', 'registry=https://example.invalid\n');
    repo.write('build/output/index.js', 'built\n');
    repo.write('src/real.ts', 'source\n');
    repo.write(
      'docstamp.yaml',
      config({
        'DOC.md': [
          'src/a.ts',
          '.npmrc',
          'build/output/index.js',
          'build',
          'build/missing.js',
          'build/*',
          'src/gone.ts',
        ],
      }),
    );
    const text = await repo.run([], {
      label: 'ignored, missing and glob',
      show: ['docstamp.yaml'],
    });
    expect(text.exit).toBe(2);
    expect(emptyPatterns(text.stderr)).toEqual([
      `error: E_EMPTY_PATTERN: DOC.md: .npmrc: ${IGNORED}`,
      `error: E_EMPTY_PATTERN: DOC.md: build: ${IGNORED}`,
      `error: E_EMPTY_PATTERN: DOC.md: build/*: ${PLAIN}`,
      `error: E_EMPTY_PATTERN: DOC.md: build/missing.js: ${PLAIN}`,
      `error: E_EMPTY_PATTERN: DOC.md: build/output/index.js: ${IGNORED}`,
      `error: E_EMPTY_PATTERN: DOC.md: src/gone.ts: ${PLAIN}`,
    ]);
    expect(text.stdout).toContain('INVALID  DOC.md');
    expect(text.stderr).not.toContain(repo.root);

    const json = await repo.run(['--json'], { label: 'the same, json' });
    expect(json.exit).toBe(2);
    const byPattern = Object.fromEntries(
      json
        .json()
        .files[0].diagnostics.filter((d: { code: string }) => d.code === 'E_EMPTY_PATTERN')
        .map((d: { subject: string; message: string }) => [d.subject, d.message]),
    );
    expect(byPattern['.npmrc']).toBe(IGNORED);
    expect(byPattern['build/*']).toBe(PLAIN);

    const listed = await repo.run(['list-dependencies', 'DOC.md'], { label: 'list-dependencies' });
    expect(listed.exit).toBe(2);
    expect(emptyPatterns(listed.stderr)).toEqual(emptyPatterns(text.stderr));
  },
);

scenario(
  '§8.5 an ignore list entry is named too, and the selection never changes',
  { fixture },
  async (repo) => {
    repo.write('gen/types.ts', 'generated\n');
    repo.write(
      'docstamp.yaml',
      config({ 'DOC.md': ['gen/types.ts', 'src/a.ts'] }, 'ignore:\n  - gen/\n'),
    );
    const ignored = await repo.run([], { label: 'ignore: gen/', show: ['docstamp.yaml'] });
    expect(ignored.exit).toBe(2);
    expect(emptyPatterns(ignored.stderr)).toEqual([
      `error: E_EMPTY_PATTERN: DOC.md: gen/types.ts: ${IGNORED}`,
    ]);
    expect(ignored.stdout).toContain('0 ok, 0 stale, 1 invalid');

    repo.write('docstamp.yaml', config({ 'DOC.md': ['src/a.ts'] }, 'ignore:\n  - gen/\n'));
    const fixed = await repo.run([], { label: 'depending on the source instead' });
    expect([fixed.exit, fixed.stderr]).toEqual([1, '']);
    await repo.run(['update', '--all'], { expectExit: 0 });
    const ok = await repo.run([], { label: 'reviewed' });
    expect([ok.exit, ok.stdout]).toEqual([0, '1 ok, 0 stale, 0 invalid\n']);

    repo.write('docstamp.yaml', config({ 'DOC.md': ['gen/types.ts'] }, 'gitignore: false\n'));
    const included = await repo.run(['list-dependencies', '--json'], {
      label: 'without the ignore list gen/types.ts is in the Universe again',
      show: ['docstamp.yaml'],
    });
    expect([included.exit, included.json().files[0].resolvedFiles]).toEqual([0, ['gen/types.ts']]);
  },
);
