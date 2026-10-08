import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMANDS, OPTIONS, parseArgs } from '../../src/cli/args.ts';
import { COMMAND_PAGES } from '../../src/cli/help-commands.ts';
import { DIAGNOSTIC_HELP } from '../../src/cli/help-diagnostics.ts';
import { TOPICS } from '../../src/cli/help-topics.ts';
import { helpText } from '../../src/cli/help.ts';
import { Raised } from '../../src/core/diagnostics.ts';

const SPEC = readFileSync(new URL('../../docs/SPEC.md', import.meta.url), 'utf8');

const clause = (heading: string): string => {
  const start = SPEC.indexOf(`\n${heading}\n`);
  const next = SPEC.indexOf('\n## ', start + 1);
  return SPEC.slice(start, next === -1 ? undefined : next);
};
const tableColumn = (text: string): string[] =>
  [...text.matchAll(/^\| `?([^`|]+?)`? \|/gmu)].map((m) => m[1]!.trim());

const raised = (names: string[]) => {
  try {
    helpText(names);
  } catch (e) {
    return (e as Raised).diagnostics;
  }
  return [];
};

const NAMES = [
  [],
  ...COMMANDS.map((c) => [c]),
  ...Object.keys(TOPICS).map((t) => [t]),
  ...Object.keys(DIAGNOSTIC_HELP).map((code) => ['diagnostics', code]),
];

// a value for each option that takes one, so that the parser judges the option itself
const VALUES: Record<string, string> = { '--root': '.', '--since': '30d', '--from': 'HEAD' };

function accepts(command: string, option: string): boolean {
  const written = option in VALUES ? [option, VALUES[option]!] : [option];
  return [[], ['a.md']].some((files) => {
    try {
      parseArgs([command, ...written, ...files]);
      return true;
    } catch {
      return false;
    }
  });
}

describe('§13.11 help', () => {
  it.each(NAMES)('%j is plain text: LF, ASCII, at most 100 columns, a final newline', (...n) => {
    const text = helpText(n);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toMatch(/[^\n\x20-\x7e]/u);
    for (const line of text.split('\n')) {
      expect(line.length, line).toBeLessThanOrEqual(100);
      expect(line, line).not.toMatch(/ $/u);
    }
  });

  it('every command of the command table has a page, and nothing else does', () => {
    expect(Object.keys(COMMAND_PAGES)).toEqual([...COMMANDS]);
    for (const command of COMMANDS) {
      expect(helpText([command])).toContain(`docstamp ${command}: `);
      expect(helpText([])).toContain(COMMAND_PAGES[command].synopsis[0]);
    }
  });

  it('the index lists every topic', () => {
    for (const topic of Object.keys(TOPICS)) expect(helpText([])).toMatch(`\n  ${topic} `);
  });

  it('every option a command accepts is on its page, and only those', () => {
    const optionsOf = (command: string) =>
      helpText([command])
        .split('\nOptions:\n')[1]
        ?.split('\n\n')[0]!
        .split('\n')
        .map((line) => /^ {2}(--[a-z-]+)/u.exec(line)?.[1])
        .filter((name) => name !== undefined) ?? [];
    for (const command of COMMANDS) {
      if (command === 'help' || command === 'version') continue;
      // --version selects the version command whatever the command word is (§13.2 step 3)
      const accepted = OPTIONS.filter((o) => o !== '--version' && accepts(command, o));
      expect(new Set(optionsOf(command)), command).toEqual(new Set(accepted));
    }
  });

  it('the diagnostics topic has every code of SPEC §15, in its order, and no other', () => {
    const codes = tableColumn(clause('## 15 Diagnostics')).filter((c) => /^[EW]_/u.test(c));
    expect(Object.keys(DIAGNOSTIC_HELP)).toEqual(codes);
    const page = helpText(['diagnostics']);
    for (const code of codes) {
      const severity = code.startsWith('W_') ? 'warning' : 'error';
      expect(page).toContain(`\n${code} (${severity})\n`);
      expect(helpText(['diagnostics', code])).toMatch(new RegExp(`^${code} \\(${severity}\\)\\n`));
    }
  });

  it('the exit-codes topic has every exit code of SPEC §16', () => {
    const codes = tableColumn(clause('## 16 Exit Codes')).filter((c) => /^\d+$/u.test(c));
    expect(codes).toEqual(['0', '1', '2', '70']);
    const page = helpText(['exit-codes']);
    for (const code of codes) expect(page).toMatch(new RegExp(`\\n {4}${code} +\\S`));
  });

  it('the states topic names every state and reason of SPEC §5.4', () => {
    const records = clause('## 5 Records');
    const page = helpText(['states']);
    for (const name of ['ok', 'stale', 'invalid', 'unrecorded', 'content-changed']) {
      expect(records).toContain(`\`${name}\``);
      expect(page).toMatch(new RegExp(`\\n {4,}${name} +\\S`));
    }
  });

  it('the spec topic lists the sections of SPEC.md', () => {
    const sections = [...SPEC.matchAll(/^## (\d+ .+)$/gmu)].map((m) => m[1]!);
    const page = helpText(['spec']);
    const listed = [...page.matchAll(/^ {4}(\d+ .+)$/gmu)].map((m) => m[1]!);
    expect(listed).toEqual(sections);
  });

  it('a command word with --help prints its page', () => {
    for (const command of COMMANDS) {
      const args = parseArgs([command, '--help']);
      // help --help names nothing: the names of the help command are its file arguments
      expect(args).toEqual({ mode: 'help', names: command === 'help' ? [] : [command] });
    }
  });

  it('an unknown name is E_USAGE listing the valid ones', () => {
    const [unknown] = raised(['bogus']);
    expect(unknown).toMatchObject({ code: 'E_USAGE', subject: 'bogus' });
    for (const name of [...COMMANDS, ...Object.keys(TOPICS)]) {
      expect(unknown?.message).toContain(name);
    }
    expect(raised(['diagnostics', 'E_BOGUS'])[0]).toMatchObject({ subject: 'E_BOGUS' });
    expect(raised(['check', 'update'])[0]).toMatchObject({ subject: 'update' });
    expect(raised(['diagnostics', 'E_USAGE', 'x'])[0]).toMatchObject({ subject: 'x' });
  });
});
