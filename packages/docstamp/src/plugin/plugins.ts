import { types } from 'node:util';

import { Raised, diag } from '../core/diagnostics.ts';
import type { Diagnostic } from '../core/types.ts';
import { select as selectPaths } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';
import { builtinPlugins } from './builtin.ts';
import { canonicalJson } from './canonical.ts';
import type { DocstampPlugin, ExtractInput, ExtractResult, LineRange, Part } from './types.ts';

// SPEC §8.7: the Fragment of a selector and the warnings the plugin reported with it
export interface Extracted {
  readonly parts: readonly Part[];
  readonly warnings: readonly Diagnostic[];
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

const MAX_DIAGNOSTICS = 100;
const isControl = (character: string): boolean => {
  const code = character.codePointAt(0)!;
  return code < 0x20 || code === 0x7f;
};

// SPEC §8.7: a focus and a message are one non-empty line
const isOneLine = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && !Array.from(value).some(isControl);

const isLineRange = (value: unknown): value is LineRange =>
  isObject(value) &&
  Number.isInteger(value['start']) &&
  Number.isInteger(value['end']) &&
  (value['start'] as number) >= 1 &&
  (value['end'] as number) >= (value['start'] as number);

// SPEC §8.7: what a plugin returned, read once so that a getter or a proxy is never called twice
interface Raw {
  readonly promised: boolean;
  readonly parts: unknown;
  readonly diagnostics: unknown;
}

function readRaw(result: unknown): Raw {
  const member = (name: string): unknown => {
    const value = isObject(result) ? result[name] : undefined;
    if (!Array.isArray(value)) return value;
    return Array.from(value as unknown[], (item) => (isObject(item) ? { ...item } : item));
  };
  return {
    promised: isObject(result) && typeof result['then'] === 'function',
    parts: member('parts'),
    diagnostics: member('diagnostics'),
  };
}

// SPEC §8.7: the Parts and the warnings of a selector, or a Raised; the host's error text never
// reaches a message (§5.5)
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
  let raw: Raw;
  try {
    raw = readRaw(result);
  } catch {
    return fail('returned a value that could not be read');
  }
  if (raw.promised) {
    try {
      (result as PromiseLike<unknown>).then(undefined, () => {});
    } catch {
      // the failure is reported below; nothing else to contain
    }
    return fail('returned a promise; extract must be synchronous');
  }
  if (!isObject(result)) return fail('did not return { parts, diagnostics }');
  const parts = raw.parts === undefined ? [] : raw.parts;
  const reported = raw.diagnostics === undefined ? [] : raw.diagnostics;
  if (!Array.isArray(parts)) return fail('returned parts that are not a list');
  if (!Array.isArray(reported) || reported.length > MAX_DIAGNOSTICS) {
    return fail(`returned diagnostics that are not a list of at most ${MAX_DIAGNOSTICS}`);
  }
  const checked: Part[] = parts.map((part: unknown) => {
    if (!isObject(part) || typeof part['content'] !== 'string' || !part['content'].isWellFormed()) {
      return fail('returned a part whose content is not a well-formed string');
    }
    const { content, focus, lines } = part as {
      content: string;
      focus?: unknown;
      lines?: unknown;
    };
    if (focus !== undefined && !isOneLine(focus)) {
      return fail('returned a focus that is not one non-empty line');
    }
    if (lines !== undefined && !isLineRange(lines)) {
      return fail('returned lines that are not { start, end } with 1 <= start <= end');
    }
    return {
      content,
      ...(focus === undefined ? {} : { focus }),
      ...(lines === undefined ? {} : { lines: { start: lines.start, end: lines.end } }),
    };
  });
  const subject = `${input.path}#${canonicalJson(input.select)}`;
  const diagnostics = reported.map((item: unknown) => {
    if (
      !isObject(item) ||
      (item['severity'] !== 'error' && item['severity'] !== 'warning') ||
      !isOneLine(item['message'])
    ) {
      return fail('returned a diagnostic that is not { severity, message } of one line');
    }
    const code = item['severity'] === 'error' ? 'E_SELECT' : 'W_SELECT';
    return diag(code, { subject, message: item['message'] });
  });
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  if (errors.length > 0) throw new Raised([...errors, ...warnings]);
  if (checked.length === 0) {
    throw new Raised([diag('E_SELECT_NOT_FOUND', { subject }), ...warnings]);
  }
  return { parts: checked, warnings };
}
