import { dirname } from 'node:path';
import { expect } from 'vitest';
import { config, scenario } from './harness/index.ts';

// Windows prints some of these paths with `\` and some with `/`; compare them alike.
const slashes = (text: string): string => text.replaceAll('\\', '/');

scenario(
  '§13.7 list-dependencies: text and JSON, no lock needed',
  { fixture: 'docs-site' },
  async (repo) => {
    const text = await repo.run(['list-dependencies']);
    expect(text.exit).toBe(0);
    expect(text.stderr).toBe('');
    expect(text.stdout).toContain(
      'CLAUDE.md\n  depends   src/**\n  depends   !src/**/*.test.ts\n' +
        '  resolved  src/cli/run.ts\n  resolved  src/index.ts\n  resolved  src/util.ts\n',
    );
    expect(text.stdout).not.toContain('util.test.ts\n  resolved');
    expect(text.stdout).not.toContain(' ok');
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);

    const json = await repo.run(['list-dependencies', '--json']);
    const doc = json.json();
    expect(Object.keys(doc)).toEqual(['version', 'mode', 'exitCode', 'files', 'diagnostics']);
    expect(Object.keys(doc.files[0])).toEqual([
      'file',
      'dependencies',
      'resolvedFiles',
      'diagnostics',
    ]);
    expect(doc.files[0].resolvedFiles).toEqual(['src/cli/run.ts', 'src/index.ts', 'src/util.ts']);
    expect('summary' in doc).toBe(false);
    expect(json.stderr).toBe('');
  },
);

scenario(
  '§13.7 list-dependencies selects files and reports unknown ones',
  { fixture: 'docs-site' },
  async (repo) => {
    const one = await repo.run(['list-dependencies', 'docs/guide.md']);
    expect(one.stdout).toBe('docs/guide.md\n  depends   src/cli\n  resolved  src/cli/run.ts\n');

    const fromDocs = await repo.run(['list-dependencies', '../README.md'], { cwd: 'docs' });
    expect(fromDocs.stdout.startsWith('README.md\n')).toBe(true);

    const unknown = await repo.run(['list-dependencies', 'src/util.ts']);
    expect(unknown.exit).toBe(2);
    expect(unknown.stdout).toBe('');
    expect(unknown.stderr).toContain('E_UNKNOWN_FILE: src/util.ts');
  },
);

scenario(
  '§13.7 list-dependencies exits 2 for an invalid file, still lists the others',
  { fixture: 'docs-site' },
  async (repo) => {
    repo.remove('docs/guide.md');
    const result = await repo.run(['list-dependencies']);
    expect(result.exit).toBe(2);
    expect(result.stdout).toContain('docs/guide.md\n');
    expect(result.stdout).not.toContain('docs/guide.md\n  depends');
    expect(result.stdout).toContain('CLAUDE.md\n  depends');
    expect(result.stderr).toContain('error: E_FILE_MISSING: docs/guide.md');
  },
);

scenario('§13.8 list-dependents: who depends on a file', { fixture: 'docs-site' }, async (repo) => {
  const cli = await repo.run(['list-dependents', 'src/cli/run.ts']);
  expect(cli).toMatchObject({
    exit: 0,
    stdout: 'src/cli/run.ts\n  CLAUDE.md       via src/**\n  docs/guide.md   via src/cli\n',
    stderr: '',
  });

  const index = await repo.run(['list-dependents', 'src/index.ts']);
  expect(index.stdout).toBe(
    'src/index.ts\n  CLAUDE.md   via src/**\n  README.md   via src/index.ts\n',
  );

  const json = await repo.run(['list-dependents', '--json', 'src/cli/run.ts']);
  const doc = json.json();
  expect(Object.keys(doc)).toEqual(['version', 'mode', 'exitCode', 'files', 'diagnostics']);
  expect(Object.keys(doc.files[0])).toEqual(['file', 'dependents', 'diagnostics']);
  expect(doc.files[0].dependents).toEqual([
    { file: 'CLAUDE.md', via: ['src/**'] },
    { file: 'docs/guide.md', via: ['src/cli'] },
  ]);
});

scenario(
  '§13.8 list-dependents: negation excludes, nobody depends, stamped file argument',
  { fixture: 'docs-site' },
  async (repo) => {
    const negated = await repo.run(['list-dependents', 'src/util.test.ts']);
    expect(negated.exit).toBe(0);
    expect(negated.stdout).toBe('src/util.test.ts\n  (no dependents)\n');

    const nobody = await repo.run(['list-dependents', 'README.md']);
    expect(nobody.stdout).toBe('README.md\n  (no dependents)\n');

    const stamped = await repo.run(['list-dependents', 'docs/guide.md']);
    expect(stamped.stdout).toBe('docs/guide.md\n  README.md   via docs/guide.md\n');

    const absent = await repo.run(['list-dependents', 'src/not-there.ts']);
    expect(absent.exit).toBe(0);
    expect(absent.stdout).toBe('src/not-there.ts\n  (no dependents)\n');

    const several = await repo.run(['list-dependents', 'src/util.ts', 'README.md', 'src/util.ts']);
    expect(several.stdout).toBe(
      'README.md\n  (no dependents)\nsrc/util.ts\n  CLAUDE.md   via src/**\n',
    );
  },
);

scenario(
  '§13.8 list-dependents: directory pattern and two patterns',
  { fixture: 'patterns' },
  async (repo) => {
    const nested = await repo.run(['list-dependents', 'src/lib/x.ts']);
    expect(nested.stdout).toBe(
      'src/lib/x.ts\n  docs/all.md         via src/**\n  docs/directory.md   via src/lib\n  docs/negation.md    via src/**\n',
    );

    const negated = await repo.run(['list-dependents', 'src/lib/y.test.ts']);
    expect(negated.stdout).toBe(
      'src/lib/y.test.ts\n  docs/all.md         via src/**\n  docs/directory.md   via src/lib\n',
    );

    const first = await repo.run(['list-dependents', 'src/a.ts']);
    expect(first.stdout).toContain('  docs/alternation.md   via src/{a,b}.ts\n');
    expect(first.stdout).toContain('  docs/two.md           via src/a.ts\n');

    const both = await repo.run(['list-dependents', '--json', 'docs/extra.md']);
    expect(both.json().files[0].dependents).toEqual([
      { file: 'docs/two.md', via: ['docs/extra.md'] },
    ]);
  },
);

scenario('§13.8 list-dependents: via lists every matching non-negated pattern', async (repo) => {
  repo.write('docstamp.yaml', config({ 'DOC.md': ['src/**', 'src/a.ts', 'src/*', '!src/b.ts'] }));
  repo.write('DOC.md', '# doc\n');
  repo.write('src/a.ts', 'a\n');
  repo.write('src/b.ts', 'b\n');
  const result = await repo.run(['list-dependents', 'src/a.ts', 'src/b.ts']);
  expect(result.stdout).toBe(
    'src/a.ts\n  DOC.md   via src/**, src/a.ts, src/*\nsrc/b.ts\n  (no dependents)\n',
  );
});

scenario(
  '§13.2 list-dependents without a file is E_USAGE',
  { fixture: 'docs-site' },
  async (repo) => {
    const result = await repo.run(['list-dependents']);
    expect(result.exit).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('error: E_USAGE: list-dependents');
  },
);

scenario(
  '§13.8 list-dependents with a path outside the root is E_USAGE',
  { fixture: 'docs-site' },
  async (repo) => {
    const result = await repo.run(['list-dependents', '../outside.txt', 'src/util.ts']);
    expect(result.exit).toBe(2);
    expect(result.stdout).toBe('');
    expect(slashes(result.stderr)).toBe(
      'error: E_USAGE: ../outside.txt: The argument is resolved against the current directory ' +
        slashes(
          `(${repo.root}) to ${dirname(repo.root)}/outside.txt, which is outside the root ` +
            `${repo.root}; name a file inside the root.\n`,
        ),
    );

    const json = await repo.run(['list-dependents', '--json', '/etc/hosts']);
    expect(json.exit).toBe(2);
    expect(json.json().files).toEqual([]);
    expect(json.json().diagnostics[0]).toMatchObject({ code: 'E_USAGE', subject: '/etc/hosts' });

    const both = await repo.run(['list-dependents', '../a', '../b', 'src/util.ts']);
    expect(both.stdout).toBe('');
    expect(both.stderr.match(/E_USAGE/gu)).toHaveLength(2);
  },
);

scenario('§13.8 list-dependents ignores the lock', { fixture: 'docs-site' }, async (repo) => {
  repo.write('docstamp-lock.yaml', 'not even yaml: [');
  const result = await repo.run(['list-dependents', 'src/index.ts']);
  expect(result.exit).toBe(0);
  expect(result.stderr).toBe('');
});

scenario(
  '§13.8 list-dependents skips a file with an invalid pattern and reports it',
  { fixture: 'docs-site' },
  async (repo) => {
    repo.write(
      'docstamp.yaml',
      config({ 'CLAUDE.md': ['src/**'], 'README.md': ['src//index.ts'] }),
    );
    const result = await repo.run(['list-dependents', 'src/index.ts']);
    expect(result.exit).toBe(2);
    expect(result.stdout).toBe('src/index.ts\n  CLAUDE.md   via src/**\n');
    expect(result.stderr).toContain('error: E_PATTERN: README.md: src//index.ts');
  },
);

scenario(
  '§13.8 list-dependents: an unknown path warns W_UNKNOWN_PATH and still exits 0',
  { fixture: 'docs-site' },
  async (repo) => {
    repo.write('.gitignore', 'secret.txt\n');
    repo.write('secret.txt', 'ignored\n');

    const typo = await repo.run(['list-dependents', 'src/utl.ts', 'src/util.ts']);
    expect(typo.exit).toBe(0);
    expect(typo.stdout).toBe(
      'src/util.ts\n  CLAUDE.md   via src/**\nsrc/utl.ts\n  (no dependents)\n',
    );
    expect(typo.stderr).toMatch(/^warning: W_UNKNOWN_PATH: src\/utl\.ts: /u);
    expect(typo.stderr.match(/W_UNKNOWN_PATH/gu)).toHaveLength(1);

    const json = await repo.run(['list-dependents', '--json', 'src/utl.ts', 'README.md']);
    expect(json.exit).toBe(0);
    expect(json.stderr).toBe('');
    const [known, unknown] = json.json().files;
    expect(unknown.diagnostics).toEqual([
      expect.objectContaining({
        code: 'W_UNKNOWN_PATH',
        severity: 'warning',
        file: null,
        subject: 'src/utl.ts',
      }),
    ]);
    expect([known.file, known.diagnostics]).toEqual(['README.md', []]);

    const exists = await repo.run(['list-dependents', 'secret.txt', 'src', 'README.md']);
    expect(exists.stderr).toBe('');
    expect(exists.stdout).toBe(
      'README.md\n  (no dependents)\nsecret.txt\n  (no dependents)\nsrc\n  (no dependents)\n',
    );
  },
);

scenario(
  '§13.8 W_UNKNOWN_PATH names the path relative to the root, from a subdirectory and with --root',
  { fixture: 'docs-site' },
  async (repo) => {
    const fromDocs = await repo.run(['list-dependents', '../src/utl.ts', '../src/util.ts'], {
      cwd: 'docs',
    });
    expect(fromDocs.exit).toBe(0);
    expect(fromDocs.stderr).toMatch(/^warning: W_UNKNOWN_PATH: src\/utl\.ts: /u);
    expect(fromDocs.stdout).toContain('src/utl.ts\n  (no dependents)\n');

    const rooted = await repo.run(['list-dependents', '--root', '..', 'ghost.md'], {
      cwd: 'docs',
    });
    expect(rooted.exit).toBe(0);
    expect(rooted.stderr).toMatch(/^warning: W_UNKNOWN_PATH: docs\/ghost\.md: /u);

    const named = await repo.run(['list-dependents', '--root', '..', '../ghost.md'], {
      cwd: 'docs',
    });
    expect(named.exit).toBe(0);
    expect(named.stderr).toMatch(/^warning: W_UNKNOWN_PATH: ghost\.md: /u);
  },
);

scenario(
  '§13.8 the E_USAGE for an argument outside the root says how it was resolved',
  { fixture: 'docs-site' },
  async (repo) => {
    const outside = await repo.run(['list-dependents', '../../outside.txt'], { cwd: 'docs' });
    expect(outside.exit).toBe(2);
    expect(outside.stdout).toBe('');
    expect(slashes(outside.stderr)).toBe(
      'error: E_USAGE: ../../outside.txt: The argument is resolved against the current ' +
        slashes(
          `directory (${repo.root}/docs) to ${dirname(repo.root)}/outside.txt, which is outside ` +
            `the root ${repo.root}; name a file inside the root.\n`,
        ),
    );

    const rootItself = await repo.run(['list-dependents', '.']);
    expect(rootItself.exit).toBe(2);
    expect(slashes(rootItself.stderr)).toContain(
      slashes(`to ${repo.root}, which does not name a file inside the root ${repo.root};`),
    );
  },
);
