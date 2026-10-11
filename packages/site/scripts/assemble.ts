// Builds the Markdown that VitePress renders, from the files of the repository and `docstamp help`.
// Nothing under .generated is committed: the repository files stay the one place each fact lives.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteLinks, type LinkContext } from './links.ts';
import {
  COMMANDS,
  PLUGINS,
  PROJECT,
  REPO_ROOT,
  SKIPPED_TOPICS,
  SPEC_INDEX,
  routes,
  specParts,
  type Page,
} from './pages.ts';

const SITE = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(SITE, '.generated');
const CLI = join(REPO_ROOT, 'packages/docstamp/dist/index.js');

const context = (from: string): LinkContext => ({
  from,
  routes: routes(),
  isDirectory: (path) => {
    const full = join(REPO_ROOT, path);
    return existsSync(full) && statSync(full).isDirectory();
  },
});

function write(route: string, text: string): void {
  const file = join(OUT, `${route === '/' ? '/index' : route}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function publish({ from, to, title }: Page, withTitle: boolean): void {
  const text = rewriteLinks(readFileSync(join(REPO_ROOT, from), 'utf8'), context(from));
  const head = withTitle ? `---\ntitle: ${JSON.stringify(title)}\n---\n\n` : '';
  write(to, head + text);
}

const help = (...args: string[]): string =>
  execFileSync(process.execPath, [CLI, 'help', ...args], { encoding: 'utf8' });

// The fence is longer than any run of backticks in the text, so the page cannot be cut short.
function fenced(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text.trimEnd()}\n${fence}\n`;
}

function helpPage(kind: 'commands' | 'topics', name: string): void {
  const title = kind === 'commands' ? `docstamp ${name}` : `docstamp help ${name}`;
  const body = `---\ntitle: ${JSON.stringify(title)}\n---\n\n# ${title}\n\n${fenced(help(name))}`;
  write(`/reference/${kind}/${name}`, body);
}

// The topics are read from the index, so a topic added to the CLI appears on the site; the commands
// are listed by hand and checked against the index, so one added to the CLI fails the build here.
function indexed(): { commands: string[]; topics: string[] } {
  const lines = help().split('\n');
  const section = (heading: string): string[] => {
    const start = lines.indexOf(heading);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => line !== '' && !line.startsWith(' '));
    return rest.slice(0, end === -1 ? undefined : end);
  };
  const commands = section('Commands:')
    .map((line) => /^ {2}docstamp (?:\[(\w+)\]|([a-z][\w-]*))/u.exec(line))
    .map((match) => match?.[1] ?? match?.[2])
    .filter((name): name is string => name !== undefined);
  const topics = section('Topics:')
    .map((line) => /^ {2}(\S+) /u.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
  return { commands, topics };
}

if (!existsSync(CLI)) throw new Error(`${CLI} is missing; build docstamp first (pnpm build).`);
rmSync(OUT, { recursive: true, force: true });
cpSync(join(SITE, 'content'), OUT, { recursive: true });

publish(SPEC_INDEX, true);
for (const part of specParts()) publish(part, true);
for (const page of [...PROJECT, ...PLUGINS]) publish(page, false);

const { commands, topics } = indexed();
const listed = commands.filter((name) => name !== 'help' && name !== 'version');
if (listed.join() !== [...COMMANDS].join()) {
  throw new Error(
    `The commands of docstamp help (${listed.join(', ')}) differ from COMMANDS in scripts/pages.ts.`,
  );
}
for (const name of COMMANDS) helpPage('commands', name);
const published = topics.filter((topic) => !SKIPPED_TOPICS.includes(topic));
for (const name of published) helpPage('topics', name);
// The sidebar follows the order of the index; the config reads it from here.
writeFileSync(join(SITE, '.manifest.json'), `${JSON.stringify({ topics: published }, null, 2)}\n`);

console.log(`site content written to ${OUT}`);
