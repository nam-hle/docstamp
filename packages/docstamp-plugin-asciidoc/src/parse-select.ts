import type { ParseSelectResult } from 'docstamp';

const MAX_LEVEL = 6;
const isBlank = (character: string | undefined): boolean => character === ' ' || character === '\t';

const BAD_LEVEL =
  'A level marker is one to six = before the title, as in == Install; ' +
  'for a title that starts with = write the selector as { title: ... }.';

const error = (message: string): ParseSelectResult => ({
  diagnostics: [{ severity: 'error', code: 'invalid-selector', message }],
});

// SPEC §4.1: `== Install` is { title, level }, `#install` is { anchor }, any other text is the title
export function parseSelect(raw: string): ParseSelectResult {
  let marks = 0;
  while (raw[marks] === '=') marks += 1;
  if (marks > 0 && isBlank(raw[marks])) {
    if (marks > MAX_LEVEL) return error(BAD_LEVEL);
    let start = marks;
    while (isBlank(raw[start])) start += 1;
    let end = raw.length;
    while (end > start && isBlank(raw[end - 1])) end -= 1;
    const title = raw.slice(start, end);
    if (title === '') return error('The selector has a level marker and no title after it.');
    return { select: { title, level: marks } };
  }
  if (raw[0] === '#' && raw.length > 1 && !isBlank(raw[1])) {
    let end = raw.length;
    while (end > 1 && isBlank(raw[end - 1])) end -= 1;
    return { select: { anchor: raw.slice(1, end) } };
  }
  return { select: raw };
}
