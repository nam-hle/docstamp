import type { ExtractResult } from 'docstamp';

import type { Selector } from './selector.ts';
import type { Heading } from './sections.ts';

const LISTED = 10;
const NEAREST = 5;

// SPEC §6.2: edit distance over code points, any value above `slack` meaning "too far"
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

export interface Located extends Heading {
  readonly line: number;
}

// SPEC §6.2
export function notFound(
  selector: Selector,
  all: readonly Located[],
  oneLine: (text: string) => string,
): ExtractResult {
  const label = (h: Located): string =>
    `${'#'.repeat(h.depth)} ${oneLine(h.text)} (line ${h.line})`;
  const listed = (found: readonly Located[], cap: number): string => {
    const shown = found.slice(0, cap).map(label).join(', ');
    return found.length > cap ? `${shown}, and ${found.length - cap} more` : shown;
  };
  const asked = `"${oneLine(selector.heading)}"${
    selector.level === undefined ? '' : ` at level ${selector.level}`
  }`;
  const otherLevel = all.filter((h) => h.text === selector.heading);
  const wanted = Array.from(selector.heading);
  const slack = Math.max(2, Math.floor(wanted.length / 3));
  const near = all
    .map((h) => ({
      h,
      d:
        h.text.toLowerCase() === selector.heading.toLowerCase()
          ? 0
          : distance(Array.from(h.text), wanted, slack),
    }))
    .filter(({ d }) => d <= slack)
    .sort((x, y) => x.d - y.d || x.h.line - y.h.line)
    .map(({ h }) => h);
  const message =
    all.length === 0
      ? `No heading ${asked}; the file has no headings.`
      : otherLevel.length > 0
        ? `No heading ${asked}; the text is at ${listed(otherLevel, NEAREST)}; correct the level.`
        : near.length > 0
          ? `No heading ${asked}; nearest: ${listed(near, NEAREST)}.`
          : `No heading ${asked}; the file has: ${listed(all, LISTED)}.`;
  return { diagnostics: [{ severity: 'warning', code: 'heading-not-found', message }] };
}
