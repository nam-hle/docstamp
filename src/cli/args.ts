import { Raised, diag } from '../core/diagnostics.ts';

export type Args =
  | { mode: 'help' }
  | { mode: 'version' }
  | {
      mode: 'check' | 'list-dependencies' | 'list-dependents';
      json: boolean;
      root?: string;
      paths: string[];
    }
  | { mode: 'update'; all: boolean; json: boolean; root?: string; paths: string[] };

export const HELP = `Usage:
  docstamp check [--json] [--root <dir>] [<file>...]
      Check that each file's dependencies are unchanged since its last review.
      The default command: a bare docstamp is docstamp check.
  docstamp update [--json] [--root <dir>] (--all | <file>...)
      Record in docstamp-lock.yaml that you reviewed the named files against their dependencies.
  docstamp list-dependencies [--json] [--root <dir>] [<file>...]
      List each file with its dependency patterns and the files they select.
  docstamp list-dependents [--json] [--root <dir>] <file>...
      List the files that depend on each named file, and the patterns that select it.
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
  'help',
  'version',
]);
const FLAGS = new Set(['--json', '--all', '--version', '--help']);
const REMOVED: Record<string, string> = {
  '--write': 'docstamp update',
  '--files': 'docstamp list-dependencies',
};
const usage = (subject: string, message?: string) =>
  new Raised([diag('E_USAGE', { subject, ...(message === undefined ? {} : { message }) })]);

// SPEC §13.2
export function parseArgs(argv: readonly string[]): Args {
  const seen = new Set<string>();
  const paths: string[] = [];
  let command: string | undefined;
  let root: string | undefined;
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
    if (arg === '--root' || arg.startsWith('--root=')) {
      mark('--root');
      root = arg === '--root' ? argv[++i] : arg.slice('--root='.length);
      if (root === undefined || root === '') fail('--root', '--root needs a directory.');
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
  const mode = (command ?? 'check') as 'check' | 'update' | 'list-dependencies' | 'list-dependents';
  const all = seen.has('--all');
  if (mode === 'update') {
    if (!all && paths.length === 0) {
      fail('update', 'Name the files you reviewed, or pass --all.');
    }
    if (all && paths.length > 0) fail('--all', 'Pass either files or --all, not both.');
  } else if (all) fail('--all', '--all is only valid with "docstamp update".');
  if (mode === 'list-dependents' && paths.length === 0) {
    fail('list-dependents', 'Name the files whose Dependents you want to list.');
  }
  if (failure) throw failure;
  const json = seen.has('--json');
  const rootOpt = root === undefined ? {} : { root };
  return mode === 'update'
    ? { mode, all, json, ...rootOpt, paths }
    : { mode, json, ...rootOpt, paths };
}
