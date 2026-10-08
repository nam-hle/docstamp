import { parseStrictYaml, type YamlMap, type YamlValue } from '../config/yaml-profile.ts';
import { diag } from '../core/diagnostics.ts';
import { unknownKeyMessage } from '../core/did-you-mean.ts';
import type { Declaration, Diagnostic } from '../core/types.ts';
import { parsePattern } from '../pattern/parse.ts';
import { hashOnLine, type Scan } from './frontmatter.ts';
import { BLOCK_KEYS, HASH } from './keys.ts';

// SPEC §9.6.2 step 2
export const MARKER_REST = /^[ \t]*(?:#.*)?\r?\n?$/u;
const isMap = (v: YamlValue | undefined): v is YamlMap =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ParsedBlock {
  declaration: Declaration;
  problems: Diagnostic[];
}

// SPEC §9.6.2
// `defaults`: the Configuration file names default Presets, so an empty `use` opts out of them
export function parseBlock(file: string, scan: Scan, defaults = false): ParsedBlock {
  const problems: Diagnostic[] = [];
  const block = (subject: string, message: string) =>
    problems.push(diag('E_BLOCK', { file, subject, message }));
  const done = (
    dependencies: readonly string[],
    recorded: string | null,
    use: readonly string[] | null = null,
  ): ParsedBlock => ({
    declaration: { file, dependencies, ...(use === null ? {} : { use }), inline: { recorded } },
    problems,
  });

  const rest = scan.lines[scan.marker]!.slice('docstamp:'.length);
  if (!MARKER_REST.test(rest)) {
    block('docstamp', 'Write the docstamp block as a block mapping, one key per line.');
    return done([], null);
  }
  const parsed = parseStrictYaml(scan.lines.slice(1, scan.close).join(''));
  if (parsed === null) {
    block(
      'frontmatter',
      'The frontmatter of a file with a docstamp block must be strict YAML ' +
        'with one docstamp key.',
    );
    return done([], null);
  }
  const top = parsed.value;
  const entry = isMap(top) ? top.entries.get('docstamp') : undefined;
  if (!entry || !isMap(entry.value)) {
    block('docstamp', 'The docstamp key must hold a mapping with "dependencies" and "hash".');
    return done([], null);
  }
  const keys = entry.value.entries;
  const unknown = [...keys.keys()].filter(
    (key) => !(BLOCK_KEYS as readonly string[]).includes(key),
  );
  for (const key of unknown) {
    const message = unknownKeyMessage(key, BLOCK_KEYS);
    problems.push(diag('E_UNKNOWN_KEY', { file, subject: key, ...(message ? { message } : {}) }));
  }

  const listed = keys.get('dependencies')?.value;
  const dependencies =
    Array.isArray(listed) && listed.length > 0 && listed.every((p) => typeof p === 'string')
      ? (listed as string[])
      : null;
  if (dependencies === null) {
    if (listed !== undefined || unknown.length === 0) {
      block('dependencies', 'The dependencies key must hold a non-empty list of patterns.');
    }
  } else {
    for (const pattern of dependencies) {
      if (!parsePattern(pattern)) problems.push(diag('E_PATTERN', { file, subject: pattern }));
    }
  }

  const used = keys.get('use')?.value;
  const use =
    Array.isArray(used) &&
    (used.length > 0 || defaults) &&
    used.every((name) => typeof name === 'string') &&
    new Set(used).size === used.length
      ? (used as string[])
      : null;
  if (used !== undefined && use === null) {
    const empty = Array.isArray(used) && used.length === 0;
    block(
      'use',
      empty
        ? 'An empty use opts out of default presets, and the configuration file names none ' +
            '("default-presets"): remove the use key.'
        : 'The use key must hold a non-empty list of distinct preset names.',
    );
  }

  const hashNode = keys.get('hash');
  const value = hashNode?.plainSource ?? hashNode?.value;
  const line = scan.hashLines.length === 1 ? scan.lines[scan.hashLines[0]!]! : null;
  const wellFormed =
    typeof value === 'string' &&
    HASH.test(value) &&
    line !== null &&
    hashOnLine(line, scan.keyIndent!) === value;
  if (value !== undefined && !wellFormed) {
    block('hash', 'Write the hash as "hash:" and 64 lowercase hex digits on one line.');
  }
  return done(dependencies ?? [], wellFormed ? (value as string) : null, use);
}
