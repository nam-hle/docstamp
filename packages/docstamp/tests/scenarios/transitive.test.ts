import { expect } from 'vitest';
import { scenario } from './harness/index.ts';

const fixture = 'doc-chain';

scenario(
  '§13.8 list-dependents --transitive shows the chains of docs that depend on docs',
  { fixture },
  async (repo) => {
    const direct = await repo.run(['list-dependents', 'src/core/hash.ts']);
    expect(direct.stdout).toBe('src/core/hash.ts\n  docs/GUIDE.md   via src/core\n');

    const result = await repo.run(['list-dependents', '--transitive', 'src/core/hash.ts']);
    expect(result).toMatchObject({ exit: 0, stderr: '' });
    expect(result.stdout).toBe(
      'src/core/hash.ts\n' +
        '  docs/GUIDE.md   via src/core\n' +
        '    README.md          via docs/GUIDE.md\n' +
        '      docs/OVERVIEW.md   via README.md\n' +
        '    docs/OVERVIEW.md   via docs/GUIDE.md (listed above)\n',
    );
  },
);

scenario(
  '§13.8 --transitive prints a cycle once and stops, in text and in JSON',
  { fixture },
  async (repo) => {
    const text = await repo.run(['list-dependents', '--transitive', 'src/cli/run.ts']);
    expect(text.exit).toBe(0);
    expect(text.stdout).toBe(
      'src/cli/run.ts\n' +
        '  README.md     via src/cli\n' +
        '    docs/OVERVIEW.md   via README.md\n' +
        '  docs/API.md   via src/cli\n' +
        '    docs/NOTES.md   via docs/API.md\n' +
        '      docs/API.md   via docs/NOTES.md (cycle)\n',
    );

    const argument = await repo.run(['list-dependents', '--transitive', 'docs/NOTES.md']);
    expect(argument.stdout).toBe(
      'docs/NOTES.md\n' +
        '  docs/API.md   via docs/NOTES.md\n' +
        '    docs/NOTES.md   via docs/API.md (cycle)\n',
    );

    const json = (
      await repo.run(['list-dependents', '--transitive', '--json', 'docs/NOTES.md'])
    ).json();
    expect(json.files).toEqual([
      {
        file: 'docs/NOTES.md',
        dependents: [
          {
            file: 'docs/API.md',
            via: ['docs/NOTES.md'],
            dependents: [
              {
                file: 'docs/NOTES.md',
                via: ['docs/API.md'],
                dependents: [],
                cycle: true,
                repeated: false,
              },
            ],
            cycle: false,
            repeated: false,
          },
        ],
        diagnostics: [],
      },
    ]);
    expect(Object.keys(json.files[0].dependents[0])).toEqual([
      'file',
      'via',
      'dependents',
      'cycle',
      'repeated',
    ]);
  },
);

scenario(
  '§13.8 --transitive lists several arguments, each with its own chains',
  { fixture },
  async (repo) => {
    const result = await repo.run([
      'list-dependents',
      '--transitive',
      'docs/OVERVIEW.md',
      'docs/GUIDE.md',
    ]);
    expect(result.exit).toBe(0);
    expect(result.stdout).toBe(
      'docs/GUIDE.md\n' +
        '  README.md          via docs/GUIDE.md\n' +
        '    docs/OVERVIEW.md   via README.md (listed below)\n' +
        '  docs/OVERVIEW.md   via docs/GUIDE.md\n' +
        'docs/OVERVIEW.md\n' +
        '  (no dependents)\n',
    );
  },
);

scenario(
  '§13.8 and §14.7 text shows a direct dependent at the first level, JSON keeps DependentTree',
  { fixture },
  async (repo) => {
    const json = (
      await repo.run(['list-dependents', '--transitive', '--json', 'docs/GUIDE.md'])
    ).json();
    const [readme, overview] = json.files[0].dependents;
    expect(readme.dependents[0]).toMatchObject({ file: 'docs/OVERVIEW.md', repeated: false });
    expect(overview).toMatchObject({ dependents: [], cycle: false, repeated: true });
    expect(Object.keys(overview)).toEqual(['file', 'via', 'dependents', 'cycle', 'repeated']);
  },
);

scenario(
  '§12.2 and §13.8 the verdict reaches one level at a time; --transitive shows the rest',
  { fixture },
  async (repo) => {
    repo.commit('initial');
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.commit('review');
    expect((await repo.run([])).stdout).toBe('5 ok, 0 stale, 0 invalid\n');

    repo.append('src/core/hash.ts', 'export const more = 1;\n');
    const stale = await repo.run([], { show: ['src/core/hash.ts'] });
    expect(stale.exit).toBe(1);
    expect(stale.stdout).toContain('STALE    docs/GUIDE.md  (content-changed)\n');
    expect(stale.stdout).toContain('4 ok, 1 stale, 0 invalid\n');

    const chain = await repo.run(['list-dependents', '--transitive', 'src/core/hash.ts']);
    expect(chain.exit).toBe(0);
    expect(chain.stdout).toContain('README.md');
    expect(chain.stdout).toContain('docs/OVERVIEW.md');
  },
);

scenario(
  '§13.8 --transitive does not follow a doc with an invalid block, and still reports it',
  { fixture },
  async (repo) => {
    repo.write(
      'docs/BROKEN.md',
      '---\ndocstamp:\n  dependencies: [README.md]\n  extra: 1\n---\nbody\n',
    );
    const result = await repo.run(['list-dependents', '--transitive', 'src/core/hash.ts']);
    expect(result.exit).toBe(2);
    expect(result.stdout).not.toContain('BROKEN');
    expect(result.stderr).toContain('error: E_UNKNOWN_KEY: docs/BROKEN.md: extra: ');
  },
);

scenario('§13.2 --transitive is valid with list-dependents only', { fixture }, async (repo) => {
  for (const args of [['check'], ['list-dependencies'], ['stats'], ['update', '--all']]) {
    const result = await repo.run([...args, '--transitive'], {
      expectExit: 2,
      label: `${args.join(' ')} --transitive`,
    });
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'error: E_USAGE: --transitive: --transitive is only valid with "docstamp list-dependents"; see docstamp help',
    );
  }
  const twice = await repo.run(['list-dependents', 'README.md', '--transitive', '--transitive'], {
    expectExit: 2,
  });
  expect(twice.stderr).toContain(
    'error: E_USAGE: --transitive: --transitive given twice; see docstamp help list-dependents.',
  );
});
