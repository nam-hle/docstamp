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
      paths: [],
    });
    expect(parseArgs(['a.md', '--json'])).toEqual({
      mode: 'check',
      json: true,
      onlyStale: false,
      quiet: false,
      paths: ['a.md'],
    });
  });
  it('an explicit check is the same as a bare one', () => {
    expect(parseArgs(['check', 'a.md', '--root', 'x'])).toEqual({
      mode: 'check',
      json: false,
      onlyStale: false,
      quiet: false,
      root: 'x',
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
    expect(parseArgs(['--root', 'd', 'update', '--all'])).toMatchObject({
      mode: 'update',
      all: true,
      root: 'd',
    });
    expect(parseArgs(['--root=d', 'list-dependencies'])).toMatchObject({
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
      expect(parseArgs([...argv]), argv.join(' ')).toEqual({ mode: 'help', names });
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
    for (const option of ['--only-stale', '--quiet']) {
      for (const command of ['update', 'list-dependencies', 'list-dependents', 'stats']) {
        const argv = [command, option, command === 'update' ? '--all' : 'a.md'];
        expect(usage(argv), argv.join(' ')).toBe(option);
      }
      expect(usage([option, option])).toBe(option);
    }
    expect(parseArgs(['--help', '--quiet'])).toEqual({ mode: 'help', names: [] });
  });
  it('--root forms and --', () => {
    expect(parseArgs(['--root=x', '--', '--json'])).toMatchObject({ root: 'x', paths: ['--json'] });
    expect(parseArgs(['--root', 'x'])).toMatchObject({ root: 'x' });
    expect(parseArgs(['list-dependencies', '--root=x'])).toMatchObject({ root: 'x' });
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
    [['--root'], '--root'],
    [['--root='], '--root'],
    [['--root', '--json'], '--root'],
    [['--root', '--root=x'], '--root'],
    [['--root', '--'], '--root'],
    [['--root', '--write'], '--root'],
    [['--root', 'a', '--root=b'], '--root'],
    [['list-dependencies', '--json', '--json'], '--json'],
    [['--all'], '--all'],
    [['--root', 'd', 'update'], 'update'],
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
    });
    expect(parseArgs(['--write', 'suggest', '--json', '--root', 'r', 'a.md', 'b.md'])).toEqual({
      mode: 'suggest',
      json: true,
      root: 'r',
      paths: ['a.md', 'b.md'],
      write: true,
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
  it('--all, --since and --from are refused', () => {
    expect(usage(['suggest', '--all', 'a'])).toBe('--all');
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
