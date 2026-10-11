import { sortPaths } from '../core/order.ts';
import type { Declaration, Lock, Result } from '../core/types.ts';

export interface UpdatePlan {
  entries: Map<string, string>;
  removed: string[];
  written: string[];
  unchanged: string[];
  stamps: Map<string, string>;
  hasLockedFiles: boolean;
}

// SPEC §13.5: what `update` records, from the evaluation alone; the caller writes it
export function planUpdate(
  selected: readonly Result[],
  declarations: readonly Declaration[],
  lock: Lock,
): UpdatePlan {
  const inlineRecorded = new Map(
    declarations.filter((d) => d.inline).map((d) => [d.file, d.inline!.recorded]),
  );
  const entries = new Map(lock.entries);
  for (const r of selected) if (!inlineRecorded.has(r.file)) entries.set(r.file, r.current);
  const bound = new Set(declarations.filter((d) => !d.inline).map((d) => d.file));
  const removed = sortPaths([...entries.keys()].filter((file) => !bound.has(file)));
  for (const file of removed) entries.delete(file);
  const isWritten = (r: Result) =>
    inlineRecorded.has(r.file)
      ? inlineRecorded.get(r.file) !== r.current
      : lock.entries.get(r.file) !== r.current;
  const written = selected.filter(isWritten).map((r) => r.file);
  const unchanged = selected.map((r) => r.file).filter((file) => !written.includes(file));
  const stamps = new Map(
    selected
      .filter((r) => isWritten(r) && inlineRecorded.has(r.file))
      .map((r) => [r.file, r.current]),
  );
  return { entries, removed, written, unchanged, stamps, hasLockedFiles: bound.size > 0 };
}
