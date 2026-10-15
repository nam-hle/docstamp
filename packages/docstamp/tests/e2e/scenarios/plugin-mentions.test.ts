import { expect } from 'vitest';
import { scenario } from '../harness/index.ts';

const options = { fixture: 'plugin-mentions', linkLib: true };

scenario(
  '§8.7 Mentions a plugin tells suggest what a doc of its format mentions',
  options,
  async (repo) => {
    repo.commit('initial');
    const notes = await repo.run(['suggest', 'docs/notes.txt'], { expectExit: 0 });
    expect(notes.stdout).toContain('src/a.ts');
    expect(notes.stdout).toContain('lib/c.ts');
    expect(notes.stdout).not.toContain('not-a-mention');
    const readme = await repo.run(['suggest', 'README.md'], { expectExit: 0 });
    expect(readme.stdout).toContain('src/a.ts');
  },
);

scenario(
  '§8.7 Mentions check --undeclared reports what a plugin read from a doc',
  options,
  async (repo) => {
    repo.commit('initial');
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.commit('review');
    const result = await repo.run(['check', '--undeclared']);
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('UNDECLARED docs/notes.txt  mentions lib/c.ts');
    expect(result.stdout).toContain('UNDECLARED docs/notes.txt  mentions src/a.ts');
    expect(result.stdout).toContain('UNDECLARED README.md  mentions src/a.ts');
    expect(result.stdout).not.toContain('not-a-mention');
  },
);

const throwing = [
  "import { definePlugin } from 'docstamp';",
  'export default definePlugin({',
  "  name: 'notes',",
  '  apiVersion: 1,',
  "  files: ['**/*.txt'],",
  '  extract: ({ text }) => ({ parts: [{ content: text }] }),',
  '  mentions: ({ text }) => {',
  '    throw new Error(text);',
  '  },',
  '});',
  '',
].join('\n');

scenario(
  '§8.7 Mentions a plugin that throws is an E_PLUGIN naming the doc',
  options,
  async (repo) => {
    repo.write('tools/notes.ts', throwing);
    const result = await repo.run(['suggest', 'docs/notes.txt']);
    expect(result.exit).toBe(2);
    expect(result.stderr).toContain('E_PLUGIN');
    expect(result.stderr).toContain('Plugin "notes" threw in mentions for "docs/notes.txt".');
    expect(result.stderr).not.toContain('Notes in a format');
  },
);
