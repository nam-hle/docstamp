import { parseStrictYaml, type YamlMap, type YamlValue } from '../config/yaml-profile.ts';
import { diag } from '../core/diagnostics.ts';
import type { Declaration, Diagnostic } from '../core/types.ts';
import { parsePattern } from '../pattern/parse.ts';
import { hashOnLine, type Scan } from './frontmatter.ts';

const MARKER_REST = /^[ \t]*(?:#.*)?\r?\n?$/u;
const HASH = /^[0-9a-f]{64}$/u;
const isMap = (v: YamlValue | undefined): v is YamlMap =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ParsedBlock {
  declaration: Declaration;
  problems: Diagnostic[];
}

// SPEC §9.6.2
export function parseBlock(file: string, scan: Scan): ParsedBlock {
  const problems: Diagnostic[] = [];
  const block = (subject: string, message: string) =>
    problems.push(diag('E_BLOCK', { file, subject, message }));
  const done = (dependencies: readonly string[], recorded: string | null): ParsedBlock => ({
    declaration: { file, dependencies, inline: { recorded } },
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
  for (const key of keys.keys()) {
    if (key !== 'dependencies' && key !== 'hash') {
      problems.push(diag('E_UNKNOWN_KEY', { file, subject: key }));
    }
  }

  const listed = keys.get('dependencies')?.value;
  const dependencies =
    Array.isArray(listed) && listed.length > 0 && listed.every((p) => typeof p === 'string')
      ? (listed as string[])
      : null;
  if (dependencies === null) {
    block('dependencies', 'The dependencies key must hold a non-empty list of patterns.');
  } else {
    for (const pattern of dependencies) {
      if (!parsePattern(pattern)) problems.push(diag('E_PATTERN', { file, subject: pattern }));
    }
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
  return done(dependencies ?? [], wellFormed ? (value as string) : null);
}
