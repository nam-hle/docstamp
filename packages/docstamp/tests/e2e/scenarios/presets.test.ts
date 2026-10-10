import { expect } from 'vitest';
import { scenario, type Repo } from '../harness/index.ts';

const fixture = 'presets';

async function reviewedRepo(repo: Repo): Promise<void> {
  repo.commit('initial');
  await repo.run(['update', '--all'], { expectExit: 0 });
  repo.commit('review');
}

scenario(
  '§8.6 list-dependencies shows the expanded patterns and the preset of each',
  { fixture },
  async (repo) => {
    const text = await repo.run(['list-dependencies']);
    expect(text.exit).toBe(0);
    expect(text.stderr).toBe('');
    expect(text.stdout).toBe(
      'CLAUDE.md\n' +
        '  depends   src\n' +
        '  depends   !**/*.test.ts (preset tests)\n' +
        '  depends   !**/__test__/** (preset tests)\n' +
        '  resolved  src/cli/run.ts\n' +
        '  resolved  src/core/hash.ts\n' +
        '  resolved  src/index.ts\n' +
        'README.md\n' +
        '  depends   src/cli\n' +
        '  depends   !**/*.test.ts (preset tests)\n' +
        '  depends   !**/__test__/** (preset tests)\n' +
        '  depends   docs/SPEC.md (preset spec)\n' +
        '  resolved  docs/SPEC.md\n' +
        '  resolved  src/cli/run.ts\n' +
        'docs/GUIDE.md\n' +
        '  depends   src/core\n' +
        '  depends   !**/*.test.ts (preset tests)\n' +
        '  depends   !**/__test__/** (preset tests)\n' +
        '  resolved  src/core/hash.ts\n',
    );

    const json = (await repo.run(['list-dependencies', '--json', 'README.md'])).json();
    expect(json.files).toEqual([
      {
        file: 'README.md',
        dependencies: ['src/cli', '!**/*.test.ts', '!**/__test__/**', 'docs/SPEC.md'],
        use: ['tests', 'spec'],
        origins: [null, 'tests', 'tests', 'spec'],
        resolvedFiles: ['docs/SPEC.md', 'src/cli/run.ts'],
        diagnostics: [],
      },
    ]);
  },
);

scenario('§14.3 §14.5 check shows the preset of each pattern', { fixture }, async (repo) => {
  const text = await repo.run(['README.md']);
  expect(text.exit).toBe(1);
  expect(text.stdout).toContain(
    'STALE    README.md  (unrecorded)\n' +
      '  depends   src/cli\n' +
      '  depends   !**/*.test.ts (preset tests)\n' +
      '  depends   !**/__test__/** (preset tests)\n' +
      '  depends   docs/SPEC.md (preset spec)\n',
  );
  const file = (await repo.run(['--json', 'README.md'])).json().files[0];
  expect(Object.keys(file)).toEqual([
    'file',
    'state',
    'reasons',
    'dependencies',
    'use',
    'origins',
    'changes',
    'diagnostics',
  ]);
  expect(file).toMatchObject({
    use: ['tests', 'spec'],
    origins: [null, 'tests', 'tests', 'spec'],
  });
});

scenario(
  '§8.6 a file hashes the files its presets select, nothing else',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    const clean = await repo.run([]);
    expect(clean).toMatchObject({ exit: 0, stdout: '3 ok, 0 stale, 0 invalid\n', stderr: '' });

    repo.append('src/cli/run.test.ts', 'more\n');
    repo.write('src/cli/__test__/helper.ts', 'changed helper\n');
    const excluded = await repo.run([]);
    expect(excluded).toMatchObject({ exit: 0, stdout: '3 ok, 0 stale, 0 invalid\n', stderr: '' });

    repo.append('src/cli/run.ts', 'export const more = 1;\n');
    const stale = await repo.run([]);
    expect(stale.exit).toBe(1);
    expect(stale.stdout).toContain('STALE    CLAUDE.md  (content-changed)\n');
    expect(stale.stdout).toContain('STALE    README.md  (content-changed)\n');
    expect(stale.stdout).toContain('1 ok, 2 stale, 0 invalid\n');
  },
);

scenario(
  '§8.6 editing a preset is a change to exactly the files whose dependencies it changes',
  { fixture },
  async (repo) => {
    await reviewedRepo(repo);
    const yaml = repo.read('docstamp.yaml');

    repo.write(
      'docstamp.yaml',
      yaml.replace(
        '    - "!**/*.test.ts"\n    - "!**/__test__/**"\n',
        '    - "!**/__test__/**"\n    - "!**/*.test.ts"\n',
      ),
    );
    const reordered = await repo.run([], { show: ['docstamp.yaml'] });
    expect(reordered).toMatchObject({ exit: 0, stdout: '3 ok, 0 stale, 0 invalid\n' });

    repo.write('docstamp.yaml', yaml.replace('    - "!**/__test__/**"\n', ''));
    const widened = await repo.run([], { show: ['docstamp.yaml'] });
    expect(widened.exit).toBe(1);
    expect(widened.stdout).toContain('STALE    CLAUDE.md  (content-changed)\n');
    expect(widened.stdout).toContain('STALE    README.md  (content-changed)\n');
    expect(widened.stdout).not.toContain('docs/GUIDE.md');
    expect(widened.stdout).toContain('  depends   !**/*.test.ts (preset tests)\n');
    expect(widened.stdout).not.toContain('__test__');
  },
);

scenario(
  '§8.6 the patterns of a preset come after the own patterns of a file, and last match wins',
  { fixture },
  async (repo) => {
    repo.write(
      'docs/EXCLUDED.md',
      '---\ndocstamp:\n  dependencies: [src/cli/run.test.ts, src/cli/run.ts]\n  use: [tests]\n---\nx\n',
    );
    repo.write(
      'docs/REINCLUDED.md',
      '---\ndocstamp:\n  dependencies: [src/cli/run.ts, "!docs/SPEC.md"]\n  use: [spec]\n---\nx\n',
    );
    const list = await repo.run(['list-dependencies', 'docs/EXCLUDED.md', 'docs/REINCLUDED.md']);
    expect(list.exit).toBe(0);
    expect(list.stdout).toBe(
      'docs/EXCLUDED.md\n' +
        '  depends   src/cli/run.test.ts\n' +
        '  depends   src/cli/run.ts\n' +
        '  depends   !**/*.test.ts (preset tests)\n' +
        '  depends   !**/__test__/** (preset tests)\n' +
        '  resolved  src/cli/run.ts\n' +
        'docs/REINCLUDED.md\n' +
        '  depends   src/cli/run.ts\n' +
        '  depends   !docs/SPEC.md\n' +
        '  depends   docs/SPEC.md (preset spec)\n' +
        '  resolved  docs/SPEC.md\n' +
        '  resolved  src/cli/run.ts\n',
    );
  },
);

scenario(
  '§8.6 and §15 an unknown preset invalidates only its file, in a block and in the configuration',
  { fixture },
  async (repo) => {
    repo.write(
      'docs/BLOCK.md',
      '---\ndocstamp:\n  dependencies: [src/core]\n  use: [nope, tests, gone]\n---\nx\n',
    );
    repo.write(
      'docstamp.yaml',
      repo.read('docstamp.yaml') +
        '  docs/SPEC.md:\n    dependencies: [src/index.ts]\n    use: [missing]\n',
    );
    const check = await repo.run([], { show: ['docstamp.yaml', 'docs/BLOCK.md'] });
    expect(check.exit).toBe(2);
    expect(check.stdout).toContain('INVALID  docs/BLOCK.md\n');
    expect(check.stdout).toContain('INVALID  docs/SPEC.md\n');
    expect(check.stdout).toContain('0 ok, 3 stale, 2 invalid\n');
    const codes = [...check.stderr.matchAll(/^error: (E_[A-Z_]+): ([^:]+): ([^:]+):/gmu)].map(
      (m) => `${m[2]}: ${m[1]}: ${m[3]}`,
    );
    expect(codes).toEqual([
      'docs/BLOCK.md: E_UNKNOWN_PRESET: gone',
      'docs/BLOCK.md: E_UNKNOWN_PRESET: nope',
      'docs/SPEC.md: E_UNKNOWN_PRESET: missing',
    ]);

    const json = (await repo.run(['--json', 'docs/BLOCK.md'])).json();
    expect(json.files[0]).toMatchObject({
      file: 'docs/BLOCK.md',
      state: 'invalid',
      dependencies: ['src/core'],
    });
    expect(json.files[0].diagnostics[0]).toMatchObject({
      code: 'E_UNKNOWN_PRESET',
      severity: 'error',
      file: 'docs/BLOCK.md',
      subject: 'gone',
    });
  },
);

scenario(
  '§8.6 an inline block that uses a preset needs a configuration file that defines it',
  { fixture },
  async (repo) => {
    repo.remove('docstamp.yaml');
    const result = await repo.run([], { show: ['README.md'] });
    expect(result.exit).toBe(2);
    expect(result.stdout).toContain('INVALID  README.md\n');
    expect(result.stdout).toContain('INVALID  docs/GUIDE.md\n');
    expect(result.stderr).toContain('error: E_UNKNOWN_PRESET: README.md: spec: ');
    expect(result.stderr).toContain('There is no configuration file');
  },
);

scenario(
  '§9.3 and §9.6.2 a malformed use, or a malformed preset, is an error',
  { fixture },
  async (repo) => {
    const blocks: Record<string, string> = {
      'empty.md': '---\ndocstamp:\n  dependencies: [src/core]\n  use: []\n---\n',
      'duplicate.md': '---\ndocstamp:\n  dependencies: [src/core]\n  use: [tests, tests]\n---\n',
      'scalar.md': '---\ndocstamp:\n  dependencies: [src/core]\n  use: tests\n---\n',
      'only-use.md': '---\ndocstamp:\n  use: [tests]\n---\n',
    };
    for (const [name, text] of Object.entries(blocks)) repo.write(`bad/${name}`, text);
    const blockRun = await repo.run([]);
    expect(blockRun.exit).toBe(2);
    const codes = [
      ...blockRun.stderr.matchAll(/^error: (E_[A-Z_]+): bad\/([^:]+): ([^:]+):/gmu),
    ].map((m) => `${m[2]}: ${m[1]}: ${m[3]}`);
    expect(codes).toEqual([
      'duplicate.md: E_BLOCK: use',
      'empty.md: E_BLOCK: use',
      'only-use.md: E_BLOCK: dependencies',
      'scalar.md: E_BLOCK: use',
    ]);
    for (const name of Object.keys(blocks)) repo.remove(`bad/${name}`);

    const head = 'version: 2\n';
    const files = 'files:\n  CLAUDE.md:\n    dependencies: [src]\n';
    const cases: Array<[string, string, string]> = [
      [
        'a duplicate in use',
        `${head}presets:\n  tests: [x]\n${files}    use: [tests, tests]\n`,
        'use',
      ],
      ['an empty use', `${head}${files}    use: []\n`, 'use'],
      ['an upper case name', `${head}presets:\n  Tests: [x]\n${files}`, 'presets.Tests'],
      [
        'a preset that is a mapping (no nesting)',
        `${head}presets:\n  a:\n    use: [b]\n${files}`,
        'presets.a',
      ],
      ['an empty preset', `${head}presets:\n  a: []\n${files}`, 'presets.a'],
      ['presets that is a list', `${head}presets: [a]\n${files}`, 'presets'],
      ['an invalid pattern in a preset', `${head}presets:\n  a: ["/abs"]\n${files}`, '/abs'],
    ];
    for (const [label, yaml, subject] of cases) {
      repo.write('docstamp.yaml', yaml);
      const result = await repo.run([], { label, show: ['docstamp.yaml'] });
      expect(result.exit).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`: ${subject}: `);
    }
  },
);

scenario(
  '§8.5 and §8.6 a preset exclusion that matches nothing is silent, a preset pattern that matches nothing is not',
  { fixture },
  async (repo) => {
    const silent = await repo.run(['list-dependencies', 'docs/GUIDE.md']);
    expect(silent.stderr).toBe('');
    repo.write(
      'docs/OWN.md',
      '---\ndocstamp:\n  dependencies: [src/core, "!src/core/none.ts"]\n---\nx\n',
    );
    const own = await repo.run(['list-dependencies', 'docs/OWN.md']);
    expect(own.exit).toBe(0);
    expect(own.stderr).toContain('warning: W_EMPTY_EXCLUSION: docs/OWN.md: !src/core/none.ts: ');

    repo.write(
      'docstamp.yaml',
      repo
        .read('docstamp.yaml')
        .replace('  spec:\n    - docs/SPEC.md\n', '  spec:\n    - docs/MISSING.md\n'),
    );
    const missing = await repo.run(['list-dependencies', 'README.md'], { show: ['docstamp.yaml'] });
    expect(missing.exit).toBe(2);
    expect(missing.stderr).toContain('error: E_EMPTY_PATTERN: README.md: docs/MISSING.md: ');
    expect(missing.stderr).toContain('It comes from the preset "spec".');
  },
);

scenario('§13.8 list-dependents names the pattern a preset brought', { fixture }, async (repo) => {
  const result = await repo.run(['list-dependents', 'docs/SPEC.md', 'src/cli/run.ts']);
  expect(result.exit).toBe(0);
  expect(result.stdout).toBe(
    'docs/SPEC.md\n' +
      '  README.md   via docs/SPEC.md\n' +
      'src/cli/run.ts\n' +
      '  CLAUDE.md   via src\n' +
      '  README.md   via src/cli\n',
  );
  const tests = await repo.run(['list-dependents', 'src/cli/run.test.ts']);
  expect(tests.stdout).toBe('src/cli/run.test.ts\n  (no dependents)\n');
});

const DEFAULTS_YAML =
  'version: 2\n' +
  'presets:\n' +
  '  tests:\n    - "!**/*.test.ts"\n    - "!**/__test__/**"\n' +
  '  spec:\n    - docs/SPEC.md\n' +
  '  cli:\n    - src/cli\n' +
  'default-presets: [tests]\n' +
  'files:\n' +
  '  CLAUDE.md:\n    dependencies:\n      - src\n';

scenario(
  '§8.6 default presets come last on every file without its own use, configured or inline',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', DEFAULTS_YAML);
    repo.write('docs/PLAIN.md', '---\ndocstamp:\n  dependencies: [src/core]\n---\nx\n');
    repo.write('docs/OPT.md', '---\ndocstamp:\n  dependencies: [src/core]\n  use: []\n---\nx\n');
    const files = ['CLAUDE.md', 'docs/PLAIN.md', 'docs/OPT.md', 'docs/GUIDE.md'];
    const list = await repo.run(['list-dependencies', ...files], {
      show: ['docstamp.yaml', 'docs/PLAIN.md', 'docs/OPT.md'],
    });
    expect(list).toMatchObject({ exit: 0, stderr: '' });
    expect(list.stdout).toBe(
      'CLAUDE.md\n' +
        '  depends   src\n' +
        '  depends   !**/*.test.ts (preset tests)\n' +
        '  depends   !**/__test__/** (preset tests)\n' +
        '  resolved  src/cli/run.ts\n' +
        '  resolved  src/core/hash.ts\n' +
        '  resolved  src/index.ts\n' +
        'docs/GUIDE.md\n' +
        '  depends   src/core\n' +
        '  depends   !**/*.test.ts (preset tests)\n' +
        '  depends   !**/__test__/** (preset tests)\n' +
        '  resolved  src/core/hash.ts\n' +
        'docs/OPT.md\n' +
        '  depends   src/core\n' +
        '  resolved  src/core/hash.test.ts\n' +
        '  resolved  src/core/hash.ts\n' +
        'docs/PLAIN.md\n' +
        '  depends   src/core\n' +
        '  depends   !**/*.test.ts (preset tests)\n' +
        '  depends   !**/__test__/** (preset tests)\n' +
        '  resolved  src/core/hash.ts\n',
    );

    const json = (
      await repo.run(['list-dependencies', '--json', 'CLAUDE.md', 'docs/OPT.md'])
    ).json();
    expect(json.files).toEqual([
      {
        file: 'CLAUDE.md',
        dependencies: ['src', '!**/*.test.ts', '!**/__test__/**'],
        use: [],
        origins: [null, 'tests', 'tests'],
        resolvedFiles: ['src/cli/run.ts', 'src/core/hash.ts', 'src/index.ts'],
        diagnostics: [],
      },
      {
        file: 'docs/OPT.md',
        dependencies: ['src/core'],
        resolvedFiles: ['src/core/hash.test.ts', 'src/core/hash.ts'],
        diagnostics: [],
      },
    ]);
  },
);

scenario(
  '§8.5 a later default preset that re-selects is W_SHADOWED_EXCLUSION naming it',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', DEFAULTS_YAML.replace('[tests]', '[tests, cli]'));
    const list = await repo.run(['list-dependencies', 'CLAUDE.md'], { show: ['docstamp.yaml'] });
    expect(list.exit).toBe(0);
    expect(list.stderr).toContain('warning: W_SHADOWED_EXCLUSION: CLAUDE.md: !**/*.test.ts: ');
    expect(list.stderr).toContain('preset "cli"');
  },
);

scenario(
  '§8.6 editing default-presets makes stale only the files whose selection changes',
  { fixture },
  async (repo) => {
    repo.write('docstamp.yaml', DEFAULTS_YAML.replace('default-presets: [tests]\n', ''));
    repo.write('docs/ABOUT.md', '---\ndocstamp:\n  dependencies: [docs/SPEC.md]\n---\nx\n');
    await reviewedRepo(repo);
    repo.write('docstamp.yaml', DEFAULTS_YAML.replace('[tests]', '[spec]'));
    const result = await repo.run([], { show: ['docstamp.yaml'] });
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('STALE    CLAUDE.md  (content-changed)\n');
    expect(result.stdout).not.toContain('docs/ABOUT.md');
    expect(result.stdout).toContain('  depends   docs/SPEC.md (preset spec)\n');
    expect(result.stdout).toContain('3 ok, 1 stale, 0 invalid\n');
  },
);

scenario(
  '§9.3 and §15 a malformed or unknown default-presets is a global error',
  { fixture },
  async (repo) => {
    const files = 'files:\n  CLAUDE.md:\n    dependencies: [src]\n';
    const cases: Array<[string, string, string]> = [
      [
        'an unknown name',
        `version: 2\npresets:\n  a: [x]\ndefault-presets: [a, nope]\n${files}`,
        'E_UNKNOWN_PRESET: nope',
      ],
      ['no presets', `version: 2\ndefault-presets: [a]\n${files}`, 'E_UNKNOWN_PRESET: a'],
      [
        'an empty list',
        `version: 2\npresets:\n  a: [x]\ndefault-presets: []\n${files}`,
        'E_CONFIG: default-presets',
      ],
      [
        'a repeated name',
        `version: 2\npresets:\n  a: [x]\ndefault-presets: [a, a]\n${files}`,
        'E_CONFIG: default-presets',
      ],
      [
        'a near miss',
        `version: 2\npresets:\n  a: [x]\ndefault-preset: [a]\n${files}`,
        'E_UNKNOWN_KEY: default-preset',
      ],
    ];
    for (const [label, yaml, expected] of cases) {
      repo.write('docstamp.yaml', yaml);
      const result = await repo.run([], { label, show: ['docstamp.yaml'] });
      expect(result.exit).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`error: ${expected}: `);
    }
    const json = (await repo.run(['--json'])).json();
    expect(json.diagnostics[0]).toMatchObject({ code: 'E_UNKNOWN_KEY', file: null });
  },
);
