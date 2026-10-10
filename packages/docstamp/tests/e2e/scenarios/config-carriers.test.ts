import { expect } from 'vitest';
import { scenario } from '../harness/index.ts';

const options = { fixture: 'ts-config', linkLib: true };

scenario('§9.5 a docstamp.config.ts carrier drives the whole workflow', options, async (repo) => {
  const first = await repo.run([], { show: ['docstamp.config.ts'] });
  expect(first.exit).toBe(1);
  expect(first.stdout).toContain('STALE    CLAUDE.md  (unrecorded)');
  expect(first.stderr).toBe('');

  expect((await repo.run(['update', 'CLAUDE.md'])).stdout).toBe('written  CLAUDE.md\n');
  expect(await repo.run([])).toMatchObject({ exit: 0, stdout: '1 ok, 0 stale, 0 invalid\n' });
  repo.append('src/a.ts', 'export const b = 2;\n');
  expect((await repo.run([], { cwd: 'src' })).exit).toBe(1);
  await repo.snapFile('docstamp-lock.yaml');
});

scenario('§9.1 every Carrier yields the same lock bytes', options, async (repo) => {
  const locks = new Map<string, string>();
  const names = [
    'docstamp.config.ts',
    'docstamp.config.mts',
    'docstamp.config.js',
    'docstamp.config.mjs',
  ];
  for (const name of names) {
    for (const other of names) repo.remove(other);
    repo.remove('docstamp.yaml');
    repo.write(
      name,
      name === 'docstamp.config.ts' ? repo.fixtureText(name) : repo.fixtureText(`variants/${name}`),
    );
    const update = await repo.run(['update', '--all'], { label: name });
    expect(update.exit, name).toBe(0);
    locks.set(name, repo.read('docstamp-lock.yaml'));
    repo.remove('docstamp-lock.yaml');
  }
  repo.write('docstamp.yaml', 'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies: [src/**]\n');
  for (const name of names) repo.remove(name);
  await repo.run(['update', '--all'], { label: 'docstamp.yaml', expectExit: 0 });
  locks.set('docstamp.yaml', repo.read('docstamp-lock.yaml'));
  expect(new Set(locks.values()).size).toBe(1);
});

scenario('§9.3 two Carriers at one Root are ambiguous', options, async (repo) => {
  repo.write('docstamp.config.mjs', repo.fixtureText('variants/docstamp.config.mjs'));
  const result = await repo.run(['--json']);
  expect(result.exit).toBe(2);
  expect(result.json().diagnostics[0]).toMatchObject({
    code: 'E_CONFIG_AMBIGUOUS',
    subject: 'docstamp.config.ts, docstamp.config.mjs',
  });
});

scenario(
  '§9.5 a script that cannot produce a plain value is E_CONFIG',
  { fixture: 'ts-config' },
  async (repo) => {
    const cases: [string, string][] = [
      ['throws', "throw new Error('boom');\nexport default {};\n"],
      ['syntax error', 'export default {\n'],
      ['top-level await', 'await Promise.resolve();\nexport default { version: 2, files: {} };\n'],
      ['imports a missing module', "import 'nonexistent-module-xyz';\nexport default {};\n"],
      ['exports a function', 'export default () => ({ version: 2 });\n'],
      ['exports undefined', 'export const nothing = undefined;\n'],
      ['class instance', 'class C {}\nexport default new C();\n'],
      [
        'cyclic value',
        'const o: Record<string, unknown> = { version: 2 };\no.files = o;\nexport default o;\n',
      ],
      ['accessor', 'export default { get version() { return 2; }, files: {} };\n'],
      ['proxy', 'export default new Proxy({ version: 2, files: {} }, {});\n'],
      ['not finite', 'export default { version: 2, files: {}, ignore: [Infinity] };\n'],
      [
        'undefined member',
        "export default { version: 2, files: { 'CLAUDE.md': { dependencies: undefined } } };\n",
      ],
      ['enum is not erasable TypeScript', 'enum E { A }\nexport default { version: E.A };\n'],
    ];
    repo.remove('docstamp.config.ts');
    for (const [label, source] of cases) {
      repo.write('docstamp.config.ts', source);
      const result = await repo.run([], { label, show: ['docstamp.config.ts'] });
      expect(result.exit, label).toBe(2);
      expect(result.stderr, label).toContain('error: E_CONFIG');
      expect(result.stderr, label).not.toContain(repo.root);
      expect(result.stderr, label).not.toContain('node:internal');
    }
  },
);

scenario('§9.5 a script value goes through the same validation as YAML', options, async (repo) => {
  repo.write(
    'docstamp.config.ts',
    "export default { version: 2, extra: true, files: { 'CLAUDE.md': { dependencies: ['src//a.ts'] } } };\n",
  );
  const result = await repo.run([], { show: ['docstamp.config.ts'] });
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('error: E_UNKNOWN_KEY: extra');

  repo.write(
    'docstamp.config.ts',
    "export default { version: 2, files: { 'CLAUDE.md': { dependencies: ['src//a.ts'] } } };\n",
  );
  const pattern = await repo.run([], { show: ['docstamp.config.ts'] });
  expect(pattern.stderr).toContain('error: E_PATTERN: CLAUDE.md: src//a.ts');

  repo.write('docstamp.config.ts', 'export default { files: {} };\n');
  expect((await repo.run([])).stderr).toContain('E_CONFIG_VERSION');
});

scenario(
  '§9.5 an ES module with only named exports is E_CONFIG, CommonJS module.exports works',
  options,
  async (repo) => {
    repo.remove('docstamp.config.ts');
    repo.write(
      'docstamp.config.mjs',
      "export const version = 2;\nexport const files = { 'CLAUDE.md': { dependencies: ['src/**'] } };\n",
    );
    const named = await repo.run([], {
      label: 'named exports only',
      show: ['docstamp.config.mjs'],
    });
    expect(named.exit).toBe(2);
    expect(named.stderr).toContain('error: E_CONFIG');
    expect(named.stderr).toContain('export default');
    expect(named.stderr).toContain('module.exports');

    repo.remove('docstamp.config.mjs');
    repo.remove('package.json');
    repo.write(
      'docstamp.config.js',
      "module.exports = { version: 2, files: { 'CLAUDE.md': { dependencies: ['src/**'] } } };\n",
    );
    const commonJs = await repo.run([], {
      label: 'CommonJS module.exports',
      show: ['docstamp.config.js'],
    });
    expect(commonJs).toMatchObject({ exit: 1, stderr: '' });
  },
);

scenario(
  '§9.3 a symlinked configuration file is not a file',
  { fixture: 'no-git', git: false },
  async (repo) => {
    repo.rename('docstamp.yaml', 'real.yaml');
    repo.symlink('docstamp.yaml', 'real.yaml');
    const result = await repo.run([]);
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('error: E_CONFIG_MISSING');
    const json = await repo.run(['list-dependencies', '--json']);
    expect(json.json().diagnostics[0].code).toBe('E_CONFIG_MISSING');
  },
);
