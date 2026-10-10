import { Raised, diag } from '../core/diagnostics.ts';
import { select as selectPaths } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';
import type { DocstampPlugin, ExtractInput } from './types.ts';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const bad = (subject: string, message: string): never => {
  throw new Raised([diag('E_PLUGIN', { subject, message })]);
};

// SPEC §9.5, §8.7
export function validatePlugins(raw: unknown): DocstampPlugin[] {
  if (!Array.isArray(raw)) return bad('plugins', 'The "plugins" member must be a list of plugins.');
  const names = new Set<string>();
  return Array.from({ length: raw.length }, (_, index) => {
    const label = `plugins[${index}]`;
    if (!(index in raw)) return bad(label, 'The "plugins" list must not have holes.');
    try {
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
  return entry as unknown as DocstampPlugin;
}

// SPEC §8.7
export function claim(plugins: readonly DocstampPlugin[], path: string): DocstampPlugin {
  const claimed = plugins.filter((plugin) => {
    const patterns = plugin.files.map((source) => parsePattern(source) as ParsedPattern);
    return selectPaths(patterns, [path]).length > 0;
  });
  if (claimed.length === 1) return claimed[0]!;
  if (claimed.length === 0) {
    const message = `No plugin claims "${path}": register one whose "files" select it.`;
    throw new Raised([diag('E_SELECT', { subject: path, message })]);
  }
  const names = claimed.map((plugin) => `"${plugin.name}"`).join(', ');
  const message = `Plugins ${names} all claim "${path}"; narrow their "files" so one does.`;
  throw new Raised([diag('E_PLUGIN', { subject: path, message })]);
}

// SPEC §8.7: the host's error text never reaches a message (§5.5)
export function runExtract(plugin: DocstampPlugin, input: ExtractInput): string[] {
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
  try {
    promised = isObject(result) && typeof result['then'] === 'function';
    hashes = isObject(result) ? result['hashes'] : undefined;
    if (Array.isArray(hashes)) hashes = Array.from(hashes as unknown[]);
  } catch {
    return fail('returned a value that could not be read');
  }
  if (promised) return fail('returned a promise; extract must be synchronous');
  if (!Array.isArray(hashes)) return fail('did not return { hashes: string[] }');
  if (!hashes.every((hash) => typeof hash === 'string' && hash !== '')) {
    return fail('returned a hash that is not a non-empty string');
  }
  return hashes as string[];
}
