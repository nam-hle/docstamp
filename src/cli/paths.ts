import { posix } from 'node:path';
import { diag } from '../core/diagnostics.ts';
import { isRepoPath } from '../core/repo-path.ts';
import type { Diagnostic, Result } from '../core/types.ts';

const toPosix = (value: string): string => value.replaceAll('\\', '/');
const isDriveAbsolute = (value: string): boolean => /^[A-Za-z]:\//u.test(value);

// SPEC §13.4
export function toRepoPath(
  arg: string,
  cwd: string,
  root: string,
  windows: boolean = process.platform === 'win32',
): string | null {
  const [argument, base, rootDir] = windows ? [arg, cwd, root].map(toPosix) : [arg, cwd, root];
  const absolute = posix.isAbsolute(argument!) || (windows && isDriveAbsolute(argument!));
  const joined = posix.normalize(absolute ? argument! : `${base}/${argument}`);
  const prefix = rootDir!.endsWith('/') ? rootDir! : `${rootDir}/`;
  if (!joined.startsWith(prefix)) return null;
  const rest = joined.slice(prefix.length).replace(/\/$/u, '').normalize('NFC');
  return isRepoPath(rest) ? rest : null;
}

// SPEC §13.3
export function selectResults(
  args: readonly string[],
  cwd: string,
  root: string,
  results: readonly Result[],
): { selected: Result[]; errors: Diagnostic[] } {
  if (args.length === 0) return { selected: [...results], errors: [] };
  const named = new Set<string>();
  const errors: Diagnostic[] = [];
  const known = new Set(results.map((result) => result.file));
  for (const arg of args) {
    const path = toRepoPath(arg, cwd, root);
    if (path === null || !known.has(path)) {
      errors.push(diag('E_UNKNOWN_FILE', { subject: arg }));
    } else {
      named.add(path);
    }
  }
  return { selected: results.filter((result) => named.has(result.file)), errors };
}
