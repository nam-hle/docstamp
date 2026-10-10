const KINDS = ['function', 'class', 'interface', 'type', 'enum', 'variable', 'namespace'] as const;

export type Kind = (typeof KINDS)[number];
type Part = 'shape' | 'source';

export interface Selector {
  readonly name: string;
  readonly kind: Kind | undefined;
  readonly part: Part;
}

const KEYS = new Set(['name', 'kind', 'part']);
const BLANKS = /^[ \t]+|[ \t]+$/gu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// SPEC §4
export function parseSelector(value: unknown): Selector {
  const form = typeof value === 'string' ? { name: value } : value;
  if (!isRecord(form) || Object.keys(form).some((key) => !KEYS.has(key))) {
    throw new Error('The selector is a name or { name, kind?, part? }.');
  }
  const { name, kind, part = 'shape' } = form;
  if (typeof name !== 'string' || name.replaceAll(BLANKS, '') === '') {
    throw new Error('The selector needs a non-empty name.');
  }
  if (kind !== undefined && !(KINDS as readonly unknown[]).includes(kind)) {
    throw new Error(`The kind of a selector is one of ${KINDS.join(', ')}.`);
  }
  if (part !== 'shape' && part !== 'source') {
    throw new Error('The part of a selector is shape or source.');
  }
  return {
    name: name.replaceAll(BLANKS, ''),
    kind: kind as Kind | undefined,
    part,
  };
}
