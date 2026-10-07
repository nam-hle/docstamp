import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { config, scenario } from '../harness/index.ts';

const packageVersion = (
  JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

scenario('§13.1 help: every spelling prints usage and exits 0', { git: false }, async (repo) => {
  const help = await repo.run(['help']);
  expect(help.exit).toBe(0);
  expect(help.stderr).toBe('');
  expect(help.stdout).toContain('docstamp');
  expect(help.stdout).toContain('list-dependents');

  for (const args of [
    ['--help'],
    ['help', '--bogus'],
    ['--help', 'update', '--all', 'x'],
    ['--json', 'help'],
  ]) {
    const same = await repo.run(args, { snapshot: false });
    expect(same, args.join(' ')).toMatchObject({ exit: 0, stdout: help.stdout, stderr: '' });
  }
  const winsOverVersion = await repo.run(['--version', '--help'], { snapshot: false });
  expect(winsOverVersion.stdout).toBe(help.stdout);
  const afterDashes = await repo.run(['--', '--help'], { snapshot: false });
  expect(afterDashes.exit).toBe(2);
});

scenario(
  '§13.1 version: every spelling prints the package version',
  { git: false },
  async (repo) => {
    for (const args of [
      ['version'],
      ['--version'],
      ['version', '--bogus'],
      ['--version', 'update'],
    ]) {
      const result = await repo.run(args, { snapshot: false });
      expect(result, args.join(' ')).toMatchObject({
        exit: 0,
        stdout: `${packageVersion}\n`,
        stderr: '',
      });
    }
    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+/u);
  },
);

scenario('§13.2 usage errors exit 2 before any root discovery', { git: false }, async (repo) => {
  const cases: [string[], string][] = [
    [['--bogus'], 'E_USAGE: --bogus'],
    [['-x'], 'E_USAGE: -x'],
    [['--root'], 'E_USAGE: --root'],
    [['check', '--root'], '--root needs a directory'],
    [['--root', '--json'], '--root needs a directory'],
    [['--root', '--root', '.'], '--root needs a directory'],
    [['--root', '--root=.'], '--root needs a directory'],
    [['--root', '--'], '--root needs a directory'],
    [['--root', '--all', 'update'], '--root needs a directory'],
    [['--root='], '--root needs a directory'],
    [['--root', '.', '--root', '.'], 'E_USAGE: --root'],
    [['--root=.', '--root=.'], 'E_USAGE: --root'],
    [['--json', '--json'], 'E_USAGE: --json'],
    [['--write', 'CLAUDE.md'], 'docstamp update'],
    [['--files'], 'docstamp list-dependencies'],
    [['--all'], 'E_USAGE: --all'],
    [['check', '--all'], 'E_USAGE: --all'],
    [['list-dependencies', '--all'], 'E_USAGE: --all'],
    [['list-dependents', '--all', 'x'], 'E_USAGE: --all'],
    [['update'], 'E_USAGE: update'],
    [['update', '--all', 'CLAUDE.md'], 'E_USAGE'],
    [['list-dependents'], 'E_USAGE: list-dependents'],
  ];
  for (const [args, fragment] of cases) {
    const result = await repo.run(args);
    expect(result.exit, args.join(' ')).toBe(2);
    expect(result.stdout, args.join(' ')).toBe('');
    expect(result.stderr, args.join(' ')).toContain('error: E_USAGE');
    expect(result.stderr, args.join(' ')).toContain(fragment);
    expect(result.stderr, args.join(' ')).not.toContain('E_CONFIG_MISSING');
  }
});

scenario('§13.2 a usage error has no JSON document', { git: false }, async (repo) => {
  const result = await repo.run(['--json', '--bogus']);
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_USAGE: --bogus');
});

scenario(
  '§13.2 the command word counts only in first position',
  { fixture: 'docs-site' },
  async (repo) => {
    const later = await repo.run(['README.md', 'update']);
    expect(later.exit).toBe(2);
    expect(later.stderr).toContain('E_UNKNOWN_FILE: update');
    expect(later.stdout).not.toContain('README.md');

    const second = await repo.run(['check', 'update']);
    expect(second.exit).toBe(2);
    expect(second.stderr).toContain('E_UNKNOWN_FILE: update');
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);

    const options = await repo.run(['--json', 'update', '--all']);
    expect(options.exit).toBe(0);
    expect(options.json().mode).toBe('update');

    const afterFile = await repo.run(['list-dependencies', 'CLAUDE.md', '--json']);
    expect(afterFile.json().mode).toBe('list-dependencies');

    const rootForm = await repo.run([`--root=${repo.root}`, '../CLAUDE.md'], { cwd: 'src' });
    expect(rootForm.exit).toBe(0);
  },
);

scenario('§13.2 a file named like a command is reached after --', async (repo) => {
  repo.write('docstamp.yaml', config({ check: ['src/**'], update: ['src/**'] }));
  repo.write('check', 'not a command\n');
  repo.write('update', 'not a command\n');
  repo.write('src/a.ts', 'a\n');

  const asCommand = await repo.run(['check']);
  expect(asCommand.stdout).toContain('0 ok, 2 stale');

  for (const args of [
    ['check', '--', 'check'],
    ['--', 'check'],
    ['--json', '--', 'check'],
  ]) {
    const result = await repo.run(args);
    expect(result.exit, args.join(' ')).toBe(1);
    const text = args.includes('--json') ? result.json().files[0].file : result.stdout;
    expect(text, args.join(' ')).toContain('check');
    expect(result.stdout, args.join(' ')).not.toContain('STALE    update');
  }

  const written = await repo.run(['update', '--', 'update']);
  expect(written.stdout).toBe('written  update\n');

  const dependents = await repo.run(['list-dependents', '--', 'check']);
  expect(dependents.stdout).toBe('check\n  (no dependents)\n');
  await repo.snapFile('docstamp-lock.yaml');
});

scenario('§13.2 a lone dash is a file argument', { fixture: 'docs-site' }, async (repo) => {
  const result = await repo.run(['-']);
  expect(result.exit).toBe(2);
  expect(result.stderr).toContain('E_UNKNOWN_FILE: -');
});

scenario(
  '§13.2 --only-stale and --quiet are options of check alone',
  { git: false },
  async (repo) => {
    for (const option of ['--only-stale', '--quiet']) {
      for (const args of [
        ['update', option, '--all'],
        ['list-dependencies', option],
        ['list-dependents', option, 'x'],
        ['stats', option],
      ]) {
        const result = await repo.run(args, { snapshot: args[0] === 'update' });
        expect(result.exit, args.join(' ')).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('error: E_USAGE: ' + option);
        expect(result.stderr).toContain('is only valid with "docstamp check"');
      }
    }
  },
);
