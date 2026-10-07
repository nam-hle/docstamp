import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { config, scenario, type Repo, type RunResult } from '../harness/index.ts';

const seen = new Set<string>();
const unreachable = new Set<string>();
const cannotChmod = process.platform === 'win32' || process.getuid?.() === 0;
if (cannotChmod) unreachable.add('E_UNREADABLE');

async function run(
  repo: Repo,
  label: string,
  args: string[],
  exit: number,
  codes: string[],
  show: string[] = ['docstamp.yaml'],
): Promise<RunResult> {
  const result = await repo.run(args, { label, show });
  for (const match of result.stderr.matchAll(/^(?:error|warning): ([EW]_[A-Z_]+)/gmu)) {
    seen.add(match[1]!);
  }
  expect(result.exit, label).toBe(exit);
  for (const code of codes) expect(result.stderr, label).toContain(`: ${code}`);
  expect(result.stderr, label).not.toContain(repo.root);
  return result;
}

const base = (repo: Repo) => {
  repo.write('DOC.md', '# doc\n');
  repo.write('src/a.ts', 'a\n');
};

scenario(
  '§9.3 configuration errors: every shape is E_CONFIG, E_CONFIG_VERSION or E_UNKNOWN_KEY',
  async (repo) => {
    base(repo);
    const ok = 'dependencies: [src/**]';
    const cases: [string, string, string][] = [
      ['syntax error', 'version: 2\nfiles: [\n', 'E_CONFIG'],
      ['top level is a list', '- a\n', 'E_CONFIG'],
      ['empty file', '', 'E_CONFIG'],
      ['two documents', `version: 2\nfiles:\n  DOC.md:\n    ${ok}\n---\nversion: 2\n`, 'E_CONFIG'],
      ['files is a list', 'version: 2\nfiles: []\n', 'E_CONFIG'],
      ['files is absent', 'version: 2\n', 'E_CONFIG'],
      ['declaration is a string', 'version: 2\nfiles:\n  DOC.md: src/**\n', 'E_CONFIG'],
      [
        'dependencies is empty',
        'version: 2\nfiles:\n  DOC.md:\n    dependencies: []\n',
        'E_CONFIG',
      ],
      [
        'dependency is a number',
        'version: 2\nfiles:\n  DOC.md:\n    dependencies: [1]\n',
        'E_CONFIG',
      ],
      [
        'duplicate key',
        `version: 2\nfiles:\n  DOC.md:\n    ${ok}\n  DOC.md:\n    ${ok}\n`,
        'E_CONFIG',
      ],
      ['anchor and alias', `version: 2\nfiles:\n  DOC.md: &a\n    ${ok}\n  B.md: *a\n`, 'E_CONFIG'],
      ['numeric key', `version: 2\nfiles:\n  1:\n    ${ok}\n`, 'E_CONFIG'],
      ['file key is not a RepoPath', `version: 2\nfiles:\n  /DOC.md:\n    ${ok}\n`, 'E_CONFIG'],
      [
        'gitignore is not a boolean',
        `version: 2\ngitignore: "yes"\nfiles:\n  DOC.md:\n    ${ok}\n`,
        'E_CONFIG',
      ],
      [
        'ignore is not a list of strings',
        `version: 2\nignore: [1]\nfiles:\n  DOC.md:\n    ${ok}\n`,
        'E_CONFIG',
      ],
      [
        'version 1 layout',
        'version: 1\ndependents:\n  DOC.md:\n    covers: [src/**]\n',
        'E_CONFIG_VERSION',
      ],
      ['no version', `files:\n  DOC.md:\n    ${ok}\n`, 'E_CONFIG_VERSION'],
      [
        'version is the string "2"',
        `version: "2"\nfiles:\n  DOC.md:\n    ${ok}\n`,
        'E_CONFIG_VERSION',
      ],
      ['version is 2.0', `version: 2.0\nfiles:\n  DOC.md:\n    ${ok}\n`, 'E_CONFIG_VERSION'],
      [
        'unknown top-level key',
        `version: 2\nextra: 1\nfiles:\n  DOC.md:\n    ${ok}\n`,
        'E_UNKNOWN_KEY',
      ],
      [
        'removed top-level dependents',
        `version: 2\ndependents: {}\nfiles:\n  DOC.md:\n    ${ok}\n`,
        'E_UNKNOWN_KEY',
      ],
      [
        'removed per-file covers',
        `version: 2\nfiles:\n  DOC.md:\n    ${ok}\n    covers: [src/**]\n`,
        'E_UNKNOWN_KEY',
      ],
    ];
    for (const [label, yaml, code] of cases) {
      repo.write('docstamp.yaml', yaml);
      const result = await run(repo, label, [], 2, [code]);
      expect(result.stdout, label).not.toContain('STALE');
    }
    repo.write(
      'docstamp.yaml',
      'version: 2\nextra: 1\nfiles:\n  DOC.md:\n    dependencies: [src/**]\n',
    );
    const json = await repo.run(['--json'], { label: 'a configuration error as JSON' });
    expect(json.stderr).toBe('');
    expect('summary' in json.json()).toBe(false);
    expect(json.json()).toMatchObject({
      exitCode: 2,
      files: [],
      diagnostics: [{ code: 'E_UNKNOWN_KEY', severity: 'error', file: null, subject: 'extra' }],
    });
  },
);

scenario('§6 and §9.3 E_CONFIG_MISSING and E_CONFIG_AMBIGUOUS', { git: false }, async (repo) => {
  repo.mkdir('deep/er');
  await run(repo, 'no configuration anywhere', [], 2, ['E_CONFIG_MISSING'], []);
  await run(repo, 'from a subdirectory', ['check', 'x'], 2, ['E_CONFIG_MISSING'], []);

  repo.write('docstamp.yaml', config({ 'DOC.md': ['src/**'] }));
  repo.write('docstamp.config.mjs', 'export default {};\n');
  const both = await run(repo, 'yaml and mjs', ['--json'], 2, [], ['docstamp.yaml']);
  expect(both.json().diagnostics[0]).toMatchObject({
    code: 'E_CONFIG_AMBIGUOUS',
    subject: 'docstamp.yaml, docstamp.config.mjs',
  });
  seen.add('E_CONFIG_AMBIGUOUS');
  repo.remove('docstamp.yaml');
  repo.write('docstamp.config.ts', 'export default {};\n');
  const scripts = await run(repo, 'two scripts', ['--json'], 2, [], []);
  expect(scripts.json().diagnostics[0].subject).toBe('docstamp.config.ts, docstamp.config.mjs');

  repo.remove('docstamp.config.ts');
  repo.remove('docstamp.config.mjs');
  repo.mkdir('docstamp.yaml');
  await run(repo, 'the configuration name is a directory', [], 2, ['E_CONFIG_MISSING'], []);
});

scenario(
  '§9.6.2 and §12.2 E_BLOCK, E_UNKNOWN_KEY and E_DUPLICATE_DECLARATION attach to their file',
  async (repo) => {
    base(repo);
    const block = (extra: string) => `---\ndocstamp:\n  dependencies: [src/**]\n${extra}---\n`;
    repo.write('OK.md', block(''));
    repo.write('flow.md', '---\ndocstamp: {dependencies: [src/**]}\n---\n');
    repo.write('unknown.md', block('  nope: 1\n'));
    repo.write('twice.md', block(''));
    repo.write('docstamp.yaml', config({ 'twice.md': ['src/**'] }));
    const result = await run(
      repo,
      'malformed and duplicate blocks',
      [],
      2,
      ['E_BLOCK', 'E_UNKNOWN_KEY', 'E_DUPLICATE_DECLARATION'],
      ['docstamp.yaml', 'flow.md'],
    );
    expect(result.stderr).toContain('E_BLOCK: flow.md: docstamp: ');
    expect(result.stderr).toContain('E_UNKNOWN_KEY: unknown.md: nope: ');
    expect(result.stderr).toContain('E_DUPLICATE_DECLARATION: twice.md: ');
    expect(result.stdout).toContain('1 stale, 3 invalid');
  },
);

scenario('§9.3 invalid patterns make only their file invalid', async (repo) => {
  base(repo);
  const bad: Record<string, string> = {
    'p01.md': 'src//a.ts',
    'p02.md': '/src/a.ts',
    'p03.md': 'src/',
    'p04.md': 'src/../a.ts',
    'p05.md': 'src/**x',
    'p06.md': 'src/[z-a].ts',
    'p07.md': 'src/{a}.ts',
    'p08.md': '',
    'p09.md': '!',
    'p10.md': 'src/[!].ts',
    'p11.md': 'src/./a.ts',
    'p12.md': 'é.md',
  };
  const files: Record<string, string[]> = { 'DOC.md': ['src/**'] };
  for (const [file, pattern] of Object.entries(bad)) {
    repo.write(file, '# p\n');
    files[file] = [pattern];
  }
  repo.write('docstamp.yaml', config(files));
  const result = await run(repo, 'twelve invalid patterns', [], 2, ['E_PATTERN']);
  for (const file of Object.keys(bad)) expect(result.stderr).toContain(`E_PATTERN: ${file}`);
  expect(result.stdout).toContain('STALE    DOC.md  (unrecorded)');
  expect(result.stdout).toContain('0 ok, 1 stale, 12 invalid');
  expect(result.stdout).not.toContain('E_PATTERN');
});

scenario('§9.4 and §12.1 E_FILE_MISSING', async (repo) => {
  base(repo);
  repo.write('.gitignore', 'IGNORED.md\n');
  repo.write('IGNORED.md', '# ignored but stamped\n');
  repo.symlink('LINK.md', 'DOC.md');
  const files = {
    'DOC.md': ['src/**'],
    'GONE.md': ['src/**'],
    'doc.md': ['src/**'],
    src: ['src/**'],
    'LINK.md': ['src/**'],
    'IGNORED.md': ['src/**'],
  };
  repo.write('docstamp.yaml', config(files));
  const result = await run(repo, 'missing, wrong case, directory, link, ignored', [], 2, [
    'E_FILE_MISSING',
  ]);
  for (const file of ['GONE.md', 'doc.md', 'src', 'LINK.md']) {
    expect(result.stderr, file).toContain(`E_FILE_MISSING: ${file}`);
  }
  expect(result.stderr).not.toContain('E_FILE_MISSING: IGNORED.md');
  expect(result.stdout).toContain('STALE    IGNORED.md  (unrecorded)');
});

scenario('§8.5 E_EMPTY_PATTERN and E_EMPTY_DEPENDENCIES', async (repo) => {
  base(repo);
  for (const name of ['B', 'C', 'D', 'E']) repo.write(`${name}.md`, `# ${name}\n`);
  repo.write(
    'docstamp.yaml',
    config({
      'DOC.md': ['nothing/**'],
      'B.md': ['src/**', 'nothing/**'],
      'C.md': ['!src/**'],
      'D.md': ['D.md'],
      'E.md': ['src/**', '!src/**/*.spec.ts'],
    }),
  );
  const result = await run(repo, 'patterns that select nothing', [], 2, [
    'E_EMPTY_PATTERN',
    'E_EMPTY_DEPENDENCIES',
    'W_EMPTY_EXCLUSION',
  ]);
  expect(result.stderr).toContain('E_EMPTY_PATTERN: DOC.md: nothing/**');
  expect(result.stderr).toContain('E_EMPTY_DEPENDENCIES: DOC.md');
  expect(result.stderr).toContain('E_EMPTY_PATTERN: B.md: nothing/**');
  expect(result.stderr).not.toContain('E_EMPTY_DEPENDENCIES: B.md');
  expect(result.stderr).toContain('E_EMPTY_DEPENDENCIES: C.md');
  expect(result.stderr).toContain('E_EMPTY_PATTERN: D.md: D.md');
  expect(result.stderr).toContain('warning: W_EMPTY_EXCLUSION: E.md: !src/**/*.spec.ts');
  expect(result.stderr).not.toContain('E_EMPTY_PATTERN: E.md');
  expect(result.stderr).not.toContain('error: W_EMPTY_EXCLUSION');
  expect(result.stdout).toContain('STALE    E.md  (unrecorded)');
  expect(result.stdout).toContain('0 ok, 1 stale, 4 invalid');
});

scenario(
  '§7.2 and §10.2 E_UNREADABLE for a dependency, a directory and a .gitignore',
  {
    skipIf: cannotChmod,
  },
  async (repo) => {
    base(repo);
    repo.write('docstamp.yaml', config({ 'DOC.md': ['src/**'] }));
    repo.chmod('src/a.ts', 0o000);
    const file = await run(repo, 'unreadable dependency', [], 2, ['E_UNREADABLE']);
    expect(file.stdout).toContain('INVALID  DOC.md');
    expect(file.stderr).toContain('E_UNREADABLE: DOC.md: src/a.ts');
    const list = await run(
      repo,
      'list-dependencies does not read dependencies',
      ['list-dependencies'],
      0,
      [],
    );
    expect(list.stdout).toContain('resolved  src/a.ts');
    repo.chmod('src/a.ts', 0o644);

    repo.chmod('src', 0o000);
    await run(repo, 'unreadable directory', [], 2, ['E_UNREADABLE']);
    await run(repo, 'unreadable directory, list-dependencies', ['list-dependencies'], 2, [
      'E_UNREADABLE',
    ]);
    repo.chmod('src', 0o755);

    repo.write('.gitignore', 'nothing\n');
    repo.chmod('.gitignore', 0o000);
    await run(repo, 'unreadable .gitignore', [], 2, ['E_UNREADABLE']);
  },
);

scenario('§7.2 E_PATH_ENCODING for a name that is not valid UTF-8', async (repo) => {
  base(repo);
  repo.write('docstamp.yaml', config({ 'DOC.md': ['src/**'] }));
  try {
    writeFileSync(
      Buffer.concat([Buffer.from(repo.path('src/')), Buffer.from([0xff, 0x2e, 0x74])]),
      'x',
    );
  } catch {
    unreachable.add('E_PATH_ENCODING');
    repo.skip('this file system rejects names that are not valid UTF-8');
  }
  const result = await run(repo, 'invalid UTF-8 file name', [], 2, ['E_PATH_ENCODING']);
  expect(result.stderr).toContain('E_PATH_ENCODING: src');
});

scenario(
  '§7.4 and §7.5 E_PATH_COLLISION for names equal after NFC or lowercasing',
  async (repo) => {
    base(repo);
    repo.write('docstamp.yaml', config({ 'DOC.md': ['src/**'] }));
    repo.write('src/Readme.md', 'upper\n');
    repo.write('src/README.md', 'lower\n');
    repo.write('src/é.txt', 'nfc\n');
    repo.write('src/é.txt', 'nfd\n');
    if (repo.list('src').length !== 5) {
      unreachable.add('E_PATH_COLLISION');
      repo.skip('this file system folds case or normalization, so the names cannot coexist');
    }
    const result = await run(repo, 'case and normalization collisions', [], 2, [
      'E_PATH_COLLISION',
    ]);
    expect(result.stderr).toContain('E_PATH_COLLISION: src/README.md');
    expect(result.stderr).toContain('E_PATH_COLLISION: src/é.txt');
  },
);

scenario(
  '§11.1 lock errors: E_LOCK and E_LOCK_VERSION shapes',
  { fixture: 'docs-site' },
  async (repo) => {
    await repo.run(['update', '--all'], { expectExit: 0 });
    const good = repo.read('docstamp-lock.yaml');
    const hash = /[0-9a-f]{64}/u.exec(good)![0];
    const entry = (name: string, value = hash) => `  ${JSON.stringify(name)}: ${value}\n`;
    const cases: [string, string, string][] = [
      ['syntax error', 'garbage: [', 'E_LOCK'],
      ['not a mapping', '- a\n', 'E_LOCK'],
      ['empty file', '', 'E_LOCK'],
      ['extra top-level key', `version: 3\nextra: 1\nfiles: {}\n`, 'E_LOCK'],
      ['files missing', 'version: 3\n', 'E_LOCK'],
      ['files is a list', 'version: 3\nfiles: []\n', 'E_LOCK'],
      ['short hash', `version: 3\nfiles:\n${entry('CLAUDE.md', 'abc')}`, 'E_LOCK'],
      ['uppercase hash', `version: 3\nfiles:\n${entry('CLAUDE.md', hash.toUpperCase())}`, 'E_LOCK'],
      ['key is not a RepoPath', `version: 3\nfiles:\n${entry('/CLAUDE.md')}`, 'E_LOCK'],
      ['duplicate key', `version: 3\nfiles:\n${entry('CLAUDE.md')}${entry('CLAUDE.md')}`, 'E_LOCK'],
      [
        'version 2 with dependents',
        `version: 2\ndependents:\n${entry('CLAUDE.md')}`,
        'E_LOCK_VERSION',
      ],
      ['future version 4', `version: 4\nfiles: {}\n`, 'E_LOCK_VERSION'],
      ['version is the string "3"', `version: "3"\nfiles: {}\n`, 'E_LOCK_VERSION'],
      ['no version', `files: {}\n`, 'E_LOCK_VERSION'],
    ];
    for (const [label, text, code] of cases) {
      repo.write('docstamp-lock.yaml', text);
      const result = await repo.run([], { label, show: ['docstamp-lock.yaml'] });
      seen.add(code);
      expect(result.exit, label).toBe(2);
      expect(result.stderr, label).toContain(`error: ${code}`);
      expect(result.stdout, label).toBe('');
    }
    repo.write('docstamp-lock.yaml', good);
    repo.write('docsync.lock', 'version: 1\n');
    const legacy = await repo.run([], { label: 'docsync.lock present', show: [] });
    expect(legacy.stderr).toContain('E_LOCK_VERSION: docsync.lock');
  },
);

scenario(
  '§6 E_ROOT for --root that is not an existing directory',
  { fixture: 'docs-site' },
  async (repo) => {
    await run(repo, 'missing directory', ['--root', 'nope'], 2, ['E_ROOT'], []);
    await run(repo, 'a file, not a directory', ['--root', 'CLAUDE.md'], 2, ['E_ROOT'], []);
    await run(repo, 'update', ['update', '--all', '--root=nope'], 2, ['E_ROOT'], []);
    await run(
      repo,
      'list-dependencies',
      ['list-dependencies', '--root', 'nope'],
      2,
      ['E_ROOT'],
      [],
    );
    const json = await repo.run(['list-dependents', '--json', '--root', 'nope', 'x']);
    expect(json.exit).toBe(2);
    expect(json.json().diagnostics[0].code).toBe('E_ROOT');
    expect(json.json().files).toEqual([]);
    const absolute = await repo.run([`--root=${repo.root}`, '--json']);
    expect(absolute.json().summary.stale).toBe(3);
  },
);

scenario(
  '§15 E_USAGE, E_UNKNOWN_FILE and W_ORPHAN as the CLI reports them',
  { fixture: 'docs-site' },
  async (repo) => {
    await run(repo, 'usage', ['--bogus'], 2, ['E_USAGE'], []);
    await run(repo, 'unknown file', ['nope.md'], 2, ['E_UNKNOWN_FILE'], []);
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.write(
      'docstamp.yaml',
      repo.read('docstamp.yaml').replace(/ {2}docs\/guide\.md:[^]*$/u, ''),
    );
    await run(repo, 'orphan entry is a warning, exit 0', [], 0, ['W_ORPHAN'], []);
    const json = (await repo.run(['--json'])).json();
    expect(json.diagnostics).toEqual([
      expect.objectContaining({ code: 'W_ORPHAN', severity: 'warning', subject: 'docs/guide.md' }),
    ]);
  },
);

scenario(
  '§11.3 an unwritable root fails the update with E_UNREADABLE and writes nothing',
  { fixture: 'docs-site', skipIf: cannotChmod },
  async (repo) => {
    repo.chmod('.', 0o555);
    const result = await repo.run(['update', '--all'], { label: 'read-only root' });
    expect(result.exit).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('error: E_UNREADABLE: docstamp-lock.yaml');
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);
    expect(repo.list()).toEqual(['CLAUDE.md', 'README.md', 'docs', 'docstamp.yaml', 'src']);
  },
);

scenario(
  '§16 exit 70 for an unexpected internal failure (injected)',
  { fixture: 'docs-site' },
  async (repo) => {
    const injected = repo.at('.');
    injected.write(
      'inject.mjs',
      "process.stdout.write = () => {\n  throw new Error('injected');\n};\n",
    );
    const env = { NODE_OPTIONS: `--import=${injected.path('inject.mjs')}` };
    const result = await repo.run([], { env, snapshot: false });
    expect(result.exit).toBe(70);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^internal error: Error: injected/u);
    const healthy = await repo.run([], { snapshot: false });
    expect(healthy.exit).toBe(1);
  },
);

scenario(
  '§12.4 E_HISTORY: no work tree, and a --since of no kind',
  { git: false },
  async (repo) => {
    base(repo);
    repo.write('docstamp.yaml', config({ 'DOC.md': ['src'] }));
    await run(repo, 'stats outside a git work tree', ['stats'], 2, ['E_HISTORY']);
    repo.git('init', '-q');
    repo.commit('base', '2026-01-01T09:00:00Z');
    await run(repo, 'stats with a --since of no kind', ['stats', '--since', 'soon'], 2, [
      'E_HISTORY',
    ]);
  },
);

it('every diagnostic code of SPEC §15 is exercised through the CLI', () => {
  const spec = readFileSync(new URL('../../../docs/SPEC.md', import.meta.url), 'utf8');
  const table = spec.slice(spec.indexOf('## 15 Diagnostics'), spec.indexOf('## 16 Exit Codes'));
  const codes = [...table.matchAll(/^\| `([EW]_[A-Z_]+)`/gmu)].map((m) => m[1]!);
  expect(codes.length).toBeGreaterThanOrEqual(18);
  const missing = codes.filter((code) => !seen.has(code) && !unreachable.has(code));
  expect(missing).toEqual([]);
});
