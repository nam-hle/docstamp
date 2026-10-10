import { parseAllDocuments } from 'yaml';

import type { Json } from '../core/types.ts';
import { canonicalJson } from './canonical.ts';
import type { DocstampPlugin, ExtractInput, ExtractResult } from './types.ts';

type Step = string;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// SPEC §8.8: a name is one or more characters other than `.`, `[` and `]`; a bracket holds a
// JSON String
function parseValuePath(select: unknown): Step[] {
  const fail = (): never => {
    throw new Error('not a Value Path');
  };
  if (typeof select !== 'string') return fail();
  const steps: Step[] = [];
  let at = 0;
  while (at < select.length) {
    if (select[at] === '[') {
      const end = bracketEnd(select, at);
      const key: unknown = end < 0 ? undefined : JSON.parse(select.slice(at + 1, end));
      if (typeof key !== 'string') return fail();
      steps.push(key);
      at = end + 1;
      continue;
    }
    if (steps.length > 0) {
      if (select[at] !== '.') return fail();
      at += 1;
    }
    const start = at;
    while (at < select.length && !'.[]'.includes(select[at]!)) at += 1;
    if (at === start) return fail();
    steps.push(select.slice(start, at));
  }
  return steps.length > 0 ? steps : fail();
}

// the index of the `]` that closes the bracket opened at `open`, whose content is a JSON String
function bracketEnd(text: string, open: number): number {
  if (text[open + 1] !== '"') return -1;
  let at = open + 2;
  while (at < text.length && text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
  return text[at + 1] === ']' ? at + 1 : -1;
}

const INDEX = /^(0|[1-9][0-9]*)$/u;

// SPEC §8.8 step 2
function walk(root: unknown, steps: readonly Step[]): { found: boolean; value?: unknown } {
  let value = root;
  for (const step of steps) {
    if (Array.isArray(value) && INDEX.test(step) && Number(step) < value.length) {
      value = value[Number(step)];
    } else if (isPlainObject(value) && Object.hasOwn(value, step)) {
      value = value[step];
    } else {
      return { found: false };
    }
  }
  return { found: true, value };
}

// SPEC §8.8 step 3
function toJson(value: unknown): Json {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toJson);
  if (isPlainObject(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, toJson(member)]));
  }
  throw new Error('not a plain value');
}

// SPEC §8.8: the type of the value, in words
const typeName = (value: Json): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  return typeof value === 'object' ? 'object' : typeof value;
};

const problem = (message: string): ExtractResult => ({
  diagnostics: [{ severity: 'error', message }],
});

function extractFrom(format: string, parse: (text: string) => unknown) {
  return ({ text, select }: ExtractInput): ExtractResult => {
    let steps: Step[];
    try {
      steps = parseValuePath(select);
    } catch {
      return problem(
        'The selector is not a Value Path; write steps such as scripts.build, items.0.name or ["a.b"].c.',
      );
    }
    let parsed: unknown;
    try {
      parsed = parse(text);
    } catch {
      return problem(`The file is not one valid ${format} document; fix the file.`);
    }
    const found = walk(parsed, steps);
    if (!found.found) return {};
    let value: Json;
    try {
      value = toJson(found.value);
    } catch {
      return problem(
        'The value is not plain data (finite numbers, strings, booleans, null, lists and maps); select another value.',
      );
    }
    return {
      parts: [{ content: canonicalJson(value), focus: `${select as string} (${typeName(value)})` }],
    };
  };
}

function parseYaml(text: string): unknown {
  const documents = parseAllDocuments(text);
  if (documents.length > 1) throw new Error('more than one document');
  const [document] = documents;
  if (document === undefined) return null;
  if (document.errors.length > 0 || document.warnings.length > 0) throw new Error('invalid YAML');
  return document.toJS();
}

// SPEC §8.8
export const builtinPlugins: readonly DocstampPlugin[] = [
  {
    name: 'docstamp-json',
    apiVersion: 1,
    files: ['**/*.json'],
    extract: extractFrom('JSON', (text) => JSON.parse(text)),
  },
  {
    name: 'docstamp-yaml',
    apiVersion: 1,
    files: ['**/*.yaml', '**/*.yml'],
    extract: extractFrom('YAML', parseYaml),
  },
];
