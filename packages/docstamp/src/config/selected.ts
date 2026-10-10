import type { SelectedEntry } from '../core/types.ts';
import { literalPath, parsePattern } from '../pattern/parse.ts';
import { canonicalJson, fromValue } from '../plugin/canonical.ts';
import { isMap, type Value } from './value.ts';

export const SELECTED_MESSAGE =
  'A selected dependency is { path, select, match? }: path is one literal file path, select any ' +
  'plain value, match "one" or "all".';

const KEYS = ['path', 'select', 'match'];

const isFinitePlain = (value: Value): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isFinitePlain);
  if (isMap(value)) return [...value.values()].every(isFinitePlain);
  return true;
};

// SPEC §8.7: identical entries (path and CanonicalJson(select)) are one; the first stays
export function dedupeSelected(entries: readonly SelectedEntry[]): SelectedEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.path}\0${canonicalJson(entry.select)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// SPEC §8.7, §3.5
export function parseSelected(value: Value): SelectedEntry | null {
  if (!isMap(value) || [...value.keys()].some((key) => !KEYS.includes(key))) return null;
  const path = value.get('path');
  const select = value.get('select');
  const match = value.get('match') ?? 'one';
  if (typeof path !== 'string' || select === undefined || !isFinitePlain(select)) return null;
  if (match !== 'one' && match !== 'all') return null;
  const parsed = parsePattern(path);
  const denoted = parsed === null || parsed.negated ? null : literalPath(parsed);
  if (denoted === null) return null;
  return { path: denoted, select: fromValue(select), match };
}
