import type { FragmentChange, SelectedEntry } from '../core/types.ts';
import type { Extracted } from '../plugin/plugins.ts';
import { canonicalJson } from '../core/canonical.ts';
import type { Git } from '../host/git.ts';

// What the CLI gives the history: the plugin calls, which never run in this module
export interface FragmentProbe {
  readonly entries: readonly SelectedEntry[];
  readonly now: (entry: SelectedEntry) => Extracted | null;
  readonly earlier: (entry: SelectedEntry, text: string) => Extracted | null;
}

const sameContents = (a: Extracted, b: Extracted): boolean =>
  a.parts.length === b.parts.length &&
  a.parts.every((part, index) => part.content === b.parts[index]!.content);

// SPEC §12.3 step 11: the text of a path at a commit as a plugin reads it, null when not text
function textAt(git: Git, commit: string, path: string): string | null {
  try {
    const old = git.fileAt(commit, path);
    return old.slice(0, 8192).includes('\0') ? null : old.replaceAll('\r\n', '\n');
  } catch {
    return null;
  }
}

// SPEC §12.3 step 11
export function fragmentChanges(
  git: Git,
  commit: string,
  { entries, now, earlier }: FragmentProbe,
): FragmentChange[] {
  const changes: FragmentChange[] = [];
  for (const entry of entries) {
    const current = now(entry);
    if (current === null) continue;
    const old = textAt(git, commit, entry.path);
    const before = old === null ? null : earlier(entry, old);
    const status = before === null ? 'new' : sameContents(before, current) ? null : 'changed';
    if (status === null) continue;
    const infos = current.parts.map(({ focus, lines }) => ({
      ...(focus === undefined ? {} : { focus }),
      ...(lines === undefined ? {} : { lines }),
    }));
    const described = infos.some((info) => info.focus !== undefined || info.lines !== undefined);
    changes.push({
      path: entry.path,
      select: entry.select,
      status,
      ...(described ? { parts: infos } : {}),
    });
  }
  return changes;
}

// SPEC §12.5: the Fragment per object id and selector, for one run
export type FragmentCache = Map<string, Extracted | null>;

const objectAt = (git: Git, rev: string, path: string): string | null => {
  try {
    return git.objectAt(rev, path);
  } catch {
    return null;
  }
};

// SPEC §12.5: the Fragment of the entry differs between the first parent of a commit and the commit
export function fragmentChangedAt(
  git: Git,
  commit: string,
  entry: SelectedEntry,
  earlier: FragmentProbe['earlier'],
  cache: FragmentCache,
): boolean {
  const select = canonicalJson(entry.select);
  const fragmentAt = (rev: string): Extracted | null => {
    const object = objectAt(git, rev, entry.path);
    if (object === null) return null;
    const key = `${object}\0${select}`;
    if (!cache.has(key)) {
      const text = textAt(git, rev, entry.path);
      cache.set(key, text === null ? null : earlier(entry, text));
    }
    return cache.get(key)!;
  };
  const then = fragmentAt(`${commit}^`);
  const now = fragmentAt(commit);
  return then === null || now === null ? then !== now : !sameContents(then, now);
}
