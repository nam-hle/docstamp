// SPEC §5.6: lexical scan of a file's frontmatter for its docstamp block
export interface Scan {
  readonly bom: string;
  readonly lines: readonly string[];
  readonly close: number;
  readonly marker: number;
  readonly last: number;
  readonly keyIndent: string | null;
  readonly hashLines: readonly number[];
}

const BOM = '\uFEFF';
const MARKER = /^docstamp:(?:[ \t]|\r?\n|$)/u;
const BLANK = /^[ \t]*\r?\n?$/u;
const indentOf = (line: string): string => /^[ \t]*/u.exec(line)![0];
const bare = (line: string): string => line.replace(/\r?\n$/u, '').replace(/[ \t]+$/u, '');

const splitLines = (text: string): string[] => text.split(/(?<=\n)/u);

// SPEC §5.6 ScanFrontmatter steps 1 to 3: the delimiters, whether or not there is a block
export function splitFrontmatter(
  text: string,
): { bom: string; lines: string[]; close: number } | null {
  const bom = text.startsWith(BOM) ? BOM : '';
  const lines = splitLines(text.slice(bom.length));
  if (lines[0] === undefined || bare(lines[0]) !== '---') return null;
  const close = lines.findIndex((line, index) => index > 0 && bare(line) === '---');
  return close === -1 ? null : { bom, lines, close };
}

// SPEC §5.6 ScanFrontmatter
export function scanFrontmatter(text: string): Scan | null {
  const split = splitFrontmatter(text);
  if (split === null) return null;
  const { bom, lines, close } = split;
  const marker = lines.findIndex((line, index) => index > 0 && index < close && MARKER.test(line));
  if (marker === -1) return null;
  const unindented = lines.findIndex(
    (line, index) => index > marker && index < close && !BLANK.test(line) && indentOf(line) === '',
  );
  const end = unindented === -1 ? close : unindented;
  const last = lines.findLastIndex((line, index) => index <= end - 1 && !BLANK.test(line));
  const keyed = lines.findIndex(
    (line, index) =>
      index > marker &&
      index < end &&
      !BLANK.test(line) &&
      !line.slice(indentOf(line).length).startsWith('#'),
  );
  const keyIndent = keyed === -1 ? null : indentOf(lines[keyed]!);
  const hashLines = lines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line, index }) =>
        keyIndent !== null &&
        index > marker &&
        index < end &&
        indentOf(line) === keyIndent &&
        line.slice(keyIndent.length).startsWith('hash:'),
    )
    .map(({ index }) => index);
  return { bom, lines, close, marker, last, keyIndent, hashLines };
}

const HASH_VALUE = /^(hash:[ \t]+)([0-9a-f]{64})([ \t]*(?:#.*)?\r?\n?)$/u;

// SPEC §9.6.2 step 7: the recorded value when the line is `hash: <64 hex>`, else null
export function hashOnLine(line: string, keyIndent: string): string | null {
  const match = HASH_VALUE.exec(line.slice(keyIndent.length));
  return match ? match[2]! : null;
}

// SPEC §12.3: the recorded Hash of a text, null when it has none or none that is well formed
export function recordedHash(text: string): string | null {
  const scan = scanFrontmatter(text);
  if (scan === null || scan.keyIndent === null || scan.hashLines.length !== 1) return null;
  return hashOnLine(scan.lines[scan.hashLines[0]!]!, scan.keyIndent);
}

// SPEC §9.6.4 Stamping
export function stampText(scan: Scan, hash: string): string {
  const lines = [...scan.lines];
  const only = scan.hashLines.length === 1 ? scan.hashLines[0] : undefined;
  if (only !== undefined) {
    const line = lines[only]!;
    const match = HASH_VALUE.exec(line.slice(scan.keyIndent!.length))!;
    lines[only] = `${scan.keyIndent}${match[1]}${hash}${match[3]}`;
  } else {
    const eol = lines[scan.last]!.endsWith('\r\n') ? '\r\n' : '\n';
    lines.splice(scan.last + 1, 0, `${scan.keyIndent}hash: ${hash}${eol}`);
  }
  return scan.bom + lines.join('');
}
