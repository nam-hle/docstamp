import type { ExtractResult } from 'docstamp';

import type { Group } from './declarations.ts';
import type { Selector } from './selector.ts';

const LISTED = 10;
const NEAREST = 5;

const oneLine = (text: string): string =>
  Array.from(text, (character) => {
    const code = character.codePointAt(0)!;
    return code < 0x20 || code === 0x7f ? ' ' : character;
  }).join('');

// SPEC §8.2: edit distance over code points, any value above `slack` meaning "too far"
function distance(a: readonly string[], b: readonly string[], slack: number): number {
  if (Math.abs(a.length - b.length) > slack) return slack + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (const [row, ca] of a.entries()) {
    const current = [row + 1];
    for (const [column, cb] of b.entries()) {
      current.push(
        Math.min(
          previous[column + 1]! + 1,
          current[column]! + 1,
          previous[column]! + (ca === cb ? 0 : 1),
        ),
      );
    }
    if (Math.min(...current) > slack) return slack + 1;
    previous = current;
  }
  return previous[b.length]!;
}

export interface Located {
  readonly group: Group;
  readonly line: number;
}

// SPEC §8.2
export function notFound(selector: Selector, all: readonly Located[]): ExtractResult {
  const label = ({ group, line }: Located): string =>
    `${group.kind} ${oneLine(group.name)} (line ${line})`;
  const listed = (found: readonly Located[], cap: number): string => {
    const shown = found.slice(0, cap).map(label).join(', ');
    return found.length > cap ? `${shown}, and ${found.length - cap} more` : shown;
  };
  const asked = `${selector.kind === undefined ? 'declaration' : selector.kind} named "${oneLine(selector.name)}"`;
  const sameName = all.filter(({ group }) => group.name === selector.name);
  const wanted = Array.from(selector.name);
  const slack = Math.max(2, Math.floor(wanted.length / 3));
  const near = all
    .map((entry) => ({
      entry,
      d:
        entry.group.name.toLowerCase() === selector.name.toLowerCase()
          ? 0
          : distance(Array.from(entry.group.name), wanted, slack),
    }))
    .filter(({ d }) => d <= slack)
    .sort((x, y) => x.d - y.d || x.entry.line - y.entry.line)
    .map(({ entry }) => entry);
  const message =
    all.length === 0
      ? `No ${asked}; the file has no declarations.`
      : sameName.length > 0
        ? `No ${asked}; the file declares ${listed(sameName, NEAREST)}; correct the kind.`
        : near.length > 0
          ? `No ${asked}; nearest: ${listed(near, NEAREST)}.`
          : `No ${asked}; the file declares: ${listed(all, LISTED)}.`;
  return { diagnostics: [{ severity: 'warning', code: 'declaration-not-found', message }] };
}
