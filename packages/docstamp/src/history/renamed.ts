import type { Universe } from '../universe/walk.ts';
import { parseTree } from './changes.ts';
import { git } from './git.ts';

const literal = (root: string, args: readonly string[]) =>
  git(root, ['--literal-pathspecs', ...args]);

// SPEC §12.7 steps 2 and 3: the commit to compare with and the object name of `path` there
function before(root: string, path: string): { base: string; object: string } | null {
  const atHead = parseTree(literal(root, ['ls-tree', '-z', 'HEAD', '--', path])).get(path);
  if (atHead !== undefined) return { base: 'HEAD', object: atHead };
  const last = literal(root, ['log', '-1', '--format=%H', '--', path]).trim();
  if (last === '') return null;
  const base = `${last}^`;
  const object = parseTree(literal(root, ['ls-tree', '-z', base, '--', path])).get(path);
  return object === undefined ? null : { base, object };
}

// SPEC §12.7: the file of the Universe that `path` was renamed to, or null; never raises
export function renamedTo(root: string, universe: Universe, path: string): string | null {
  try {
    if (git(root, ['rev-parse', '--is-shallow-repository']).trim() !== 'false') return null;
    const found = before(root, path);
    if (found === null) return null;
    const tracked = parseTree(git(root, ['ls-tree', '-r', '-z', found.base]));
    const candidates = universe.paths.filter(
      (p) => p !== path && universe.kinds.get(p) === 'file' && !tracked.has(p) && !p.includes('\n'),
    );
    if (candidates.length === 0) return null;
    const prefix = git(root, ['rev-parse', '--show-prefix']).replace(/\r?\n$/u, '');
    const input = candidates.map((p) => `${prefix}${universe.onDisk.get(p) ?? p}\n`).join('');
    const objects = git(root, ['hash-object', '--stdin-paths'], {}, input).split('\n');
    const index = candidates.findIndex((_, i) => objects[i]?.trim() === found.object);
    return index === -1 ? null : candidates[index]!;
  } catch {
    return null;
  }
}
