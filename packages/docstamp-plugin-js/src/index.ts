import type { DocstampPlugin, ExtractInput, ExtractResult, Part } from 'docstamp';

import { declarations, groups } from './declarations.ts';
import { parseFile } from './parse.ts';
import { parseSelector, type Selector } from './selector.ts';
import { shapeOf, sourceOf } from './shape.ts';

const lineAt = (source: string, offset: number): number =>
  source.slice(0, offset).split('\n').length;

const problem = (message: string): ExtractResult => ({
  diagnostics: [{ severity: 'error', message }],
});

const BAD_SELECTOR =
  'The selector is not valid for declarations; write a name, such as createUser, or ' +
  '{ name, kind, part } with kind one of function, class, interface, type, enum, variable, ' +
  'namespace and part shape or source.';

// SPEC §8
function extract({ path, text, select }: ExtractInput): ExtractResult {
  let selector: Selector;
  try {
    selector = parseSelector(select);
  } catch {
    return problem(BAD_SELECTOR);
  }
  let parsed: ReturnType<typeof parseFile>;
  try {
    parsed = parseFile(path, text);
  } catch {
    return problem(
      `The file ${path} could not be parsed as JavaScript or TypeScript; fix its syntax.`,
    );
  }
  const { source, statements } = parsed;
  const found = groups(declarations(statements))
    .filter((group) => group.name === selector.name)
    .filter((group) => selector.kind === undefined || group.kind === selector.kind)
    .map((group) => {
      const first = group.declarations[0]!.statement;
      const last = group.declarations.at(-1)!.statement;
      const part: Part = {
        content: selector.part === 'source' ? sourceOf(source, group) : shapeOf(source, group),
        focus: `${group.kind} ${group.name} (${selector.part})`,
        lines: { start: lineAt(source, first.start!), end: lineAt(source, last.end! - 1) },
      };
      return { part, kind: group.kind };
    });
  if (found.length === 0) return {};
  if (found.length > 1) {
    const where = found.map(({ part, kind }) => `${kind} at line ${part.lines!.start}`).join(', ');
    return problem(
      `The name "${selector.name}" matches ${found.length} declarations (${where}); ` +
        'add a kind to the selector, or rename one of them.',
    );
  }
  return { parts: [found[0]!.part] };
}

// SPEC §3
const plugin = {
  name: 'docstamp-plugin-js',
  apiVersion: 1,
  files: [
    '**/*.js',
    '**/*.mjs',
    '**/*.cjs',
    '**/*.jsx',
    '**/*.ts',
    '**/*.mts',
    '**/*.cts',
    '**/*.tsx',
  ],
  extract,
} satisfies DocstampPlugin;

export default plugin;
