import type {
  DocstampPlugin,
  ExtractInput,
  ExtractResult,
  Json,
  JsonSchema,
  Part,
  ValidateSelectResult,
} from 'docstamp';

import { declarations, groups } from './declarations.ts';
import { parseFile } from './parse.ts';
import { parseSelect } from './parse-select.ts';
import { parseSelector, type Selector } from './selector.ts';
import { shapeOf, sourceOf } from './shape.ts';

const lineAt = (source: string, offset: number): number =>
  source.slice(0, offset).split('\n').length;

const problem = (code: string, message: string): ExtractResult => ({
  diagnostics: [{ severity: 'error', code, message }],
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
    return problem('invalid-selector', BAD_SELECTOR);
  }
  let parsed: ReturnType<typeof parseFile>;
  try {
    parsed = parseFile(path, text);
  } catch {
    return problem(
      'unparsable-file',
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
      'ambiguous-name',
      `The name "${selector.name}" matches ${found.length} declarations (${where}); ` +
        'add a kind to the selector, or rename one of them.',
    );
  }
  return { parts: [found[0]!.part] };
}

// SPEC §8.1
function validateSelect(select: Json): ValidateSelectResult {
  try {
    parseSelector(select);
    return {};
  } catch {
    return problem('invalid-selector', BAD_SELECTOR);
  }
}

// SPEC §3: the shape of a select, checked by docstamp before ValidateSelect
const schema: JsonSchema = {
  type: ['string', 'object'],
  minLength: 1,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1 },
    kind: {
      enum: ['function', 'class', 'interface', 'type', 'enum', 'variable', 'namespace'],
    },
    part: { enum: ['shape', 'source'] },
  },
  additionalProperties: false,
};

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
  validateSelect,
  parseSelect,
  meta: { schema },
} satisfies DocstampPlugin;

export default plugin;
