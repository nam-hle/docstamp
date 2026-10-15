import { types } from 'node:util';

import { Raised, diag } from '../core/diagnostics.ts';
import type { Diagnostic } from '../core/types.ts';
import { select as selectPaths } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';
import { builtinPlugins } from './builtin.ts';
import { canonicalJson } from '../core/canonical.ts';
import type { Json } from '../core/types.ts';
import type {
  DocstampPlugin,
  ExtractInput,
  ExtractResult,
  JsonSchema,
  LineRange,
  MentionsInput,
  MentionsResult,
  ParseSelectResult,
  Part,
  ValidateSelectResult,
} from './types.ts';
import { checkSelect, readSchema, toPlainJson } from './schema.ts';

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

// SPEC §8.7: read once into plain data, so a getter or a proxy is never called again
function readMeta(raw: unknown, name: string): JsonSchema | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) return bad(name, `Plugin "${name}" has a "meta" that is not a Map.`);
  const schema = raw['schema'];
  if (schema === undefined) return undefined;
  const read = readSchema(schema, 'meta.schema');
  if ('problem' in read) return bad(name, `Plugin "${name}": ${read.problem}`);
  return read.schema;
}

function validateEntry(entry: unknown, label: string, names: Set<string>): DocstampPlugin {
  if (!isObject(entry)) return bad(label, 'A plugin must be an object.');
  const { name, apiVersion, files, extract, validateSelect, parseSelect, mentions, meta } = entry;
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
  if (validateSelect !== undefined && typeof validateSelect !== 'function') {
    return bad(name, `Plugin "${name}" has a "validateSelect" that is not a function.`);
  }
  if (parseSelect !== undefined && typeof parseSelect !== 'function') {
    return bad(name, `Plugin "${name}" has a "parseSelect" that is not a function.`);
  }
  if (mentions !== undefined && typeof mentions !== 'function') {
    return bad(name, `Plugin "${name}" has a "mentions" that is not a function.`);
  }
  if (names.has(name)) return bad(name, `Two plugins are named "${name}"; names must be unique.`);
  const schema = readMeta(meta, name);
  names.add(name);
  // read once: later calls never touch a getter of the user object again
  const snapshot = [...(patterns as string[])];
  return {
    name,
    apiVersion: 1,
    files: snapshot,
    ...(schema === undefined ? {} : { meta: { schema } }),
    extract: (input) => Reflect.apply(extract, entry, [input]) as ExtractResult,
    ...(parseSelect === undefined
      ? {}
      : {
          parseSelect: (raw: string) =>
            Reflect.apply(parseSelect, entry, [raw]) as ParseSelectResult,
        }),
    ...(validateSelect === undefined
      ? {}
      : {
          validateSelect: (select: Json) =>
            Reflect.apply(validateSelect, entry, [select]) as ValidateSelectResult,
        }),
    ...(mentions === undefined
      ? {}
      : {
          mentions: (input: MentionsInput) =>
            Reflect.apply(mentions, entry, [input]) as MentionsResult,
        }),
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

const MAX_MENTIONS = 100_000;

// SPEC §8.7 Mentions steps 1 to 4: what the Plugin that claims `doc` read from it, or null
export function readMentions(
  plugins: readonly DocstampPlugin[],
  doc: string,
  text: string,
): { readonly links: readonly string[]; readonly words: readonly string[] } | null {
  const claimed = plugins.filter((plugin) => plugin.mentions !== undefined && claims(plugin, doc));
  if (claimed.length === 0) return null;
  if (claimed.length > 1) {
    const names = claimed.map((plugin) => `"${plugin.name}"`).join(', ');
    const message = `Plugins ${names} all read the mentions of "${doc}"; narrow their "files" so one does.`;
    throw new Raised([diag('E_PLUGIN', { subject: doc, message })]);
  }
  const plugin = claimed[0]!;
  const fail = (why: string): never => {
    const message = `Plugin "${plugin.name}" ${why} for "${doc}".`;
    throw new Raised([diag('E_PLUGIN', { subject: doc, message })]);
  };
  let result: unknown;
  try {
    result = plugin.mentions!({ path: doc, text });
  } catch {
    return fail('threw in mentions');
  }
  let raw: { links: unknown; words: unknown };
  try {
    if (isObject(result) && typeof result['then'] === 'function') {
      try {
        (result as unknown as PromiseLike<unknown>).then(undefined, () => {});
      } catch {
        // the failure is reported below; nothing else to contain
      }
      return fail('returned a promise; mentions must be synchronous');
    }
    if (!isObject(result)) return fail('did not return { links, words } from mentions');
    raw = { links: result['links'], words: result['words'] };
  } catch (error) {
    if (error instanceof Raised) throw error;
    return fail('returned a value from mentions that could not be read');
  }
  const strings = (value: unknown): readonly string[] => {
    if (value === undefined) return [];
    if (
      !Array.isArray(value) ||
      value.length > MAX_MENTIONS ||
      !value.every((item) => typeof item === 'string' && item.isWellFormed())
    ) {
      return fail(`returned links or words that are not a list of at most ${MAX_MENTIONS} strings`);
    }
    return [...(value as string[])];
  };
  return { links: strings(raw.links), words: strings(raw.words) };
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
  readonly select: unknown;
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
    select: isObject(result) ? result['select'] : undefined,
  };
}

// SPEC §8.7 step 3: a plugin-defined, stable identifier of a Diagnostic
const isPluginCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(value);

// SPEC §8.7 steps 3 and 4: the Diagnostics a Plugin reported, as E_SELECT or W_SELECT
function readDiagnostics(
  reported: readonly unknown[],
  subject: string,
  file: string,
  fail: (why: string) => never,
): Diagnostic[] {
  return reported.map((item: unknown) => {
    if (
      !isObject(item) ||
      (item['severity'] !== 'error' && item['severity'] !== 'warning') ||
      !isOneLine(item['message'])
    ) {
      return fail('returned a diagnostic that is not { severity, message } of one line');
    }
    const pluginCode = item['code'];
    if (pluginCode !== undefined && !isPluginCode(pluginCode)) {
      return fail(
        'returned a diagnostic code that is not 1 to 64 of a-z, 0-9 and -, from a letter',
      );
    }
    const code = item['severity'] === 'error' ? 'E_SELECT' : 'W_SELECT';
    return diag(code, {
      file,
      subject,
      message: item['message'],
      ...(pluginCode === undefined ? {} : { pluginCode }),
    });
  });
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
    result = plugin.extract({ ...input, select: structuredClone(input.select) }); // §8.7 step 2
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
  const diagnostics = readDiagnostics(reported, subject, '', fail);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  if (errors.length > 0) throw new Raised([...errors, ...warnings]);
  if (checked.length === 0) {
    throw new Raised([diag('E_SELECT_NOT_FOUND', { subject }), ...warnings]);
  }
  return { parts: checked, warnings };
}

// SPEC §8.7 ValidateSelect: attached E_SELECT Diagnostics of one Selected Dependency, never raised
export function runValidateSelect(
  plugin: DocstampPlugin,
  file: string,
  entry: { readonly path: string; readonly select: Json },
): Diagnostic[] {
  const subject = `${entry.path}#${canonicalJson(entry.select)}`;
  const schema = plugin.meta?.schema;
  const failure = schema === undefined ? null : checkSelect(schema, entry.select);
  if (failure !== null) {
    const where = failure.pointer === '' ? 'the selector' : failure.pointer;
    const message = `Plugin "${plugin.name}" expects ${where} of "${entry.path}" to be ${failure.expected}.`;
    return [diag('E_SELECT', { file, subject, message })];
  }
  if (plugin.validateSelect === undefined) return [];
  const failed = (why: string): Diagnostic[] => [
    diag('E_SELECT', {
      file,
      subject,
      message: `Plugin "${plugin.name}" ${why} for "${entry.path}".`,
    }),
  ];
  let result: unknown;
  try {
    result = plugin.validateSelect(structuredClone(entry.select)); // §8.7 ValidateSelect step 1
  } catch {
    return failed('threw in validateSelect');
  }
  let raw: Raw;
  try {
    raw = readRaw(result);
  } catch {
    return failed('returned a value from validateSelect that could not be read');
  }
  if (raw.promised) {
    try {
      (result as PromiseLike<unknown>).then(undefined, () => {});
    } catch {
      // the failure is reported below; nothing else to contain
    }
    return failed('returned a promise; validateSelect must be synchronous');
  }
  const reported = raw.diagnostics === undefined ? [] : raw.diagnostics;
  if (!isObject(result)) return failed('did not return { diagnostics } from validateSelect');
  if (!Array.isArray(reported) || reported.length > MAX_DIAGNOSTICS) {
    return failed(`returned diagnostics that are not a list of at most ${MAX_DIAGNOSTICS}`);
  }
  try {
    const read = readDiagnostics(reported, subject, file, (why) => {
      throw new Raised(failed(why));
    });
    if (read.some((d) => d.severity === 'warning')) {
      return failed('returned a warning from validateSelect, which reports errors only');
    }
    return read;
  } catch (error) {
    if (error instanceof Raised) return [...error.diagnostics];
    throw error;
  }
}

// SPEC §8.7 ResolveSelector steps 2 to 4: the select a Plugin's parseSelect reads from a Raw
export function runParseSelect(
  plugin: DocstampPlugin,
  file: string,
  shorthand: { readonly path: string; readonly raw: string },
): { readonly select: Json } | { readonly problems: Diagnostic[] } {
  const subject = `${shorthand.path}:${shorthand.raw}`;
  const failed = (why: string) => ({
    problems: [
      diag('E_SELECT', {
        file,
        subject,
        message: `Plugin "${plugin.name}" ${why} for "${shorthand.path}".`,
      }),
    ],
  });
  if (plugin.parseSelect === undefined) return { select: shorthand.raw };
  let result: unknown;
  try {
    result = plugin.parseSelect(shorthand.raw);
  } catch {
    return failed('threw in parseSelect');
  }
  let raw: Raw;
  try {
    raw = readRaw(result);
  } catch {
    return failed('returned a value from parseSelect that could not be read');
  }
  if (raw.promised) {
    try {
      (result as PromiseLike<unknown>).then(undefined, () => {});
    } catch {
      // the failure is reported below; nothing else to contain
    }
    return failed('returned a promise; parseSelect must be synchronous');
  }
  if (!isObject(result)) return failed('did not return { select, diagnostics } from parseSelect');
  const reported = raw.diagnostics === undefined ? [] : raw.diagnostics;
  if (!Array.isArray(reported) || reported.length > MAX_DIAGNOSTICS) {
    return failed(`returned diagnostics that are not a list of at most ${MAX_DIAGNOSTICS}`);
  }
  try {
    const read = readDiagnostics(reported, subject, file, (why) => {
      throw new Raised(failed(why).problems);
    });
    if (read.some((d) => d.severity === 'warning')) {
      return failed('returned a warning from parseSelect, which reports errors only');
    }
    if (read.length > 0) return { problems: read };
  } catch (error) {
    if (error instanceof Raised) return { problems: [...error.diagnostics] };
    throw error;
  }
  if (raw.select === undefined) return failed('returned neither a select nor an error');
  const select = toPlainJson(raw.select);
  return select === undefined ? failed('returned a select that is not a plain value') : { select };
}
