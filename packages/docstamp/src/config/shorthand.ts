import { diag } from '../core/diagnostics.ts';
import type { Declaration, Diagnostic, Json, SelectedEntry, Shorthand } from '../core/types.ts';
import { literalPath, parsePattern } from '../pattern/parse.ts';
import { splitDependency } from '../pattern/split.ts';
import { claim } from '../plugin/plugins.ts';
import type { DocstampPlugin, FieldType } from '../plugin/types.ts';
import { dedupeSelected } from './selected.ts';

const SHORTHAND_PATH_MESSAGE =
  'A selected dependency written path:selector needs a literal file path before the first ":": ' +
  'escape a glob character of the name with "\\" (as in "a\\*b.md") and a ":" of the name as "\\:".';

// SPEC §8.7 ParseShorthand: a Shorthand, or the message of the E_CONFIG / E_BLOCK it raises
export function parseShorthand(text: string): Shorthand | string {
  const split = splitDependency(text)!;
  if (split.path === '') return 'The path before the first ":" is empty.';
  if (split.raw === '') return `The selector after the first ":" of "${text}" is empty.`;
  const parsed = parsePattern(split.path);
  const denoted = parsed === null || parsed.negated ? null : literalPath(parsed);
  return denoted === null ? SHORTHAND_PATH_MESSAGE : { path: denoted, raw: split.raw };
}

// SPEC §8.7 ResolveSelector step 2: positions of `separator` outside an escape of `,`, `=` or `\`
function unescapedAt(text: string, separator: string): number[] {
  const found: number[] = [];
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '\\' && ',=\\'.includes(text[at + 1] ?? '')) at += 1;
    else if (text[at] === separator) found.push(at);
  }
  return found;
}

const unescape = (text: string): string => text.replace(/\\([,=\\])/gu, '$1');

const INTEGER = /^(0|-?[1-9][0-9]{0,14})$/u;

const HINT = ' A literal "=" or "," in a bare value is written "\\=" or "\\,".';

type Typed = { value: Json } | { message: string };

function typed(key: string, value: string, type: FieldType | undefined): Typed {
  if (type === undefined || type === 'string') return { value };
  if (type === 'integer') {
    return INTEGER.test(value)
      ? { value: Number(value) }
      : { message: `"${key}" is an integer: write ${key}=2, not ${key}=${value}.${HINT}` };
  }
  return type.includes(value)
    ? { value }
    : { message: `"${key}" is one of ${type.join(', ')}, not "${value}".${HINT}` };
}

// SPEC §8.7 ResolveSelector step 4
function pairs(
  items: readonly string[],
  fields: Readonly<Record<string, FieldType>>,
): { select: Json } | { message: string } {
  const map: Record<string, Json> = {};
  for (const item of items) {
    const [at] = unescapedAt(item, '=');
    if (at === undefined) {
      return {
        message: `"${unescape(item)}" is not key=value; a bare value is the whole selector, so escape a "," in it as "\\,".`,
      };
    }
    const key = unescape(item.slice(0, at));
    if (key === '') return { message: `"${unescape(item)}" has no key before "=".` };
    if (Object.hasOwn(map, key)) return { message: `The key "${key}" is written twice.` };
    if (!Object.hasOwn(fields, key)) {
      const known = Object.keys(fields).join(', ');
      return { message: `"${key}" is not a field of this plugin (${known}).${HINT}` };
    }
    const result = typed(
      key,
      unescape(item.slice(at + 1)),
      Object.hasOwn(fields, key) ? fields[key] : undefined,
    );
    if ('message' in result) return result;
    map[key] = result.value;
  }
  return { select: map };
}

// SPEC §8.7 ResolveSelector
export function resolveSelector(
  plugins: readonly DocstampPlugin[],
  shorthand: Shorthand,
): { select: Json } | { message: string } {
  let selectorFields;
  try {
    selectorFields = claim(plugins, shorthand.path).selectorFields;
  } catch {
    return { select: shorthand.raw };
  }
  if (selectorFields === undefined) return { select: shorthand.raw };
  const cuts = unescapedAt(shorthand.raw, ',');
  const items = [-1, ...cuts].map((cut, index) =>
    shorthand.raw.slice(cut + 1, cuts[index] ?? shorthand.raw.length),
  );
  const empty = items.find((item) => item === '');
  if (empty !== undefined) {
    return { message: `The selector "${shorthand.raw}" has an empty item.` };
  }
  const [only] = items;
  if (items.length === 1 && unescapedAt(only!, '=').length === 0) {
    return { select: unescape(only!) };
  }
  return pairs(items, selectorFields.fields);
}

// SPEC §12.2 step 5: the Shorthands of a Declaration become Selected Dependencies
export function resolveShorthands(
  declaration: Declaration,
  plugins: readonly DocstampPlugin[],
): { declaration: Declaration; problems: Diagnostic[] } {
  const { shorthands = [], ...rest } = declaration;
  const resolved: SelectedEntry[] = [];
  const problems: Diagnostic[] = [];
  for (const shorthand of shorthands) {
    const result = resolveSelector(plugins, shorthand);
    if ('message' in result) {
      const subject = `${shorthand.path}:${shorthand.raw}`;
      problems.push(diag('E_SELECT', { file: declaration.file, subject, message: result.message }));
    } else {
      resolved.push({
        path: shorthand.path,
        select: result.select,
        written: `${shorthand.path}:${shorthand.raw}`,
      });
    }
  }
  const selected = dedupeSelected([...(declaration.selected ?? []), ...resolved]);
  return { declaration: { ...rest, ...(selected.length > 0 ? { selected } : {}) }, problems };
}
