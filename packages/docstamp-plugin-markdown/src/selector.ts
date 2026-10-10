export interface Selector {
  readonly heading: string;
  readonly level: number | undefined;
}

const KEYS = new Set(['heading', 'level']);
const BLANKS = /^[ \t]+|[ \t]+$/gu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// SPEC §4
export function parseSelector(value: unknown): Selector {
  const form = typeof value === 'string' ? { heading: value } : value;
  if (!isRecord(form) || Object.keys(form).some((key) => !KEYS.has(key))) {
    throw new Error('The selector is a heading text or { heading, level? }.');
  }
  const { heading, level } = form;
  if (typeof heading !== 'string' || heading.replaceAll(BLANKS, '') === '') {
    throw new Error('The selector needs a non-empty heading text.');
  }
  if (
    level !== undefined &&
    (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 6)
  ) {
    throw new Error('The level of a selector is an integer from 1 to 6.');
  }
  return {
    heading: heading.replaceAll(BLANKS, ''),
    level: level as number | undefined,
  };
}
