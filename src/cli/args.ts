import { Raised, diag } from '../core/diagnostics.ts';

type StatsWindowArg =
  | { kind: 'days'; days: number; value: string }
  | { kind: 'from'; value: string };

export type Args =
  | { mode: 'help' }
  | { mode: 'version' }
  | {
      mode: 'check' | 'list-dependencies' | 'list-dependents';
      json: boolean;
      root?: string;
      paths: string[];
    }
  | {
      mode: 'stats';
      json: boolean;
      root?: string;
      paths: string[];
      window: StatsWindowArg;
    }
  | { mode: 'update'; all: boolean; json: boolean; root?: string; paths: string[] };

export const HELP = `Usage:
  docstamp check [--json] [--root <dir>] [<file>...]
      Check that each file's dependencies are unchanged since its last review.
      The default command: a bare docstamp is docstamp check.
  docstamp update [--json] [--root <dir>] (--all | <file>...)
      Record that you reviewed the named files against their dependencies (in each file's
      docstamp block, or in docstamp-lock.yaml for files declared in the configuration).
  docstamp list-dependencies [--json] [--root <dir>] [<file>...]
      List each file with its dependency patterns and the files they select.
  docstamp list-dependents [--json] [--root <dir>] <file>...
      List the files that depend on each named file, and the patterns that select it.
  docstamp stats [--json] [--root <dir>] [--since <n>d | --from <rev>] [<file>...]
      Report how often each file's dependencies would have made it stale over recent history:
      the last <n> days (default --since 30d), or the commits of <rev>..HEAD.
  docstamp help
      Print this usage (also --help).
  docstamp version
      Print the version (also --version).
`;

const COMMANDS = new Set([
  'check',
  'update',
  'list-dependencies',
  'list-dependents',
  'stats',
  'help',
  'version',
]);
const FLAGS = new Set(['--json', '--all', '--version', '--help']);
const REMOVED: Record<string, string> = {
  '--write': 'docstamp update',
  '--files': 'docstamp list-dependencies',
};
const VALUED: Record<string, string> = {
  '--root': 'a directory',
  '--since': 'a number of days such as 30d',
  '--from': 'a revision',
};
const valuedName = (arg: string): string | undefined =>
  Object.keys(VALUED).find((name) => arg === name || arg.startsWith(`${name}=`));
const isOption = (arg: string) =>
  arg === '--' || valuedName(arg) !== undefined || FLAGS.has(arg) || arg in REMOVED;
const DEFAULT_SINCE = '30d';
const STATS_ONLY = ['--since', '--from'];
const MAX_DAYS = 3650;
const DAYS = /^([1-9][0-9]{0,3})d$/u;
const usage = (subject: string, message?: string) =>
  new Raised([diag('E_USAGE', { subject, ...(message === undefined ? {} : { message }) })]);

// SPEC §13.2
export function parseArgs(argv: readonly string[]): Args {
  const seen = new Set<string>();
  const paths: string[] = [];
  let command: string | undefined;
  const values = new Map<string, string>();
  let failure: Raised | undefined;
  const fail = (subject: string, message: string) => {
    failure ??= usage(subject, message);
  };
  const mark = (flag: string) => {
    if (seen.has(flag)) fail(flag, `${flag} given twice.`);
    seen.add(flag);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      paths.push(...argv.slice(i + 1));
      break;
    }
    const name = valuedName(arg);
    if (name !== undefined) {
      mark(name);
      const next = argv[i + 1];
      const spaced = arg === name;
      if (spaced && next !== undefined && !isOption(next)) i++;
      const value = spaced
        ? next !== undefined && !isOption(next)
          ? next
          : undefined
        : arg.slice(name.length + 1);
      if (value === undefined || value === '') fail(name, `${name} needs ${VALUED[name]}.`);
      else values.set(name, value);
    } else if (FLAGS.has(arg)) mark(arg);
    else if (REMOVED[arg] !== undefined) fail(arg, `${arg} was removed; use "${REMOVED[arg]}".`);
    else if (arg.startsWith('-') && arg !== '-') {
      fail(arg, `Unknown option ${arg}; see docstamp help.`);
    } else if (command === undefined) {
      if (COMMANDS.has(arg)) command = arg;
      else {
        command = 'check';
        paths.push(arg);
      }
    } else paths.push(arg);
  }
  if (seen.has('--help') || command === 'help') return { mode: 'help' };
  if (seen.has('--version') || command === 'version') return { mode: 'version' };
  const mode = (command ?? 'check') as
    | 'check'
    | 'update'
    | 'list-dependencies'
    | 'list-dependents'
    | 'stats';
  const all = seen.has('--all');
  if (mode === 'update') {
    if (!all && paths.length === 0) {
      fail('update', 'Name the files you reviewed, or pass --all.');
    }
    if (all && paths.length > 0) fail('--all', 'Pass either files or --all, not both.');
  } else if (all) fail('--all', '--all is only valid with "docstamp update".');
  if (mode === 'list-dependents' && paths.length === 0) {
    fail('list-dependents', 'Name the files whose dependents you want to list.');
  }
  const since = values.get('--since');
  const from = values.get('--from');
  if (mode !== 'stats') {
    for (const option of STATS_ONLY) {
      if (seen.has(option)) fail(option, `${option} is only valid with "docstamp stats".`);
    }
  }
  if (since !== undefined && from !== undefined) {
    fail('--since', '--since <n>d and --from <rev> cannot be used together; pick one.');
  }
  const days = DAYS.exec(since ?? '')?.[1];
  if (since !== undefined && (days === undefined || Number(days) > MAX_DAYS)) {
    fail('--since', `--since needs a number of days written like 30d (1d to ${MAX_DAYS}d).`);
  }
  if (from?.startsWith('-')) fail('--from', '--from needs a revision, not an option.');
  if (failure) throw failure;
  const json = seen.has('--json');
  const root = values.get('--root');
  const rootOpt = root === undefined ? {} : { root };
  if (mode === 'stats') {
    const window: StatsWindowArg =
      from === undefined
        ? {
            kind: 'days',
            days: Number(days ?? DEFAULT_SINCE.slice(0, -1)),
            value: since ?? DEFAULT_SINCE,
          }
        : { kind: 'from', value: from };
    return { mode, json, ...rootOpt, paths, window };
  }
  return mode === 'update'
    ? { mode, all, json, ...rootOpt, paths }
    : { mode, json, ...rootOpt, paths };
}
