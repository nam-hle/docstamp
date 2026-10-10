// SPEC §9.6.2: the keys of an inline block and the form of its hash, shared by the parser and the schema
export const BLOCK_KEYS = ['dependencies', 'use', 'hash'] as const;
export const HASH = /^[0-9a-f]{64}$/u;
