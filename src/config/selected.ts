import type { SelectedEntry } from '../core/types.ts';
import { literalPath, parsePattern } from '../pattern/parse.ts';
import { fromValue } from '../plugin/canonical.ts';
import { isMap, type Value } from './value.ts';

export const SELECTED_MESSAGE =
  'A selected dependency is { path, select, match? }: path is one literal file path, select any ' +
  'plain value, match "one" or "all".';

const KEYS = ['path', 'select', 'match'];

// SPEC §8.7
export function parseSelected(value: Value): SelectedEntry | null {
  if (!isMap(value) || [...value.keys()].some((key) => !KEYS.includes(key))) return null;
  const path = value.get('path');
  const select = value.get('select');
  const match = value.get('match') ?? 'one';
  if (typeof path !== 'string' || select === undefined) return null;
  if (match !== 'one' && match !== 'all') return null;
  const parsed = parsePattern(path);
  if (parsed === null || parsed.negated || literalPath(parsed) !== path) return null;
  return { path, select: fromValue(select), match };
}
