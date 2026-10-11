import { canonicalJson } from '../core/canonical.ts';
import { comparePaths } from '../core/order.ts';
import type { Json } from '../core/types.ts';
import type { JsonSchema } from './types.ts';

const TYPES = ['string', 'integer', 'number', 'boolean', 'object', 'array', 'null'];
const SCHEMA_KEYWORDS = [
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'oneOf',
  'anyOf',
  'description',
];

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0;

// SPEC §3.5: a plain value, copied; undefined when it holds anything else
export function toPlainJson(value: unknown): Json | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.isWellFormed() ? value : undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = (value as unknown[]).map(toPlainJson);
    return items.includes(undefined) ? undefined : (items as Json[]);
  }
  if (!isMap(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const copy: Record<string, Json> = {};
  for (const key of Object.keys(value)) {
    const member = toPlainJson(value[key]);
    if (member === undefined) return undefined;
    Object.defineProperty(copy, key, {
      value: member,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy;
}

// SPEC §8.7 Select Schema: a copy of `raw`, or the problem naming the keyword
export function readSchema(
  raw: unknown,
  where: string,
): { schema: JsonSchema } | { problem: string } {
  const copy = toPlainJson(raw);
  if (copy === undefined || !isMap(copy)) {
    return { problem: `The schema at ${where} must be a Map of plain values.` };
  }
  const found = firstProblem(copy, where);
  if (found === null) return { schema: copy as JsonSchema };
  return { problem: `The keyword "${found.keyword}" at ${found.where} must be ${found.why}.` };
}

interface Problem {
  readonly keyword: string;
  readonly where: string;
  readonly why: string;
}

const list = (value: unknown): value is unknown[] => Array.isArray(value);

// the keywords of a schema, tested in the order of the table of §8.7
function firstProblem(schema: Record<string, unknown>, where: string): Problem | null {
  const unknown = Object.keys(schema)
    .sort(comparePaths)
    .find((key) => !SCHEMA_KEYWORDS.includes(key));
  const bad = (keyword: string, why: string): Problem => ({ keyword, where, why });
  if (unknown !== undefined) return bad(unknown, 'one of the supported keywords');
  const subSchemas = (keyword: string, entries: [string, unknown][]): Problem | null => {
    for (const [at, entry] of entries) {
      if (!isMap(entry)) return bad(keyword, `a schema (${at} is not)`);
      const inner = firstProblem(entry, `${where}/${keyword}/${at}`);
      if (inner !== null) return inner;
    }
    return null;
  };
  const { type, enum: enumeration, required, properties, items, oneOf, anyOf } = schema;
  if (type !== undefined) {
    const names = list(type) ? type : [type];
    const valid =
      names.length > 0 &&
      names.every((name) => typeof name === 'string' && TYPES.includes(name)) &&
      new Set(names).size === names.length;
    if (!valid)
      return bad('type', `a type name, or a list of distinct ones, of ${TYPES.join(', ')}`);
  }
  if (enumeration !== undefined && (!list(enumeration) || enumeration.length === 0)) {
    return bad('enum', 'a non-empty list');
  }
  if (properties !== undefined) {
    if (!isMap(properties)) return bad('properties', 'a Map from a name to a schema');
    const inner = subSchemas('properties', Object.entries(properties));
    if (inner !== null) return inner;
  }
  if (
    required !== undefined &&
    !(
      list(required) &&
      required.every((name) => typeof name === 'string') &&
      new Set(required).size === required.length
    )
  ) {
    return bad('required', 'a list of distinct strings');
  }
  if (
    schema['additionalProperties'] !== undefined &&
    typeof schema['additionalProperties'] !== 'boolean'
  ) {
    return bad('additionalProperties', 'only a boolean is supported');
  }
  if (items !== undefined) {
    if (!isMap(items)) return bad('items', 'a single schema');
    const inner = firstProblem(items, `${where}/items`);
    if (inner !== null) return inner;
  }
  for (const keyword of ['minItems', 'maxItems', 'minLength', 'maxLength']) {
    if (schema[keyword] !== undefined && !isCount(schema[keyword])) {
      return bad(keyword, 'a non-negative integer');
    }
  }
  for (const keyword of ['minimum', 'maximum']) {
    if (schema[keyword] !== undefined && typeof schema[keyword] !== 'number') {
      return bad(keyword, 'a number');
    }
  }
  for (const [keyword, alternatives] of [
    ['oneOf', oneOf],
    ['anyOf', anyOf],
  ] as const) {
    if (alternatives === undefined) continue;
    if (!list(alternatives) || alternatives.length === 0) {
      return bad(keyword, 'a non-empty list of schemas');
    }
    const inner = subSchemas(
      keyword,
      alternatives.map((entry, at) => [String(at), entry]),
    );
    if (inner !== null) return inner;
  }
  if (schema['description'] !== undefined && typeof schema['description'] !== 'string') {
    return bad('description', 'a string');
  }
  return null;
}

const kindOf = (value: Json): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
};

const matchesType = (name: string, value: Json): boolean =>
  name === 'integer'
    ? Number.isInteger(value)
    : name === kindOf(value) || (name === 'number' && typeof value === 'number');

const quoted = (value: Json): string => canonicalJson(value);

// SPEC §8.7 CheckSelect: the first failure, as "<pointer>: <expected>", or null
export function checkSelect(schema: JsonSchema, value: Json, pointer = ''): Failure | null {
  const fail = (expected: string): Failure => ({ pointer, expected });
  const { type, enum: enumeration, const: constant } = schema;
  if (type !== undefined) {
    const names = typeof type === 'string' ? [type] : type;
    if (!names.some((name) => matchesType(name, value))) {
      return fail(`${names.join(' or ')}, not ${kindOf(value)}`);
    }
  }
  if (enumeration !== undefined && !enumeration.some((item) => quoted(item) === quoted(value))) {
    return fail(`one of ${enumeration.map(quoted).join(', ')}, not ${quoted(value)}`);
  }
  if (Object.hasOwn(schema, 'const') && quoted(constant as Json) !== quoted(value)) {
    return fail(`${quoted(constant as Json)}, not ${quoted(value)}`);
  }
  const inner = checkKind(schema, value, pointer, fail);
  if (inner !== null) return inner;
  const { anyOf, oneOf } = schema;
  if (anyOf !== undefined && !anyOf.some((branch) => checkSelect(branch, value) === null)) {
    return fail('a value that matches at least one of the alternatives');
  }
  if (oneOf !== undefined) {
    const passing = oneOf.filter((branch) => checkSelect(branch, value) === null).length;
    if (passing !== 1) {
      return fail(`a value that matches exactly one of the alternatives, not ${passing}`);
    }
  }
  return null;
}

export interface Failure {
  readonly pointer: string;
  readonly expected: string;
}

const escapePointer = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');

function checkKind(
  schema: JsonSchema,
  value: Json,
  pointer: string,
  fail: (expected: string) => Failure,
): Failure | null {
  if (Array.isArray(value)) {
    const items = value as readonly Json[];
    if (schema.minItems !== undefined && items.length < schema.minItems) {
      return fail(`at least ${schema.minItems} items, not ${items.length}`);
    }
    if (schema.maxItems !== undefined && items.length > schema.maxItems) {
      return fail(`at most ${schema.maxItems} items, not ${items.length}`);
    }
    for (const [at, item] of items.entries()) {
      const failure =
        schema.items === undefined ? null : checkSelect(schema.items, item, `${pointer}/${at}`);
      if (failure !== null) return failure;
    }
    return null;
  }
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      return fail(`at least ${schema.minLength} characters, not ${length}`);
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      return fail(`at most ${schema.maxLength} characters, not ${length}`);
    }
    return null;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return fail(`at least ${schema.minimum}, not ${value}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return fail(`at most ${schema.maximum}, not ${value}`);
    }
    return null;
  }
  if (value === null || typeof value === 'boolean') return null;
  return checkMap(schema, value as { readonly [key: string]: Json }, pointer);
}

function checkMap(
  schema: JsonSchema,
  value: { readonly [key: string]: Json },
  pointer: string,
): Failure | null {
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) {
      return { pointer: `${pointer}/${escapePointer(key)}`, expected: 'a member that is required' };
    }
  }
  const properties = schema.properties ?? {};
  for (const key of Object.keys(properties).sort(comparePaths)) {
    if (!Object.hasOwn(value, key)) continue;
    const failure = checkSelect(properties[key]!, value[key]!, `${pointer}/${escapePointer(key)}`);
    if (failure !== null) return failure;
  }
  if (schema.additionalProperties === false) {
    const extra = Object.keys(value)
      .sort(comparePaths)
      .find((key) => !Object.hasOwn(properties, key));
    if (extra !== undefined) {
      const known = Object.keys(properties).sort(comparePaths).join(', ');
      return {
        pointer: `${pointer}/${escapePointer(extra)}`,
        expected: `no such member; the members are ${known === '' ? 'none' : known}`,
      };
    }
  }
  return null;
}
