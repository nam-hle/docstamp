import { Raised, diag } from '../core/diagnostics.ts';

export type Args =
  | { mode: 'help' }
  | { mode: 'version' }
  | { mode: 'check' | 'list-dependents'; json: boolean; root?: string; paths: string[] }
  | { mode: 'update'; all: boolean; json: boolean; root?: string; paths: string[] };

export const HELP = `Usage:
  docsync check [--json] [--root <dir>] [<file>...]
      Check that each file's covered files are unchanged since its last review.
      The default command: a bare docsync is docsync check.
  docsync update [--json] [--root <dir>] (--all | <file>...)
      Record in docsync-lock.yaml that you reviewed the named files against their covered files.
  docsync list-dependents [--json] [--root <dir>] [<file>...]
      List each file with the patterns it covers and the covered files.
  docsync help
      Print this usage (also --help).
  docsync version
      Print the version (also --version).
`;

const COMMANDS = new Set(['check', 'update', 'list-dependents', 'help', 'version']);
const FLAGS = new Set(['--json', '--all', '--version', '--help']);
const REMOVED: Record<string, string> = {
  '--write': 'docsync update',
  '--files': 'docsync list-dependents',
};
const usage = (subject: string, message?: string) =>
  new Raised([diag('E_USAGE', { subject, ...(message === undefined ? {} : { message }) })]);

// SPEC §13.2
export function parseArgs(argv: readonly string[]): Args {
  const first = argv[0];
  const explicit = first !== undefined && COMMANDS.has(first);
  const command = explicit ? first : 'check';
  const rest = explicit ? argv.slice(1) : argv;
  if (command === 'help' || command === 'version') {
    if (rest.length > 0) throw usage(command);
    return { mode: command };
  }
  const seen = new Set<string>();
  const paths: string[] = [];
  let root: string | undefined;
  const mark = (flag: string) => {
    if (seen.has(flag)) throw usage(flag);
    seen.add(flag);
  };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--') {
      paths.push(...rest.slice(i + 1));
      break;
    }
    if (arg === '--root' || arg.startsWith('--root=')) {
      mark('--root');
      root = arg === '--root' ? rest[++i] : arg.slice('--root='.length);
      if (root === undefined || root === '') throw usage('--root');
    } else if (FLAGS.has(arg)) mark(arg);
    else if (REMOVED[arg] !== undefined) {
      throw usage(arg, `${arg} was removed; use "${REMOVED[arg]}".`);
    } else if (arg.startsWith('-') && arg !== '-') throw usage(arg);
    else paths.push(arg);
  }
  const total = seen.size + paths.length + (explicit ? 1 : 0);
  for (const flag of ['--version', '--help'] as const) {
    if (!seen.has(flag)) continue;
    if (total > 1) throw usage(flag);
    return { mode: flag === '--version' ? 'version' : 'help' };
  }
  const json = seen.has('--json');
  const rootOpt = root === undefined ? {} : { root };
  const all = seen.has('--all');
  if (command === 'update') {
    if (!all && paths.length === 0) throw usage('update');
    if (all && paths.length > 0) throw usage('--all');
    return { mode: 'update', all, json, ...rootOpt, paths };
  }
  if (all) throw usage('--all');
  return { mode: command as 'check' | 'list-dependents', json, ...rootOpt, paths };
}
