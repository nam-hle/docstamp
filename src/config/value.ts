// SPEC §9.1
export const CONFIG_NAMES = [
  'docstamp.yaml',
  'docstamp.config.ts',
  'docstamp.config.mts',
  'docstamp.config.js',
  'docstamp.config.mjs',
] as const;

export type Value = null | boolean | number | string | Value[] | Map<string, Value>;

export const isMap = (v: Value | undefined): v is Map<string, Value> => v instanceof Map;
export const isStrings = (v: Value | undefined): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

// SPEC §9.3 step 6
export const PRESET_NAME = /^[a-z][a-z0-9-]*$/u;
