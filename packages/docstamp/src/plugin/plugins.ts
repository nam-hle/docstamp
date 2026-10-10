import { types } from 'node:util';

import { Raised, diag } from '../core/diagnostics.ts';
import { select as selectPaths } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';
import { builtinPlugins } from './builtin.ts';
import type { DocstampPlugin, ExtractInput, ExtractResult, LineRange } from './types.ts';

// SPEC §8.7: what a plugin returned, validated
export interface Extracted {
  readonly hashes: string[];
  readonly focus?: readonly string[];
  readonly lines?: readonly LineRange[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const bad = (subject: string, message: string): never => {
  throw new Raised([diag('E_PLUGIN', { subject, message })]);
};

// SPEC §9.5, §8.7
export function validatePlugins(raw: unknown): DocstampPlugin[] {
  if (!Array.isArray(raw)) return bad('plugins', 'The "plugins" member must be a list of plugins.');
  if (types.isProxy(raw)) return bad('plugins', 'The "plugins" list must be a plain list.');
  const names = new Set<string>();
  let length: number;
  try {
    length = raw.length;
  } catch {
    return bad('plugins', 'The "plugins" list could not be read.');
  }
  return Array.from({ length }, (_, index) => {
    const label = `plugins[${index}]`;
    try {
      if (!(index in raw)) return bad(label, 'The "plugins" list must not have holes.');
      return validateEntry(raw[index], label, names);
    } catch (error) {
      if (error instanceof Raised) throw error;
      return bad(label, 'A plugin member could not be read.');
    }
  });
}

function validateEntry(entry: unknown, label: string, names: Set<string>): DocstampPlugin {
  if (!isObject(entry)) return bad(label, 'A plugin must be an object.');
  const { name, apiVersion, files, extract } = entry;
  if (typeof name !== 'string' || name === '') return bad(label, 'A plugin needs a "name".');
  if (apiVersion !== 1) {
    return bad(
      name,
      `Plugin "${name}" has apiVersion ${String(apiVersion)}; this docstamp supports apiVersion 1.`,
    );
  }
  const patterns = Array.isArray(files) ? (files as unknown[]) : [];
  if (
    patterns.length === 0 ||
    !patterns.every((pattern) => typeof pattern === 'string' && parsePattern(pattern))
  ) {
    return bad(name, `Plugin "${name}" needs "files": a non-empty list of valid patterns.`);
  }
  if (typeof extract !== 'function') {
    return bad(name, `Plugin "${name}" needs an "extract" function.`);
  }
  if (names.has(name)) return bad(name, `Two plugins are named "${name}"; names must be unique.`);
  names.add(name);
  // read once: later calls never touch a getter of the user object again
  const snapshot = [...(patterns as string[])];
  return {
    name,
    apiVersion: 1,
    files: snapshot,
    extract: (input) => Reflect.apply(extract, entry, [input]) as ExtractResult,
  };
}

const claims = (plugin: DocstampPlugin, path: string): boolean => {
  const patterns = plugin.files.map((source) => parsePattern(source) as ParsedPattern);
  return selectPaths(patterns, [path]).length > 0;
};

// SPEC §8.7, §8.8
export function claim(plugins: readonly DocstampPlugin[], path: string): DocstampPlugin {
  const registered = plugins.filter((plugin) => claims(plugin, path));
  const claimed =
    registered.length > 0 ? registered : builtinPlugins.filter((plugin) => claims(plugin, path));
  if (claimed.length === 1) return claimed[0]!;
  if (claimed.length === 0) {
    const message = `No plugin claims "${path}": register one whose "files" select it.`;
    throw new Raised([diag('E_SELECT', { subject: path, message })]);
  }
  const names = claimed.map((plugin) => `"${plugin.name}"`).join(', ');
  const message = `Plugins ${names} all claim "${path}"; narrow their "files" so one does.`;
  throw new Raised([diag('E_PLUGIN', { subject: path, message })]);
}

const isLineRange = (value: unknown): value is LineRange =>
  isObject(value) &&
  Number.isInteger(value['start']) &&
  Number.isInteger(value['end']) &&
  (value['start'] as number) >= 1 &&
  (value['end'] as number) >= (value['start'] as number);

// SPEC §8.7: the host's error text never reaches a message (§5.5)
export function runExtract(plugin: DocstampPlugin, input: ExtractInput): Extracted {
  const fail = (why: string): never => {
    const message = `Plugin "${plugin.name}" ${why} for "${input.path}".`;
    throw new Raised([diag('E_SELECT', { subject: input.path, message })]);
  };
  let result: unknown;
  try {
    result = plugin.extract(input);
  } catch {
    return fail('threw');
  }
  let promised: boolean;
  let hashes: unknown;
  let focus: unknown;
  let lines: unknown;
  try {
    promised = isObject(result) && typeof result['then'] === 'function';
    const read = (name: string): unknown => {
      const member = isObject(result) ? result[name] : undefined;
      return Array.isArray(member) ? Array.from(member as unknown[]) : member;
    };
    hashes = read('hashes');
    focus = read('focus');
    lines = read('lines');
  } catch {
    return fail('returned a value that could not be read');
  }
  if (promised) {
    try {
      (result as PromiseLike<unknown>).then(undefined, () => {});
    } catch {
      // the failure is reported below; nothing else to contain
    }
    return fail('returned a promise; extract must be synchronous');
  }
  if (!Array.isArray(hashes)) return fail('did not return { hashes: string[] }');
  if (!hashes.every((hash) => typeof hash === 'string' && hash !== '')) {
    return fail('returned a hash that is not a non-empty string');
  }
  const same = (list: unknown[]) => list.length === hashes.length;
  if (
    focus !== undefined &&
    !(Array.isArray(focus) && same(focus) && focus.every((f) => typeof f === 'string' && f !== ''))
  ) {
    return fail('returned a focus that is not one non-empty string per hash');
  }
  if (lines !== undefined && !(Array.isArray(lines) && same(lines) && lines.every(isLineRange))) {
    return fail('returned lines that are not one { start, end } per hash');
  }
  return {
    hashes: hashes as string[],
    ...(focus === undefined ? {} : { focus: focus as string[] }),
    ...(lines === undefined
      ? {}
      : { lines: (lines as LineRange[]).map(({ start, end }) => ({ start, end })) }),
  };
}
