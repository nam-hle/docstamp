import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/args.ts';
import { Raised } from '../../src/core/diagnostics.ts';

const failure = (argv: string[]) => {
  try {
    parseArgs(argv);
  } catch (e) {
    const first = (e as Raised).diagnostics[0];
    return first?.code === 'E_USAGE' ? first : undefined;
  }
  return undefined;
};
const usage = (argv: string[]) => failure(argv)?.subject ?? 'NO ERROR';

describe('§13.2 parseArgs', () => {
  it('a bare command line is check', () => {
    expect(parseArgs([])).toEqual({
      mode: 'check',
      json: false,
      onlyStale: false,
      quiet: false,
      undeclared: false,
      limit: 10,
      paths: [],
    });
    expect(parseArgs(['a.md', '--json'])).toEqual({
      mode: 'check',
      json: true,
      onlyStale: false,
      quiet: false,
      undeclared: false,
      limit: 10,
      paths: ['a.md'],
    });
  });
  it('an explicit check is the same as a bare one', () => {
    expect(parseArgs(['check', 'a.md', '--cwd', 'x'])).toEqual({
      mode: 'check',
      json: false,
      onlyStale: false,
      quiet: false,
      undeclared: false,
      limit: 10,
      cwd: 'x',
      paths: ['a.md'],
    });
  });
  it('the first argument selects the command', () => {
    expect(parseArgs(['update', '--all'])).toMatchObject({ mode: 'update', all: true });
    expect(parseArgs(['list-dependencies', 'a.md'])).toEqual({
      mode: 'list-dependencies',
      json: false,
      paths: ['a.md'],
    });
  });
  it('the command is the first non-option argument', () => {
    expect(parseArgs(['--json', 'update', 'D.md'])).toEqual({
      mode: 'update',
      all: false,
      json: true,
      paths: ['D.md'],
    });
    expect(parseArgs(['--cwd', 'd', 'update', '--all'])).toMatchObject({
      mode: 'update',
      all: true,
      cwd: 'd',
    });
    expect(parseArgs(['--cwd=d', 'list-dependencies'])).toMatchObject({
      mode: 'list-dependencies',
    });
  });
  it('a command word after a file or after -- is a file argument', () => {
    expect(parseArgs(['x', 'check'])).toMatchObject({ mode: 'check', paths: ['x', 'check'] });
    expect(parseArgs(['x', 'update'])).toMatchObject({ mode: 'check', paths: ['x', 'update'] });
    expect(parseArgs(['--json', '--', 'update'])).toMatchObject({
      mode: 'check',
      json: true,
      paths: ['update'],
    });
  });
  it('help and version win over everything else, without E_USAGE', () => {
    for (const [argv, names] of [
      [['check', '--help'], ['check']],
      [['--help', '--json'], []],
      [['help', 'a'], ['a']],
      [['help', '--bogus'], []],
      [['update', '--help', '--all', 'a'], ['update']],
      [['--json', 'help'], []],
      [['a.md', '--help'], []],
      [
        ['help', 'diagnostics', 'E_USAGE'],
        ['diagnostics', 'E_USAGE'],
      ],
      [['version', '--help'], ['version']],
      [['help', '--help', 'stats'], ['stats']],
    ] as const) {
      const json = (argv as readonly string[]).includes('--json') ? { json: true } : {};
      expect(parseArgs([...argv]), argv.join(' ')).toEqual({ mode: 'help', names, ...json });
    }
    for (const argv of [
      ['--version', 'a'],
      ['update', '--version'],
      ['version', '--json'],
    ]) {
      expect(parseArgs(argv)).toEqual({ mode: 'version' });
    }
    expect(parseArgs(['--version', '--help'])).toEqual({ mode: 'help', names: [] });
  });
  it('E_USAGE messages state the problem', () => {
    const message = (argv: string[]) => failure(argv)?.message;
    expect(message(['check', '--all'])).toContain('only valid with "docstamp update"');
    expect(message(['update'])).toBe(
      'Name the files you reviewed, or pass --all; see docstamp help update.',
    );
    expect(message(['update', '--all', 'a'])).toBe(
      'Pass either files or --all, not both; see docstamp help update.',
    );
    expect(message(['--json', '--json'])).toBe('--json given twice; see docstamp help.');
    expect(message(['--bogus'])).toBe('Unknown option --bogus; see docstamp help.');
    expect(message(['stats', '--bogus'])).toBe('Unknown option --bogus; see docstamp help stats.');
  });
  it('a file named like a command is reached after --', () => {
    expect(parseArgs(['check', '--', 'check'])).toMatchObject({ mode: 'check', paths: ['check'] });
    expect(parseArgs(['--', 'update'])).toMatchObject({ mode: 'check', paths: ['update'] });
    expect(parseArgs(['update', '--', 'help'])).toMatchObject({ mode: 'update', paths: ['help'] });
  });
  it('a mistyped command is E_USAGE naming the near command, even with --help or -h', () => {
    const near = (argv: string[]) => [failure(argv)?.subject, failure(argv)?.message];
    const typo = [
      'updte',
      'Unknown command "updte"; did you mean "update"? A file of that name is named after --, ' +
        'as in docstamp -- updte; see docstamp help.',
    ];
    expect(near(['updte'])).toEqual(typo);
    expect(near(['updte', '--help'])).toEqual(typo);
    expect(near(['updte', '-h'])).toEqual(typo);
    expect(near(['-h', 'updte'])).toEqual(typo);
    expect(near(['--json', 'updte', 'a.md'])).toEqual(typo);
    expect(near(['--version', 'updte'])).toEqual(typo);
    expect(failure(['chek'])?.message).toContain('did you mean "check"?');
    expect(failure(['stat'])?.message).toContain('did you mean "stats"?');
    expect(failure(['list-dependent', 'a'])?.message).toContain('"list-dependents"?');
  });
  it('an existing path, a later word, a far word or -- keeps meaning a file', () => {
    expect(parseArgs(['updte'], (arg) => arg === 'updte')).toMatchObject({
      mode: 'check',
      paths: ['updte'],
    });
    expect(parseArgs(['--', 'updte'])).toMatchObject({ mode: 'check', paths: ['updte'] });
    expect(parseArgs(['check', 'updte'])).toMatchObject({ mode: 'check', paths: ['updte'] });
    expect(parseArgs(['README.md'])).toMatchObject({ mode: 'check', paths: ['README.md'] });
    expect(parseArgs(['README.md', '--help'])).toEqual({ mode: 'help', names: [] });
  });
  it('asks the file system only for a word near a command name', () => {
    const asked: string[] = [];
    const exists = (arg: string) => {
      asked.push(arg);
      return true;
    };
    parseArgs(['docs/guide.md'], exists);
    parseArgs(['updte'], exists);
    expect(asked).toEqual(['updte']);
  });
  it('--only-stale and --quiet belong to check alone', () => {
    expect(parseArgs(['--only-stale', '--quiet', '--json'])).toMatchObject({
      mode: 'check',
      onlyStale: true,
      quiet: true,
    });
    expect(parseArgs(['check', '--quiet'])).toMatchObject({ onlyStale: false, quiet: true });
    for (const option of ['--only-stale', '--quiet', '--undeclared']) {
      for (const command of ['update', 'list-dependencies', 'list-dependents', 'stats']) {
        const argv = [command, option, command === 'update' ? '--all' : 'a.md'];
        expect(usage(argv), argv.join(' ')).toBe(option);
      }
      expect(usage([option, option])).toBe(option);
    }
    expect(parseArgs(['--help', '--quiet'])).toEqual({ mode: 'help', names: [] });
  });
  it('--undeclared is an option of check', () => {
    expect(parseArgs(['--undeclared'])).toMatchObject({ mode: 'check', undeclared: true });
    expect(parseArgs(['check', 'a.md', '--undeclared'])).toMatchObject({
      undeclared: true,
      paths: ['a.md'],
    });
    expect(usage(['check', '--undeclared', '--undeclared'])).toBe('--undeclared');
  });
  it('--limit pages --undeclared: a count, 0 for all, a default of 10', () => {
    expect(parseArgs(['check', '--undeclared', '--limit', '3'])).toMatchObject({ limit: 3 });
    expect(parseArgs(['--undeclared', '--limit=0'])).toMatchObject({ limit: 0 });
    expect(parseArgs(['--undeclared'])).toMatchObject({ limit: 10 });
    expect(parseArgs(['--json', '--undeclared', '--limit', '25'])).toMatchObject({ limit: 25 });
  });
  it('--limit needs --undeclared and a whole number', () => {
    expect(usage(['check', '--limit', '3'])).toBe('--limit');
    expect(usage(['--limit', '3', 'a.md'])).toBe('--limit');
    for (const value of ['-1', '2.5', 'ten', '010', '1000000000', '1e3', '+3']) {
      const argv = ['check', '--undeclared', `--limit=${value}`];
      expect(usage(argv), argv.join(' ')).toBe('--limit');
      expect(failure(argv)?.message).toContain('whole number');
    }
    expect(usage(['check', '--undeclared', '--limit', '-1'])).toBe('--limit');
    expect(usage(['check', '--undeclared', '--limit'])).toBe('--limit');
    expect(usage(['check', '--undeclared', '--limit', '--json'])).toBe('--limit');
    expect(usage(['check', '--undeclared', '--limit=', 'a.md'])).toBe('--limit');
    expect(usage(['check', '--undeclared', '--limit', '1', '--limit', '2'])).toBe('--limit');
  });
  it('--limit is refused by the other commands', () => {
    for (const command of ['list-dependencies', 'list-dependents', 'stats']) {
      const argv = [command, '--limit', '3', 'a.md'];
      expect(usage(argv), argv.join(' ')).toBe('--limit');
    }
    expect(usage(['update', '--limit', '3', '--all'])).toBe('--limit');
  });
  it('--cwd forms and --', () => {
    expect(parseArgs(['--cwd=x', '--', '--json'])).toMatchObject({ cwd: 'x', paths: ['--json'] });
    expect(parseArgs(['--cwd', 'x'])).toMatchObject({ cwd: 'x' });
    expect(parseArgs(['list-dependencies', '--cwd=x'])).toMatchObject({ cwd: 'x' });
  });
  it('update needs exactly one of --all or files', () => {
    expect(parseArgs(['update', 'a'])).toEqual({
      mode: 'update',
      all: false,
      json: false,
      paths: ['a'],
    });
    expect(usage(['update'])).toBe('update');
    expect(usage(['update', '--json'])).toBe('update');
    expect(usage(['update', '--all', 'a'])).toBe('--all');
  });
  it.each([
    [['--bogus'], '--bogus'],
    [['--json', '--json'], '--json'],
    [['update', '--all', '--all'], '--all'],
    [['--cwd'], '--cwd'],
    [['--cwd='], '--cwd'],
    [['--cwd', '--json'], '--cwd'],
    [['--cwd', '--cwd=x'], '--cwd'],
    [['--cwd', '--'], '--cwd'],
    [['--cwd', '--write'], '--cwd'],
    [['--cwd', 'a', '--cwd=b'], '--cwd'],
    [['list-dependencies', '--json', '--json'], '--json'],
    [['--all'], '--all'],
    [['--cwd', 'd', 'update'], 'update'],
    [['check', '--all'], '--all'],
    [['list-dependencies', '--all'], '--all'],
    [['list-dependents'], 'list-dependents'],
    [['list-dependents', '--json'], 'list-dependents'],
    [['list-dependents', '--all', 'a'], '--all'],
    [['-x'], '-x'],
    [['update', '-x', 'a'], '-x'],
  ])('rejects %j', (argv, subject) => expect(usage(argv)).toBe(subject));
  it('--write is removed and names its replacement', () => {
    for (const argv of [
      ['--write', 'a'],
      ['--write', '--all'],
      ['check', '--write'],
    ]) {
      expect(usage(argv)).toBe('--write');
      expect(failure(argv)?.message).toContain('docstamp update');
    }
  });
  it('--files is removed and names its replacement', () => {
    for (const argv of [['--files'], ['--files', 'a'], ['update', '--files', 'a']]) {
      expect(usage(argv)).toBe('--files');
      expect(failure(argv)?.message).toContain('docstamp list-dependencies');
    }
  });
  it('a removed option after -- is a file argument', () => {
    expect(parseArgs(['--', '--write'])).toMatchObject({ mode: 'check', paths: ['--write'] });
  });
  it('a lone - is a file argument', () => {
    expect(parseArgs(['-'])).toMatchObject({ paths: ['-'] });
  });
  it('help and version alone', () => {
    expect(parseArgs(['--help'])).toEqual({ mode: 'help', names: [] });
    expect(parseArgs(['help'])).toEqual({ mode: 'help', names: [] });
    expect(parseArgs(['--version'])).toEqual({ mode: 'version' });
    expect(parseArgs(['version'])).toEqual({ mode: 'version' });
  });
});

describe('§13.2 list-dependents', () => {
  it('takes file arguments and the common options', () => {
    expect(parseArgs(['list-dependents', '--json', 'a', 'b'])).toEqual({
      mode: 'list-dependents',
      json: true,
      paths: ['a', 'b'],
      transitive: false,
    });
    expect(parseArgs(['list-dependents', '--', 'check'])).toMatchObject({ paths: ['check'] });
  });
  it('--transitive is a flag of list-dependents only, in any position', () => {
    expect(parseArgs(['list-dependents', 'a', '--transitive'])).toMatchObject({
      transitive: true,
    });
    expect(parseArgs(['--transitive', 'list-dependents', 'a'])).toMatchObject({
      transitive: true,
    });
  });
  it.each([['check'], ['update', '--all'], ['list-dependencies'], ['stats']])(
    '--transitive with %s is E_USAGE',
    (...argv) => {
      expect(() => parseArgs([...argv, '--transitive'])).toThrow(
        expect.objectContaining({
          diagnostics: [expect.objectContaining({ code: 'E_USAGE', subject: '--transitive' })],
        }),
      );
    },
  );
  it('--transitive given twice is E_USAGE', () => {
    expect(() => parseArgs(['list-dependents', 'a', '--transitive', '--transitive'])).toThrow();
  });
});

describe('§13.2 suggest', () => {
  it('takes file arguments, --write and the common options', () => {
    expect(parseArgs(['suggest', 'a.md'])).toEqual({
      mode: 'suggest',
      json: false,
      paths: ['a.md'],
      write: false,
      limit: 10,
      maxFiles: 50,
      all: false,
    });
    expect(parseArgs(['--write', 'suggest', '--json', '--cwd', 'r', 'a.md', 'b.md'])).toEqual({
      mode: 'suggest',
      json: true,
      cwd: 'r',
      paths: ['a.md', 'b.md'],
      write: true,
      limit: 10,
      maxFiles: 50,
      all: false,
    });
  });
  it('needs a file argument', () => {
    expect(usage(['suggest'])).toBe('suggest');
    expect(usage(['suggest', '--write', '--json'])).toBe('suggest');
  });
  it('--write is for suggest alone, the other commands still refuse it', () => {
    for (const argv of [
      ['--write'],
      ['check', '--write'],
      ['update', '--write', 'a'],
      ['stats', '--write'],
    ]) {
      expect(usage(argv)).toBe('--write');
      expect(failure(argv)?.message).toContain('docstamp update');
    }
    expect(usage(['suggest', '--write', '--write', 'a'])).toBe('--write');
  });
  it('--all stands for every declared file, alone', () => {
    expect(parseArgs(['suggest', '--all', '--json'])).toEqual({
      mode: 'suggest',
      json: true,
      paths: [],
      write: false,
      limit: 10,
      maxFiles: 50,
      all: true,
    });
    expect(usage(['suggest', '--all', 'a'])).toBe('--all');
    expect(usage(['suggest', '--all', '--write'])).toBe('--all');
    expect(usage(['suggest', '--all', '--all'])).toBe('--all');
    for (const command of ['check', 'list-dependencies', 'list-dependents', 'stats']) {
      expect(usage([command, '--all', 'a'])).toBe('--all');
    }
  });
  it('--limit pages --all and nothing else', () => {
    expect(parseArgs(['suggest', '--all', '--limit', '3'])).toMatchObject({ all: true, limit: 3 });
    expect(parseArgs(['suggest', '--all', '--limit=0'])).toMatchObject({ limit: 0 });
    expect(usage(['suggest', '--limit', '3', 'a.md'])).toBe('--limit');
    expect(usage(['suggest', '--write', '--limit', '3', 'a.md'])).toBe('--limit');
    expect(usage(['suggest', '--all', '--limit', 'x'])).toBe('--limit');
    expect(usage(['suggest', '--all', '--limit'])).toBe('--limit');
  });
  it('--max-files sets the cap, 0 removes it, with or without --all', () => {
    expect(parseArgs(['suggest', '--max-files', '3', 'a.md'])).toMatchObject({ maxFiles: 3 });
    expect(parseArgs(['suggest', '--all', '--max-files=0'])).toMatchObject({ maxFiles: 0 });
    expect(parseArgs(['suggest', 'a.md'])).toMatchObject({ maxFiles: 50 });
  });
  it('--max-files needs a whole number and suggest', () => {
    for (const value of ['-1', '2.5', 'ten', '010', '1000000000', '1e3', '+3']) {
      const argv = ['suggest', `--max-files=${value}`, 'a.md'];
      expect(usage(argv), argv.join(' ')).toBe('--max-files');
      expect(failure(argv)?.message).toContain('whole number');
    }
    expect(usage(['suggest', '--max-files', '--json', 'a.md'])).toBe('--max-files');
    expect(usage(['suggest', '--max-files', '1', '--max-files', '2', 'a.md'])).toBe('--max-files');
    for (const command of ['check', 'update', 'list-dependencies', 'list-dependents', 'stats']) {
      expect(usage([command, '--max-files', '3', 'a.md'])).toBe('--max-files');
    }
  });
  it('--since and --from are refused', () => {
    expect(usage(['suggest', '--since', '30d', 'a'])).toBe('--since');
    expect(usage(['suggest', '--from', 'main', 'a'])).toBe('--from');
  });
  it('the word suggest is the command only first; a file named suggest is reached after --', () => {
    expect(parseArgs(['--', 'suggest'])).toMatchObject({ mode: 'check', paths: ['suggest'] });
    expect(parseArgs(['check', 'suggest'])).toMatchObject({ mode: 'check', paths: ['suggest'] });
    expect(parseArgs(['suggest', 'suggest'])).toMatchObject({
      mode: 'suggest',
      paths: ['suggest'],
    });
  });
});
