import { createHash } from 'node:crypto';
import type { DocstampPlugin, ExtractInput, ExtractResult } from 'docstamp';

import { declarations, groups } from './declarations.ts';
import { parseFile } from './parse.ts';
import { parseSelector } from './selector.ts';
import { shapeOf, sourceOf } from './shape.ts';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const lineAt = (source: string, offset: number): number =>
  source.slice(0, offset).split('\n').length;

// SPEC §8
function extract({ path, text, select }: ExtractInput): ExtractResult {
  const selector = parseSelector(select);
  const { source, statements } = parseFile(path, text);
  const found = groups(declarations(statements))
    .filter((group) => group.name === selector.name)
    .filter((group) => selector.kind === undefined || group.kind === selector.kind)
    .map((group) => {
      const first = group.declarations[0]!.statement;
      const last = group.declarations.at(-1)!.statement;
      return {
        hash: sha256(selector.part === 'source' ? sourceOf(source, group) : shapeOf(source, group)),
        focus: `${group.kind} ${group.name} (${selector.part})`,
        lines: { start: lineAt(source, first.start!), end: lineAt(source, last.end! - 1) },
      };
    });
  return {
    hashes: found.map((part) => part.hash),
    ...(found.length === 0
      ? {}
      : { focus: found.map((part) => part.focus), lines: found.map((part) => part.lines) }),
  };
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
