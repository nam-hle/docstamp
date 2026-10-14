import { Raised, diag } from '../core/diagnostics.ts';
import { closestKey } from '../core/did-you-mean.ts';

type StatsWindowArg =
  | { kind: 'days'; days: number; value: string }
  | { kind: 'from'; value: string };

export type Args =
  | { mode: 'help'; names: string[]; json?: true }
  | { mode: 'version' }
  | {
      mode: 'list-dependencies';
      json: boolean;
      cwd?: string;
      paths: string[];
    }
  | {
      mode: 'list-dependents';
      json: boolean;
      cwd?: string;
      paths: string[];
      transitive: boolean;
    }
  | {
      mode: 'check';
      json: boolean;
      onlyStale: boolean;
      quiet: boolean;
      undeclared: boolean;
      limit: number;
      cwd?: string;
      paths: string[];
    }
  | {
      mode: 'stats';
      json: boolean;
      cwd?: string;
      paths: string[];
      window: StatsWindowArg;
    }
  | {
      mode: 'suggest';
      json: boolean;
      cwd?: string;
      paths: string[];
      write: boolean;
      all: boolean;
      limit: number;
    }
  | { mode: 'update'; all: boolean; json: boolean; cwd?: string; paths: string[] };

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
  '--undeclared',
]);
const REMOVED: Record<string, string> = {
  '--files': 'docstamp list-dependencies',
  '--root': '--cwd',
};
const VALUED: Record<string, string> = {
  '--cwd': 'a directory',
  '--since': 'a number of days such as 30d',
  '--from': 'a revision',
  '--limit': 'a number of findings such as 10 (0 prints all)',
};
const valuedName = (arg: string): string | undefined =>
  Object.keys(VALUED).find((name) => arg === name || arg.startsWith(`${name}=`));
const removedName = (arg: string): string | undefined =>
  Object.keys(REMOVED).find((name) => arg === name || arg.startsWith(`${name}=`));
export const OPTIONS: readonly string[] = [...FLAGS, ...Object.keys(VALUED)];
const isOption = (arg: string) =>
  arg === '--' || valuedName(arg) !== undefined || FLAGS.has(arg) || removedName(arg) !== undefined;
const DEFAULT_SINCE = '30d';
const STATS_ONLY = ['--since', '--from'];
const CHECK_ONLY = ['--only-stale', '--quiet', '--undeclared'];
const MAX_DAYS = 3650;
const DAYS = /^([1-9][0-9]{0,3})d$/u;
const LIMIT = /^(0|[1-9][0-9]{0,8})$/u;
// SPEC §13.5, §14.9: the findings text mode prints
const DEFAULT_LIMIT = 10;
const usage = (subject: string, message?: string) =>
  new Raised([diag('E_USAGE', { subject, ...(message === undefined ? {} : { message }) })]);

// SPEC §13.2 step 2: a near command name for a first argument that names nothing on disk
function mistypedCommand(arg: string, exists: (arg: string) => boolean): Raised | null {
  const near = closestKey(arg, COMMANDS);
  if (near === null || exists(arg)) return null;
  return usage(
    arg,
    `Unknown command "${arg}"; did you mean "${near}"? ` +
      `A file of that name is named after --, as in docstamp -- ${arg}; see docstamp help.`,
  );
}

// SPEC §13.2; `exists` tells whether an argument names an entry, resolved against cwd
export function parseArgs(
  argv: readonly string[],
  exists: (arg: string) => boolean = () => false,
): Args {
  const seen = new Set<string>();
  const paths: string[] = [];
  let command: string | undefined;
  let explicit: Command | undefined;
  let mistyped: Raised | null = null;
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
    else if (removedName(arg) !== undefined) {
      const name = removedName(arg)!;
      fail(arg, `${name} was removed; use "${REMOVED[name]}".`);
    } else if (arg.startsWith('-') && arg !== '-') {
      fail(arg, `Unknown option ${arg}.`);
    } else if (command === undefined) {
      if (isCommand(arg)) command = explicit = arg;
      else {
        mistyped = mistypedCommand(arg, exists);
        command = 'check';
        paths.push(arg);
      }
    } else paths.push(arg);
  }
  if (mistyped !== null) throw mistyped;
  // §13.2 step 3: the help names
  // §13.11 step 5: --json reaches help only to ask for the index as JSON
  const jsonOpt = seen.has('--json') ? ({ json: true } as const) : {};
  if (command === 'help') return { mode: 'help', names: paths, ...jsonOpt };
  if (seen.has('--help')) {
    return { mode: 'help', names: explicit === undefined ? [] : [explicit], ...jsonOpt };
  }
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
  } else if (all && mode !== 'suggest') {
    fail('--all', '--all is only valid with "docstamp update" and "docstamp suggest".');
  }
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
  if (mode === 'suggest' && all && (paths.length > 0 || seen.has('--write'))) {
    fail('--all', 'Pass either files or --all, not both, and --all never writes.');
  } else if (mode === 'suggest' && !all && paths.length === 0) {
    fail('suggest', 'Name the files whose dependencies you want proposed, or pass --all.');
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
  const limit = values.get('--limit');
  if (limit !== undefined) {
    const enabler = mode === 'check' ? '--undeclared' : mode === 'suggest' ? '--all' : undefined;
    if (enabler === undefined || !seen.has(enabler)) {
      fail('--limit', '--limit is only valid with "check --undeclared" and "suggest --all".');
    } else if (!LIMIT.test(limit)) {
      fail('--limit', '--limit needs a whole number: 1 or more per page, or 0 to print all.');
    }
  }
  if (failure) {
    const page = explicit === undefined ? 'docstamp help' : `docstamp help ${explicit}`;
    throw usage(failure.subject, failure.message.replace(/\.$/u, `; see ${page}.`));
  }
  const json = seen.has('--json');
  const cwd = values.get('--cwd');
  const cwdOpt = cwd === undefined ? {} : { cwd };
  const page = limit === undefined ? DEFAULT_LIMIT : Number(limit);
  if (mode === 'stats') {
    const window: StatsWindowArg =
      from === undefined
        ? {
            kind: 'days',
            days: Number(days ?? DEFAULT_SINCE.slice(0, -1)),
            value: since ?? DEFAULT_SINCE,
          }
        : { kind: 'from', value: from };
    return { mode, json, ...cwdOpt, paths, window };
  }
  if (mode === 'list-dependents') {
    return { mode, json, ...cwdOpt, paths, transitive: seen.has('--transitive') };
  }
  if (mode === 'check') {
    const onlyStale = seen.has('--only-stale');
    const [quiet, undeclared] = [seen.has('--quiet'), seen.has('--undeclared')];
    return { mode, json, onlyStale, quiet, undeclared, limit: page, ...cwdOpt, paths };
  }
  if (mode === 'suggest') {
    return { mode, json, ...cwdOpt, paths, write: seen.has('--write'), all, limit: page };
  }
  return mode === 'update'
    ? { mode, all, json, ...cwdOpt, paths }
    : { mode, json, ...cwdOpt, paths };
}
