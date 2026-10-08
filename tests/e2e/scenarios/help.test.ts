import { expect } from 'vitest';
import { COMMANDS } from '../../../src/cli/args.ts';
import { COMMAND_PAGES } from '../../../src/cli/help-commands.ts';
import type { Example } from '../../../src/cli/help-format.ts';
import { TOPICS } from '../../../src/cli/help-topics.ts';
import { scenario } from '../harness/index.ts';

const pages: [string, readonly Example[]][] = [
  ...COMMANDS.map((c): [string, readonly Example[]] => [c, COMMAND_PAGES[c].examples]),
  ...Object.entries(TOPICS).map(([name, t]): [string, readonly Example[]] => [
    name,
    'examples' in t ? t.examples : [],
  ]),
];

// SPEC §13.11: an example that shows output shows what the command prints on a fixed tree
for (const [name, examples] of pages.filter(([, list]) => list.some((e) => e.out !== undefined))) {
  scenario(
    `§13.11 the examples of help ${name} are real output`,
    { fixture: 'help-examples', git: false },
    async (repo) => {
      for (const example of examples.filter((e) => e.out !== undefined)) {
        const result = await repo.run(example.args, { snapshot: false });
        expect(result, example.args.join(' ')).toEqual({
          exit: example.exit ?? 0,
          stdout: example.out,
          stderr: '',
          json: expect.any(Function),
        });
      }
    },
  );
}

scenario('§13.11 every help page', { git: false }, async (repo) => {
  const index = await repo.run(['help']);
  expect(index).toMatchObject({ exit: 0, stderr: '' });
  for (const [name] of pages) {
    const page = await repo.run(['help', name]);
    expect(page, name).toMatchObject({ exit: 0, stderr: '' });
  }
  const one = await repo.run(['help', 'diagnostics', 'E_CONFIG_MISSING']);
  expect(one.stdout).toMatch(/^E_CONFIG_MISSING \(error\)\n/u);
});

scenario('§13.11 a command with --help prints its page', { git: false }, async (repo) => {
  // help --help is the index: the names of the help command are its file arguments
  for (const command of COMMANDS.filter((c) => c !== 'help')) {
    const page = await repo.run(['help', command], { snapshot: false });
    for (const args of [
      [command, '--help'],
      ['--json', command, '--bogus', '--help', 'x'],
    ]) {
      const same = await repo.run(args, { snapshot: false });
      expect(same, args.join(' ')).toMatchObject({ exit: 0, stdout: page.stdout, stderr: '' });
    }
  }
});

scenario('§13.11 an unknown help name is E_USAGE', { git: false }, async (repo) => {
  const unknown = await repo.run(['help', 'bogus']);
  expect(unknown).toMatchObject({ exit: 2, stdout: '' });
  expect(unknown.stderr).toContain('error: E_USAGE: bogus: Unknown help name bogus; name one of');
  const code = await repo.run(['help', 'diagnostics', 'E_BOGUS']);
  expect(code).toMatchObject({ exit: 2, stdout: '' });
  expect(code.stderr).toContain('error: E_USAGE: E_BOGUS: ');
});
