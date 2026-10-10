import { comparePaths } from '../core/order.ts';
import type { Json } from '../core/types.ts';

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
