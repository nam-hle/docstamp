import type { Declaration, Diagnostic, Json, SelectedEntry, Shorthand } from '../core/types.ts';
import { literalPath, parsePattern } from '../pattern/parse.ts';
import { splitDependency } from '../pattern/split.ts';
import { claim, runParseSelect } from '../plugin/plugins.ts';
import type { DocstampPlugin } from '../plugin/types.ts';
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

// SPEC §8.7 ResolveSelector
export function resolveSelector(
  plugins: readonly DocstampPlugin[],
  file: string,
  shorthand: Shorthand,
): { select: Json } | { problems: Diagnostic[] } {
  let plugin: DocstampPlugin;
  try {
    plugin = claim(plugins, shorthand.path);
  } catch {
    return { select: shorthand.raw };
  }
  return runParseSelect(plugin, file, shorthand);
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
    const result = resolveSelector(plugins, declaration.file, shorthand);
    if ('problems' in result) {
      problems.push(...result.problems);
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
