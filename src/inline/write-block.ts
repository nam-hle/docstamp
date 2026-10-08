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

const INDENTED = /^( +)[^ \t\r\n]/u;

// SPEC §9.6.5 step 3: the indent the frontmatter already uses, else two spaces
function frontmatterIndent(lines: readonly string[]): string {
  for (const line of lines) {
    const match = INDENTED.exec(line);
    if (match) return match[1]!;
  }
  return '  ';
}

const ITEM = /^( *)- /u;
const leading = (line: string): number => /^ */u.exec(line)![0].length;

// SPEC §9.6.5 step 2.4: the last item line of the block list under `dependencies:`
function lastItem(
  lines: readonly string[],
  from: number,
  to: number,
  keyIndent: string,
): { index: number; indent: string } | null {
  const key = lines
    .slice(from, to + 1)
    .findIndex(
      (line) =>
        line.startsWith(`${keyIndent}dependencies:`) &&
        MARKER_REST.test(line.slice(`${keyIndent}dependencies:`.length)),
    );
  if (key === -1) return null;
  let indent: string | null = null;
  let last: number | null = null;
  for (let index = from + key + 1; index <= to; index++) {
    const line = lines[index]!;
    if (MARKER_REST.test(line)) continue;
    const match = ITEM.exec(line);
    if (indent === null) {
      if (match === null) return null;
      indent = match[1]!;
    }
    if ((match !== null && match[1] === indent) || leading(line) > indent.length) last = index;
    else break;
  }
  return indent === null || last === null ? null : { index: last, indent };
}

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
    const parsed = parseBlock(file, scan);
    const declared = parsed.declaration.dependencies;
    if (!declared.every((pattern, index) => dependencies[index] === pattern)) {
      throw refuse(`${file} declares patterns the proposal does not keep; edit it by hand.`);
    }
    if (declared.length > 0 && dependencies.length === declared.length) return text;
    const lines = [...scan.lines];
    const last =
      declared.length > 0 && parsed.problems.length === 0
        ? lastItem(scan.lines, scan.marker + 1, scan.last, keyIndent ?? '')
        : null;
    if (last !== null) {
      // §9.6.5 step 2.4: the block keeps every line and gains the patterns after declared
      const added = dependencies
        .slice(declared.length)
        .map((pattern) => `${last.indent}- ${item(pattern)}${eolOf(lines[last.index]!)}`);
      lines.splice(last.index + 1, 0, ...added);
    } else {
      // §9.6.5 step 2.5
      const usesPresets =
        keyIndent !== null &&
        scan.lines
          .slice(scan.marker + 1, scan.last + 1)
          .some((line) => line.startsWith(`${keyIndent}use:`));
      if (usesPresets) {
        throw refuse(`${file} has a docstamp block that uses presets; edit it by hand.`);
      }
      const replaced = body(dependencies, keyIndent ?? '  ', eolOf(marker));
      lines.splice(scan.marker + 1, scan.last - scan.marker, ...replaced);
    }
    result = scan.bom + lines.join('');
  } else {
    const split = splitFrontmatter(text);
    if (split !== null) {
      const eol = eolOf(split.lines[0]!);
      const lines = [...split.lines];
      const indent = frontmatterIndent(split.lines.slice(1, split.close));
      lines.splice(split.close, 0, `docstamp:${eol}`, ...body(dependencies, indent, eol));
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
