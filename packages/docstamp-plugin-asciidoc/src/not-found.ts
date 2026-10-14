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

// The entries of `all` whose `text` is within the slack of `wanted`, nearest first
function nearest(
  all: readonly Located[],
  wanted: string,
  textOf: (heading: Located) => string,
): Located[] {
  const wantedPoints = Array.from(wanted);
  const slack = Math.max(2, Math.floor(wantedPoints.length / 3));
  return all
    .map((heading) => ({
      heading,
      d:
        textOf(heading).toLowerCase() === wanted.toLowerCase()
          ? 0
          : distance(Array.from(textOf(heading)), wantedPoints, slack),
    }))
    .filter(({ d }) => d <= slack)
    .sort((x, y) => x.d - y.d || x.heading.line - y.heading.line)
    .map(({ heading }) => heading);
}

// SPEC §6.2
export function notFound(
  selector: Selector,
  all: readonly Located[],
  oneLine: (text: string) => string,
): ExtractResult {
  const label = (heading: Located): string =>
    `${'='.repeat(heading.level)} ${oneLine(heading.title)} (line ${heading.line})`;
  const listed = (found: readonly Located[], cap: number): string => {
    const shown = found.slice(0, cap).map(label).join(', ');
    return found.length > cap ? `${shown}, and ${found.length - cap} more` : shown;
  };
  const message = ((): string => {
    if (selector.kind === 'anchor') {
      const asked = `No section with the anchor "${oneLine(selector.anchor)}"`;
      const anchored = all.filter((heading) => heading.anchor !== undefined);
      if (anchored.length === 0) return `${asked}; the file has no section with an anchor.`;
      const near = nearest(anchored, selector.anchor, (heading) => heading.anchor!);
      return near.length > 0
        ? `${asked}; nearest: ${listed(near, NEAREST)}.`
        : `${asked}; the anchored sections are: ${listed(anchored, LISTED)}.`;
    }
    const asked = `No section "${oneLine(selector.title)}"${
      selector.level === undefined ? '' : ` at level ${selector.level}`
    }`;
    if (all.length === 0) return `${asked}; the file has no sections.`;
    const otherLevel = all.filter((heading) => heading.title === selector.title);
    if (otherLevel.length > 0) {
      return `${asked}; the title is at ${listed(otherLevel, NEAREST)}; correct the level.`;
    }
    const near = nearest(all, selector.title, (heading) => heading.title);
    return near.length > 0
      ? `${asked}; nearest: ${listed(near, NEAREST)}.`
      : `${asked}; the file has: ${listed(all, LISTED)}.`;
  })();
  return { diagnostics: [{ severity: 'warning', code: 'section-not-found', message }] };
}
