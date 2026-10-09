import { Raised, diag } from '../core/diagnostics.ts';

type StatsWindowArg =
  | { kind: 'days'; days: number; value: string }
  | { kind: 'from'; value: string };

export type Args =
  | { mode: 'help'; names: string[] }
  | { mode: 'version' }
  | {
      mode: 'list-dependencies';
      json: boolean;
      root?: string;
      paths: string[];
    }
  | {
      mode: 'list-dependents';
      json: boolean;
      root?: string;
      paths: string[];
      transitive: boolean;
    }
  | {
      mode: 'check';
      json: boolean;
      onlyStale: boolean;
      quiet: boolean;
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
  | { mode: 'suggest'; json: boolean; root?: string; paths: string[]; write: boolean }
  | { mode: 'update'; all: boolean; json: boolean; root?: string; paths: string[] };

// SPEC §13.1: the command table, in the order help lists it
export const COMMANDS = [
  'check',
  'update',
  'list-dependencies',
  'list-dependents',
  'stats',
  'suggest',
  'help',
  'version',
] as const;
export type Command = (typeof COMMANDS)[number];
const isCommand = (arg: string): arg is Command => (COMMANDS as readonly string[]).includes(arg);
const FLAGS = new Set([
  '--json',
  '--all',
  '--transitive',
  '--only-stale',
  '--quiet',
  '--version',
  '--help',
  '--write',
]);
const REMOVED: Record<string, string> = {
  '--files': 'docstamp list-dependencies',
};
const VALUED: Record<string, string> = {
  '--root': 'a directory',
  '--since': 'a number of days such as 30d',
  '--from': 'a revision',
};
const valuedName = (arg: string): string | undefined =>
  Object.keys(VALUED).find((name) => arg === name || arg.startsWith(`${name}=`));
export const OPTIONS: readonly string[] = [...FLAGS, ...Object.keys(VALUED)];
const isOption = (arg: string) =>
  arg === '--' || valuedName(arg) !== undefined || FLAGS.has(arg) || arg in REMOVED;
const DEFAULT_SINCE = '30d';
const STATS_ONLY = ['--since', '--from'];
const CHECK_ONLY = ['--only-stale', '--quiet'];
const MAX_DAYS = 3650;
const DAYS = /^([1-9][0-9]{0,3})d$/u;
const usage = (subject: string, message?: string) =>
  new Raised([diag('E_USAGE', { subject, ...(message === undefined ? {} : { message }) })]);

// SPEC §13.2
export function parseArgs(argv: readonly string[]): Args {
  const seen = new Set<string>();
  const paths: string[] = [];
  let command: string | undefined;
  let explicit: Command | undefined;
  const values = new Map<string, string>();
  let failure: { subject: string; message: string } | undefined;
  const fail = (subject: string, message: string) => {
    failure ??= { subject, message };
  };
  const mark = (flag: string) => {
    if (seen.has(flag)) fail(flag, `${flag} given twice.`);
    seen.add(flag);
  };
  for (let i = 0; i < argv.length; i++) {
    // §13.2 step 1: -h is --help
    const arg = argv[i] === '-h' ? '--help' : argv[i]!;
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
      fail(arg, `Unknown option ${arg}.`);
    } else if (command === undefined) {
      if (isCommand(arg)) command = explicit = arg;
      else {
        command = 'check';
        paths.push(arg);
      }
    } else paths.push(arg);
  }
  // §13.2 step 3: the help names
  if (command === 'help') return { mode: 'help', names: paths };
  if (seen.has('--help')) return { mode: 'help', names: explicit === undefined ? [] : [explicit] };
  if (seen.has('--version') || command === 'version') return { mode: 'version' };
  const mode = (command ?? 'check') as
    | 'check'
    | 'update'
    | 'list-dependencies'
    | 'list-dependents'
    | 'stats'
    | 'suggest';
  const all = seen.has('--all');
  if (mode !== 'suggest' && seen.has('--write')) {
    fail('--write', '--write was removed; use "docstamp update".');
  }
  if (mode === 'update') {
    if (!all && paths.length === 0) {
      fail('update', 'Name the files you reviewed, or pass --all.');
    }
    if (all && paths.length > 0) fail('--all', 'Pass either files or --all, not both.');
  } else if (all) fail('--all', '--all is only valid with "docstamp update".');
  if (seen.has('--transitive') && mode !== 'list-dependents') {
    fail('--transitive', '--transitive is only valid with "docstamp list-dependents".');
  }
  if (mode !== 'check') {
    for (const option of CHECK_ONLY) {
      if (seen.has(option)) fail(option, `${option} is only valid with "docstamp check".`);
    }
  }
  if (mode === 'list-dependents' && paths.length === 0) {
    fail('list-dependents', 'Name the files whose dependents you want to list.');
  }
  if (mode === 'suggest' && paths.length === 0) {
    fail('suggest', 'Name the files whose dependencies you want proposed.');
  }
  const since = values.get('--since');
  const from = values.get('--from');
  if (mode !== 'stats') {
    for (const option of STATS_ONLY) {
      if (seen.has(option)) fail(option, `${option} is only valid with "docstamp stats".`);
    }
  }
  if (since !== undefined && from !== undefined) {
    fail('--since', 'Pass either --since <n>d or --from <rev>, not both.');
  }
  const days = DAYS.exec(since ?? '')?.[1];
  if (since !== undefined && (days === undefined || Number(days) > MAX_DAYS)) {
    fail('--since', `--since needs a number of days written like 30d (1d to ${MAX_DAYS}d).`);
  }
  if (from?.startsWith('-')) fail('--from', '--from needs a revision, not an option.');
  if (failure) {
    const page = explicit === undefined ? 'docstamp help' : `docstamp help ${explicit}`;
    throw usage(failure.subject, failure.message.replace(/\.$/u, `; see ${page}.`));
  }
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
  if (mode === 'list-dependents') {
    return { mode, json, ...rootOpt, paths, transitive: seen.has('--transitive') };
  }
  if (mode === 'check') {
    const onlyStale = seen.has('--only-stale');
    return { mode, json, onlyStale, quiet: seen.has('--quiet'), ...rootOpt, paths };
  }
  if (mode === 'suggest') return { mode, json, ...rootOpt, paths, write: seen.has('--write') };
  return mode === 'update'
    ? { mode, all, json, ...rootOpt, paths }
    : { mode, json, ...rootOpt, paths };
}
