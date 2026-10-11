import type { ParseSelectResult } from 'docstamp';

const MAX_LEVEL = 6;
const isBlank = (character: string | undefined): boolean => character === ' ' || character === '\t';

const BAD_LEVEL =
  'A level marker is one to six # before the heading, as in ## Install; ' +
  'for a heading that starts with # write the selector as { heading: ... }.';

// SPEC §4.1: `## Install` is { heading, level }, any other text is the String itself
export function parseSelect(raw: string): ParseSelectResult {
  let hashes = 0;
  while (raw[hashes] === '#') hashes += 1;
  if (hashes === 0 || !isBlank(raw[hashes])) return { select: raw };
  if (hashes > MAX_LEVEL) {
    return { diagnostics: [{ severity: 'error', code: 'invalid-selector', message: BAD_LEVEL }] };
  }
  let start = hashes;
  while (isBlank(raw[start])) start += 1;
  let end = raw.length;
  while (end > start && isBlank(raw[end - 1])) end -= 1;
  const heading = raw.slice(start, end);
  if (heading === '') {
    return {
      diagnostics: [
        {
          severity: 'error',
          code: 'invalid-selector',
          message: 'The selector has a level marker and no heading text after it.',
        },
      ],
    };
  }
  return { select: { heading, level: hashes } };
}
