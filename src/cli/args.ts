import { Raised, diag } from '../core/diagnostics.ts';

export type Args =
  | { mode: 'help' }
  | { mode: 'version' }
  | { mode: 'check'; files: boolean; json: boolean; root?: string; paths: string[] }
  | { mode: 'write'; all: boolean; json: boolean; root?: string; paths: string[] };

export const HELP = `Usage:
  docsync [--files] [--json] [--root <dir>] [<file>...]
      Check that each file's covered files are unchanged since its last review.
  docsync --write [--json] [--root <dir>] (--all | <file>...)
      Record in docsync.lock that you reviewed the named files against their covered files.
  docsync --version | --help
`;

const FLAGS = new Set(['--files', '--json', '--write', '--all', '--version', '--help']);
const usage = (subject: string) => new Raised([diag('E_USAGE', { subject })]);

// SPEC §13.2
export function parseArgs(argv: readonly string[]): Args {
  const seen = new Set<string>();
  const paths: string[] = [];
  let root: string | undefined;
  const mark = (flag: string) => {
    if (seen.has(flag)) throw usage(flag);
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
      if (root === undefined || root === '') throw usage('--root');
    } else if (FLAGS.has(arg)) mark(arg);
    else if (arg.startsWith('-') && arg !== '-') throw usage(arg);
    else paths.push(arg);
  }
  const total = seen.size + paths.length;
  if (seen.has('--version')) {
    if (total > 1) throw usage('--version');
    return { mode: 'version' };
  }
  if (seen.has('--help')) {
    if (total > 1) throw usage('--help');
    return { mode: 'help' };
  }
  const json = seen.has('--json');
  const rootOpt = root === undefined ? {} : { root };
  if (seen.has('--write')) {
    if (seen.has('--files')) throw usage('--files');
    const all = seen.has('--all');
    if (!all && paths.length === 0) throw usage('--write');
    if (all && paths.length > 0) throw usage('--all');
    return { mode: 'write', all, json, ...rootOpt, paths };
  }
  if (seen.has('--all')) throw usage('--all');
  return { mode: 'check', files: seen.has('--files'), json, ...rootOpt, paths };
}
