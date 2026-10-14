import { join } from 'node:path';
import { comparePaths } from '../core/order.ts';
import type { Result } from '../core/types.ts';
import { propose, statusOf } from '../engine/suggest.ts';
import type { Host } from '../host/host.ts';
import { textOf } from '../inline/read-inline.ts';
import { isIgnoredPath, type Universe } from '../universe/walk.ts';

export interface Undeclared {
  readonly file: string;
  readonly path: string;
}

function readText(host: Host, root: string, universe: Universe, path: string): string | null {
  const absolute = join(root, universe.onDisk.get(path) ?? path);
  try {
    return host.fs.kind(absolute) === 'file' ? textOf(host, absolute) : null;
  } catch {
    return null;
  }
}

// SPEC §13.5: the literal paths a selected file mentions that nothing it declares covers
export function undeclaredPaths(
  host: Host,
  root: string,
  universe: Universe,
  selected: readonly Result[],
): Undeclared[] {
  const isIgnored = (path: string) => isIgnoredPath(host, root, universe, path);
  return selected
    .filter((result) => result.state !== 'invalid')
    .flatMap((result) => {
      const text = readText(host, root, universe, result.file);
      if (text === null) return [];
      const others = universe.paths.filter((path) => path !== result.file);
      const viaSelected = new Set((result.selected ?? []).map((entry) => entry.path));
      return propose(result.file, text, universe.paths, isIgnored)
        .suggestions.filter(
          ({ pattern, files }) =>
            files.length === 1 &&
            files[0] === pattern &&
            !viaSelected.has(pattern) &&
            statusOf({ pattern, files }, result.dependencies, others) === 'new',
        )
        .map(({ pattern }) => ({ file: result.file, path: pattern }))
        .sort((a, b) => comparePaths(a.path, b.path));
    });
}
