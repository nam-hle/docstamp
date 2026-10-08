import { Raised, diag } from '../core/diagnostics.ts';
import type { Code } from '../core/types.ts';
import { COMMANDS, type Command } from './args.ts';
import { COMMAND_PAGES } from './help-commands.ts';
import { DIAGNOSTIC_HELP } from './help-diagnostics.ts';
import { examples, prose, table } from './help-format.ts';
import { TOPICS, type Topic, type TopicPage } from './help-topics.ts';

const isCommand = (name: string): name is Command => Object.hasOwn(COMMAND_PAGES, name);
const isTopic = (name: string): name is Topic => Object.hasOwn(TOPICS, name);
const isCode = (name: string): name is Code => Object.hasOwn(DIAGNOSTIC_HELP, name);

const section = (title: string, body: string) => (body === '' ? '' : `${title}:\n${body}\n\n`);

function indexText(): string {
  const commands = COMMANDS.map((name) => {
    const page = COMMAND_PAGES[name];
    const usage = page.synopsis.map((s) => `  ${s}`);
    return [...usage, ...prose(page.summary, '      ').split('\n')].join('\n');
  });
  const topics = table(Object.entries(TOPICS).map(([name, topic]) => [name, topic.summary]));
  return (
    prose(`
docstamp is a deterministic gate for hidden links between files. Each file (usually a doc)
declares the files it depends on; docstamp fails when they changed since the file was last
reviewed, and docstamp update <file> records the review. New here: docstamp help start.`) +
    `\n\nCommands:\n${commands.join('\n')}\n\nTopics:\n${topics}\n\n` +
    'Exit codes: 0 ok, 1 stale (check only), 2 error or invalid (docstamp help exit-codes).\n' +
    'Run docstamp help <command> or docstamp help <topic> for a page, and\n' +
    'docstamp help diagnostics <code> for one diagnostic code.\n'
  );
}

function commandText(name: Command): string {
  const page = COMMAND_PAGES[name];
  const options = [...page.options];
  if (name !== 'help' && name !== 'version') options.push(['--help', 'Print this page.']);
  const related = page.related.map((r) => `docstamp help ${r}`).join(', ');
  return (
    `${prose(`docstamp ${name}: ${page.summary}`)}\n\n` +
    section('Usage', page.synopsis.map((s) => `  ${s}`).join('\n')) +
    `${prose(page.description)}\n\n` +
    section('Options', options.length === 0 ? '' : table(options)) +
    section('Reads', prose(page.reads, '  ')) +
    section('Writes', prose(page.writes, '  ')) +
    section('Examples', examples(page.examples)) +
    section('Exit codes', table(page.exit)) +
    `${prose(`Related: ${related}`)}\n`
  );
}

function diagnosticText(code: Code): string {
  const { meaning, fix } = DIAGNOSTIC_HELP[code];
  const severity = code.startsWith('W_') ? 'warning' : 'error';
  return `${code} (${severity})\n${table([
    ['meaning', meaning],
    ['fix', fix],
  ])}\n`;
}

function topicText(name: Topic): string {
  const topic: TopicPage = TOPICS[name];
  const shown = topic.examples === undefined ? '' : examples(topic.examples);
  const codes =
    name === 'diagnostics'
      ? `\n${(Object.keys(DIAGNOSTIC_HELP) as Code[]).map(diagnosticText).join('\n')}`
      : '';
  return (
    `${prose(`docstamp help ${name}: ${topic.summary}`)}\n\n${prose(topic.body)}\n` +
    (shown === '' ? '' : `\nExample:\n${shown}\n`) +
    codes
  );
}

const unknown = (subject: string, message: string) =>
  new Raised([diag('E_USAGE', { subject, message })]);

// SPEC §13.11
export function helpText(names: readonly string[]): string {
  const [first, second, ...rest] = names;
  if (first === undefined) return indexText();
  if (first === 'diagnostics' && second !== undefined) {
    if (!isCode(second)) {
      throw unknown(second, `Unknown diagnostic code ${second}; see docstamp help diagnostics.`);
    }
    if (rest.length > 0) throw unknown(rest[0]!, 'Name one diagnostic code.');
    return diagnosticText(second);
  }
  if (second !== undefined) throw unknown(second, 'Name one command or topic.');
  if (isCommand(first)) return commandText(first);
  if (isTopic(first)) return topicText(first);
  const valid = [...COMMANDS, ...Object.keys(TOPICS)].join(', ');
  throw unknown(first, `Unknown help name ${first}; name one of ${valid}.`);
}
