import { createHash } from 'node:crypto';
import type { DocstampPlugin, ExtractInput } from 'docstamp';

import { declarations, groups } from './declarations.ts';
import { parseFile } from './parse.ts';
import { parseSelector } from './selector.ts';
import { shapeOf, sourceOf } from './shape.ts';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

// SPEC §8
function extract({ path, text, select }: ExtractInput): { hashes: string[] } {
  const selector = parseSelector(select);
  const { source, statements } = parseFile(path, text);
  const hashes = groups(declarations(statements))
    .filter((group) => group.name === selector.name)
    .filter((group) => selector.kind === undefined || group.kind === selector.kind)
    .map((group) =>
      sha256(selector.part === 'source' ? sourceOf(source, group) : shapeOf(source, group)),
    );
  return { hashes };
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
