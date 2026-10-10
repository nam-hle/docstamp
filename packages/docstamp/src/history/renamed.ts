import type { Git } from '../host/git.ts';
import type { Universe } from '../universe/walk.ts';

// SPEC §12.7 steps 2 and 3: the commit to compare with and the object name of `path` there
function before(git: Git, path: string): { base: string; object: string } | null {
  const atHead = git.objectAt('HEAD', path);
  if (atHead !== null) return { base: 'HEAD', object: atHead };
  const last = git.lastCommitTouching(path);
  if (last === null) return null;
  const base = `${last}^`;
  const object = git.objectAt(base, path);
  return object === null ? null : { base, object };
}

// SPEC §12.7: the file of the Universe that `path` was renamed to, or null; never raises
export function renamedTo(git: Git, universe: Universe, path: string): string | null {
  try {
    if (git.isShallow()) return null;
    const found = before(git, path);
    if (found === null) return null;
    const tracked = git.objectsAt(found.base);
    const candidates = universe.paths.filter(
      (p) => p !== path && universe.kinds.get(p) === 'file' && !tracked.has(p) && !p.includes('\n'),
    );
    if (candidates.length === 0) return null;
    const objects = git.hashWorkFiles(candidates.map((p) => universe.onDisk.get(p) ?? p));
    const index = candidates.findIndex((_, i) => objects[i] === found.object);
    return index === -1 ? null : candidates[index]!;
  } catch {
    return null;
  }
}
