import { Raised, diag } from '../core/diagnostics.ts';
import { quote } from '../core/quote.ts';
import { MARKER_REST, parseBlock } from './block.ts';
import { scanFrontmatter, splitFrontmatter } from './frontmatter.ts';

const PLAIN = /^(?:[A-Za-z_]|\.[A-Za-z_])[A-Za-z0-9_./@+=*?[\]{},-]*$/u;
const RESERVED = /^(?:true|false|null|y|n|yes|no|on|off|\.inf|\.nan)$/iu;
const eolOf = (line: string): string => (line.endsWith('\r\n') ? '\r\n' : '\n');

// SPEC §9.6.5 step 1
const item = (pattern: string): string =>
  PLAIN.test(pattern) && !RESERVED.test(pattern) ? pattern : quote(pattern);

const body = (dependencies: readonly string[], indent: string, eol: string): string[] => [
  `${indent}dependencies:${eol}`,
  ...dependencies.map((pattern) => `${indent}  - ${item(pattern)}${eol}`),
];

// SPEC §9.6.5
export function writeBlock(file: string, text: string, dependencies: readonly string[]): string {
  const refuse = (message: string) => new Raised([diag('E_USAGE', { subject: file, message })]);
  const scan = scanFrontmatter(text);
  let result: string;
  if (scan !== null) {
    if (scan.hashLines.length > 0) {
      throw refuse(`${file} records a hash; edit its docstamp block by hand.`);
    }
    const marker = scan.lines[scan.marker]!;
    if (!MARKER_REST.test(marker.slice('docstamp:'.length))) {
      throw refuse(`${file} has a docstamp block that is not a block mapping; edit it by hand.`);
    }
    const { keyIndent } = scan;
    const usesPresets =
      keyIndent !== null &&
      scan.lines
        .slice(scan.marker + 1, scan.last + 1)
        .some((line) => line.startsWith(`${keyIndent}use:`));
    if (usesPresets) {
      throw refuse(`${file} has a docstamp block that uses presets; edit it by hand.`);
    }
    const lines = [...scan.lines];
    const replaced = body(dependencies, scan.keyIndent ?? '  ', eolOf(marker));
    lines.splice(scan.marker + 1, scan.last - scan.marker, ...replaced);
    result = scan.bom + lines.join('');
  } else {
    const split = splitFrontmatter(text);
    if (split !== null) {
      const eol = eolOf(split.lines[0]!);
      const lines = [...split.lines];
      lines.splice(split.close, 0, `docstamp:${eol}`, ...body(dependencies, '  ', eol));
      result = split.bom + lines.join('');
    } else {
      const bom = text.startsWith('﻿') ? '﻿' : '';
      const rest = text.slice(bom.length);
      const eol = /^[^\n]*\r\n/u.test(rest) ? '\r\n' : '\n';
      const block = body(dependencies, '  ', eol).join('');
      result = `${bom}---${eol}docstamp:${eol}${block}---${eol}${rest}`;
    }
  }
  const check = scanFrontmatter(result);
  const parsed = check === null ? null : parseBlock(file, check);
  const same =
    parsed !== null &&
    parsed.problems.length === 0 &&
    parsed.declaration.dependencies.length === dependencies.length &&
    parsed.declaration.dependencies.every((pattern, index) => pattern === dependencies[index]);
  if (!same) {
    throw refuse(`${file} has frontmatter that cannot be extended safely; edit it by hand.`);
  }
  return result;
}
