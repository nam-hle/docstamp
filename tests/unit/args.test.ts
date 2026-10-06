import { describe, expect, it } from 'vitest';
import { HELP, parseArgs } from '../../src/cli/args.ts';
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
    expect(parseArgs([])).toEqual({ mode: 'check', json: false, paths: [] });
    expect(parseArgs(['a.md', '--json'])).toEqual({ mode: 'check', json: true, paths: ['a.md'] });
  });
  it('an explicit check is the same as a bare one', () => {
    expect(parseArgs(['check', 'a.md', '--root', 'x'])).toEqual({
      mode: 'check',
      json: false,
      root: 'x',
      paths: ['a.md'],
    });
  });
  it('the first argument selects the command', () => {
    expect(parseArgs(['update', '--all'])).toMatchObject({ mode: 'update', all: true });
    expect(parseArgs(['list-dependents', 'a.md'])).toEqual({
      mode: 'list-dependents',
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
    expect(parseArgs(['--root=d', 'list-dependents'])).toMatchObject({ mode: 'list-dependents' });
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
    for (const argv of [
      ['check', '--help'],
      ['--help', '--json'],
      ['help', 'a'],
      ['help', '--bogus'],
      ['update', '--help', '--all', 'a'],
      ['--json', 'help'],
    ]) {
      expect(parseArgs(argv)).toEqual({ mode: 'help' });
    }
    for (const argv of [
      ['--version', 'a'],
      ['update', '--version'],
      ['version', '--json'],
    ]) {
      expect(parseArgs(argv)).toEqual({ mode: 'version' });
    }
    expect(parseArgs(['--version', '--help'])).toEqual({ mode: 'help' });
  });
  it('E_USAGE messages state the problem', () => {
    const message = (argv: string[]) => failure(argv)?.message;
    expect(message(['check', '--all'])).toContain('only valid with "docsync update"');
    expect(message(['update'])).toBe('Name the files you reviewed, or pass --all.');
    expect(message(['update', '--all', 'a'])).toBe('Pass either files or --all, not both.');
    expect(message(['--json', '--json'])).toBe('--json given twice.');
    expect(message(['--bogus'])).toBe('Unknown option --bogus; see docsync help.');
  });
  it('a file named like a command is reached after --', () => {
    expect(parseArgs(['check', '--', 'check'])).toMatchObject({ mode: 'check', paths: ['check'] });
    expect(parseArgs(['--', 'update'])).toMatchObject({ mode: 'check', paths: ['update'] });
    expect(parseArgs(['update', '--', 'help'])).toMatchObject({ mode: 'update', paths: ['help'] });
  });
  it('--root forms and --', () => {
    expect(parseArgs(['--root=x', '--', '--json'])).toMatchObject({ root: 'x', paths: ['--json'] });
    expect(parseArgs(['--root', 'x'])).toMatchObject({ root: 'x' });
    expect(parseArgs(['list-dependents', '--root=x'])).toMatchObject({ root: 'x' });
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
    [['--root', 'a', '--root=b'], '--root'],
    [['list-dependents', '--json', '--json'], '--json'],
    [['--all'], '--all'],
    [['--root', 'd', 'update'], 'update'],
    [['check', '--all'], '--all'],
    [['list-dependents', '--all'], '--all'],
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
      expect(failure(argv)?.message).toContain('docsync update');
    }
  });
  it('--files is removed and names its replacement', () => {
    for (const argv of [['--files'], ['--files', 'a'], ['update', '--files', 'a']]) {
      expect(usage(argv)).toBe('--files');
      expect(failure(argv)?.message).toContain('docsync list-dependents');
    }
  });
  it('a removed option after -- is a file argument', () => {
    expect(parseArgs(['--', '--write'])).toMatchObject({ mode: 'check', paths: ['--write'] });
  });
  it('a lone - is a file argument', () => {
    expect(parseArgs(['-'])).toMatchObject({ paths: ['-'] });
  });
  it('help and version alone', () => {
    expect(parseArgs(['--help'])).toEqual({ mode: 'help' });
    expect(parseArgs(['help'])).toEqual({ mode: 'help' });
    expect(parseArgs(['--version'])).toEqual({ mode: 'version' });
    expect(parseArgs(['version'])).toEqual({ mode: 'version' });
  });
  it('HELP lists every command and is LF text with a final newline', () => {
    for (const name of ['check', 'update', 'list-dependents', 'help', 'version']) {
      expect(HELP).toContain(`docsync ${name}`);
    }
    expect(HELP.endsWith('\n')).toBe(true);
    expect(HELP).not.toContain('\r');
    const codes = Array.from({ length: HELP.length }, (_, i) => HELP.charCodeAt(i));
    expect(codes.every((code) => code === 10 || (code >= 32 && code <= 126))).toBe(true);
  });
});
