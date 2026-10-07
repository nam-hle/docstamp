import { readFileSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import type { Declaration, Diagnostic } from '../core/types.ts';
import { isBinary } from '../hash/hash.ts';
import { select } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';
import type { Universe } from '../universe/walk.ts';
import { parseBlock } from './block.ts';
import { scanFrontmatter, stampText } from './frontmatter.ts';

export interface InlineRead {
  declarations: Declaration[];
  attached: Diagnostic[];
  marked: Map<string, readonly number[]>;
}

const onDisk = (root: string, universe: Universe, file: string) =>
  join(root, universe.onDisk.get(file) ?? file);

function textOf(path: string): string | null {
  const bytes = readFileSync(path);
  if (isBinary(bytes)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

// SPEC §9.6.3
export function readInline(
  root: string,
  universe: Universe,
  include: readonly string[],
): InlineRead {
  const patterns = include.map((source) => parsePattern(source) as ParsedPattern);
  const candidates = select(
    patterns,
    universe.paths.filter((path) => universe.kinds.get(path) === 'file'),
  );
  const read: InlineRead = { declarations: [], attached: [], marked: new Map() };
  const fatal: Diagnostic[] = [];
  for (const file of candidates) {
    let text: string | null;
    try {
      text = textOf(onDisk(root, universe, file));
    } catch {
      fatal.push(diag('E_UNREADABLE', { subject: file }));
      continue;
    }
    const scan = text === null ? null : scanFrontmatter(text);
    if (scan === null) continue;
    read.marked.set(file, scan.hashLines);
    const { declaration, problems } = parseBlock(file, scan);
    read.declarations.push(declaration);
    read.attached.push(...problems);
  }
  if (fatal.length > 0) throw new Raised(fatal);
  return read;
}

// SPEC §9.6.4
export function stampFile(root: string, universe: Universe, file: string, hash: string): void {
  const path = onDisk(root, universe, file);
  const temp = `${path}.tmp-${process.pid}`;
  try {
    const scan = scanFrontmatter(textOf(path)!)!;
    writeFileSync(temp, stampText(scan, hash), 'utf8');
    chmodSync(temp, statSync(path).mode);
    renameSync(temp, path);
  } catch {
    rmSync(temp, { force: true });
    throw new Raised([
      diag('E_UNREADABLE', {
        subject: file,
        message: `Cannot write ${file}; fix the permissions or remove the obstruction.`,
      }),
    ]);
  }
}
