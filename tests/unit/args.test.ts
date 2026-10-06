import { describe, expect, it } from 'vitest';
import { HELP, parseArgs } from '../../src/cli/args.ts';
import { Raised } from '../../src/core/diagnostics.ts';

const usage = (argv: string[]) => {
  try {
    parseArgs(argv);
  } catch (e) {
    const first = (e as Raised).diagnostics[0];
    return first?.code === 'E_USAGE' ? first.subject : first?.code;
  }
  return 'NO ERROR';
};

describe('§13.2 parseArgs', () => {
  it('check is the default', () => {
    expect(parseArgs(['a.md', '--json'])).toEqual({
      mode: 'check',
      files: false,
      json: true,
      paths: ['a.md'],
    });
  });
  it('--root forms and --', () => {
    expect(parseArgs(['--root=x', '--', '--json'])).toMatchObject({ root: 'x', paths: ['--json'] });
    expect(parseArgs(['--root', 'x'])).toMatchObject({ root: 'x' });
  });
  it('write needs exactly one of --all or files', () => {
    expect(parseArgs(['--write', '--all'])).toMatchObject({ mode: 'write', all: true });
    expect(parseArgs(['a', '--write'])).toMatchObject({ mode: 'write', all: false, paths: ['a'] });
    expect(usage(['--write'])).toBe('--write');
    expect(usage(['--write', '--all', 'a'])).toBe('--all');
  });
  it.each([
    [['--bogus'], '--bogus'],
    [['--json', '--json'], '--json'],
    [['--root'], '--root'],
    [['--root='], '--root'],
    [['--root', 'a', '--root=b'], '--root'],
    [['--version', 'a'], '--version'],
    [['--help', '--json'], '--help'],
    [['--files', '--write', 'a'], '--files'],
    [['--all'], '--all'],
    [['-x'], '-x'],
  ])('rejects %j', (argv, subject) => expect(usage(argv)).toBe(subject));
  it('a lone - is a file argument', () => {
    expect(parseArgs(['-'])).toMatchObject({ paths: ['-'] });
  });
  it('help and version alone', () => {
    expect(parseArgs(['--help'])).toEqual({ mode: 'help' });
    expect(parseArgs(['--version'])).toEqual({ mode: 'version' });
  });
  it('HELP is LF text with a final newline', () => {
    expect(HELP.endsWith('\n')).toBe(true);
    expect(HELP).not.toContain('\r');
    const codes = Array.from({ length: HELP.length }, (_, i) => HELP.charCodeAt(i));
    expect(codes.every((code) => code === 10 || (code >= 32 && code <= 126))).toBe(true);
  });
});
