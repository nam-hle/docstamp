import type { FragmentChange, SelectedEntry } from '../core/types.ts';
import type { Extracted } from '../plugin/plugins.ts';
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
