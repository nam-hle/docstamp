import { posix } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import { isRepoPath } from '../core/repo-path.ts';
import type { Diagnostic, Result } from '../core/types.ts';

const toPosix = (value: string): string => value.replaceAll('\\', '/');
const isDriveAbsolute = (value: string): boolean => /^[A-Za-z]:\//u.test(value);

// SPEC §13.4 steps 1 and 2
export function resolveArgument(
  arg: string,
  cwd: string,
  windows: boolean = process.platform === 'win32',
): string {
  const [argument, base] = windows ? [arg, cwd].map(toPosix) : [arg, cwd];
  const absolute = posix.isAbsolute(argument!) || (windows && isDriveAbsolute(argument!));
  return posix.normalize(absolute ? argument! : `${base}/${argument}`);
}

// SPEC §13.8 step 3: the resolved argument is the root itself or below it
export function isAtOrUnderRoot(
  resolved: string,
  root: string,
  windows: boolean = process.platform === 'win32',
): boolean {
  const rootDir = windows ? toPosix(root) : root;
  return (
    resolved === rootDir || resolved.startsWith(rootDir.endsWith('/') ? rootDir : `${rootDir}/`)
  );
}

// SPEC §13.4
export function toRepoPath(
  arg: string,
  cwd: string,
  root: string,
  windows: boolean = process.platform === 'win32',
): string | null {
  const joined = resolveArgument(arg, cwd, windows);
  const rootDir = windows ? toPosix(root) : root;
  const prefix = rootDir.endsWith('/') ? rootDir : `${rootDir}/`;
  if (!joined.startsWith(prefix)) return null;
  const rest = joined.slice(prefix.length).replace(/\/$/u, '').normalize('NFC');
  return isRepoPath(rest) ? rest : null;
}

// SPEC §5.5, §13.3, §13.8 step 3: how an argument that names no path inside the root was resolved
export function resolutionMessage(arg: string, cwd: string, root: string): string {
  const resolved = resolveArgument(arg, cwd);
  const problem = isAtOrUnderRoot(resolved, root)
    ? `which does not name a file inside the root ${root}`
    : `which is outside the root ${root}`;
  return (
    `The argument is resolved against the current directory (${cwd}) to ${resolved}, ` +
    `${problem}; name a file inside the root.`
  );
}

// SPEC §14.3.3: the path from cwd to the root, "" when they are the same directory
export function rootFromCwd(
  cwd: string,
  root: string,
  windows: boolean = process.platform === 'win32',
): string {
  const [from, to] = windows ? [cwd, root].map(toPosix) : [cwd, root];
  const drive = (value: string) => (isDriveAbsolute(value) ? value[0]!.toUpperCase() : '');
  if (drive(from!) !== drive(to!)) return '';
  return posix.relative(from!, to!);
}

// SPEC §13.3
export function selectResults(
  args: readonly string[],
  cwd: string,
  root: string,
  results: readonly Result[],
): Result[] {
  if (args.length === 0) return [...results];
  const named = new Set<string>();
  const errors: Diagnostic[] = [];
  const known = new Set(results.map((result) => result.file));
  for (const arg of args) {
    const path = toRepoPath(arg, cwd, root);
    if (path === null) {
      const message = resolutionMessage(arg, cwd, root);
      errors.push(diag('E_USAGE', { subject: arg, message }));
    } else if (!known.has(path)) {
      errors.push(diag('E_UNKNOWN_FILE', { subject: arg }));
    } else {
      named.add(path);
    }
  }
  if (errors.length > 0) throw new Raised(errors);
  return results.filter((result) => named.has(result.file));
}
