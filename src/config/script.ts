import { createRequire } from 'node:module';
import { types } from 'node:util';
import { Raised, diag } from '../core/diagnostics.ts';
import type { Value } from './value.ts';

const NO_DEFAULT =
  'The configuration module has no default export; use "export default" ' +
  '(a CommonJS module.exports value is also accepted).';

class Violation extends Error {
  constructor(readonly key: string) {
    super(key);
  }
}

const isData = (d: PropertyDescriptor | undefined): d is PropertyDescriptor & { value: unknown } =>
  d !== undefined && 'value' in d;

function toPlain(v: unknown, ancestors: readonly object[], key: string): Value {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (Number.isFinite(v)) return v;
    throw new Violation(key);
  }
  if (typeof v !== 'object' || ancestors.includes(v) || types.isProxy(v)) {
    throw new Violation(key);
  }
  const path = [...ancestors, v];
  const own = Reflect.ownKeys(v);
  if (Array.isArray(v)) {
    const indexes = new Set(own.filter((k) => k !== 'length'));
    const dense = Array.from({ length: v.length }, (_, i) => String(i));
    if (indexes.size !== dense.length || !dense.every((i) => indexes.has(i))) {
      throw new Violation(key);
    }
    return dense.map((i) => toPlain(dataOf(v, i, key), path, key));
  }
  const proto: unknown = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new Violation(key);
  const map = new Map<string, Value>();
  for (const name of own) {
    if (typeof name !== 'string') throw new Violation(key);
    const top = ancestors.length === 0 ? name : key;
    if (Object.getOwnPropertyDescriptor(v, name)?.enumerable !== true) throw new Violation(top);
    map.set(name, toPlain(dataOf(v, name, top), path, top));
  }
  return map;
}

function dataOf(object: object, name: string, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  if (!isData(descriptor)) throw new Violation(key);
  return descriptor.value;
}

// SPEC §9.5
export function loadScript(absPath: string): Value {
  let exported: unknown;
  try {
    const loaded: unknown = createRequire(absPath)(absPath);
    if (
      types.isModuleNamespaceObject(loaded) &&
      (loaded as { default?: unknown }).default == null
    ) {
      throw new Raised([diag('E_CONFIG', { message: NO_DEFAULT })]);
    }
    const fallback = (loaded as { default?: unknown } | null)?.default;
    exported = fallback ?? loaded;
  } catch (error) {
    if (error instanceof Raised) throw error;
    throw new Raised([diag('E_CONFIG')]);
  }
  try {
    return toPlain(exported, [], '');
  } catch (error) {
    if (error instanceof Violation || error instanceof RangeError) {
      throw new Raised([
        diag('E_CONFIG', error instanceof Violation ? { subject: error.key } : {}),
      ]);
    }
    throw error;
  }
}
