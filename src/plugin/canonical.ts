import { isMap, type Value } from '../config/value.ts';
import { comparePaths } from '../core/order.ts';
import type { Json } from '../core/types.ts';

// SPEC §3.5: a configuration value as a plain value, a Map becoming an object
export function fromValue(value: Value): Json {
  if (Array.isArray(value)) return value.map(fromValue);
  if (!isMap(value)) return value;
  return Object.fromEntries([...value].map(([key, member]) => [key, fromValue(member)]));
}

// SPEC §3.5
export function canonicalJson(value: Json): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${(value as readonly Json[]).map(canonicalJson).join(',')}]`;
  const object = value as { readonly [key: string]: Json };
  const members = Object.keys(object)
    .sort(comparePaths)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key]!)}`);
  return `{${members.join(',')}}`;
}
