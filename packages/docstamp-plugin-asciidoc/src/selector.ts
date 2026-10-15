export type Selector =
  | { readonly kind: 'title'; readonly title: string; readonly level: number | undefined }
  | { readonly kind: 'anchor'; readonly anchor: string };

const KEYS = new Set(['title', 'level', 'anchor']);
const isBlank = (character: string | undefined): boolean => character === ' ' || character === '\t';

// SPEC §4: leading and trailing U+0020 and U+0009, in one linear pass
export function trimBlanks(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isBlank(text[start])) start += 1;
  while (end > start && isBlank(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// SPEC §4
export function parseSelector(value: unknown): Selector {
  const form = typeof value === 'string' ? { title: value } : value;
  if (!isRecord(form) || Object.keys(form).some((key) => !KEYS.has(key))) {
    throw new Error('The selector is a title, { title, level? } or { anchor }.');
  }
  const { title, level, anchor } = form;
  if (anchor !== undefined) {
    if (title !== undefined || level !== undefined) {
      throw new Error('An anchor selector has no title and no level.');
    }
    if (typeof anchor !== 'string' || trimBlanks(anchor) === '') {
      throw new Error('The selector needs a non-empty anchor.');
    }
    return { kind: 'anchor', anchor: trimBlanks(anchor) };
  }
  if (typeof title !== 'string' || trimBlanks(title) === '') {
    throw new Error('The selector needs a non-empty title.');
  }
  if (
    level !== undefined &&
    (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 6)
  ) {
    throw new Error('The level of a selector is an integer from 1 to 6.');
  }
  return { kind: 'title', title: trimBlanks(title), level: level as number | undefined };
}
