import { sortDiagnostics } from '../core/diagnostics.ts';
import type { Diagnostic } from '../core/types.ts';
import type { Status } from '../engine/suggest.ts';
import { diagJson, obj, render, type Json } from './json.ts';
import { shown } from './text.ts';

// SPEC §14.5, §14.9: the rate is an integer of ten-thousandths, or null when it cannot be told
interface SuggestRow {
  readonly pattern: string;
  readonly resolvedCount: number;
  readonly staleRate: number | null;
  // SPEC §13.10 step 4: null when the file has no declaration
  readonly status: Status | null;
}

export interface SuggestEntry {
  readonly file: string;
  readonly suggestions: readonly SuggestRow[];
  readonly ignored: readonly string[];
  // SPEC §13.10 step 4: null when the file has no declaration
  readonly declared: readonly string[] | null;
  readonly written?: boolean;
}

const excludes = (row: SuggestRow): boolean => row.pattern.startsWith('!');
const fixed4 = (tenThousandths: number): string =>
  `${Math.floor(tenThousandths / 10000)}.${String(tenThousandths % 10000).padStart(4, '0')}`;

// SPEC §14.9
function table(rows: readonly SuggestRow[], declared: readonly string[] | null): string[] {
  const cells = rows.map((row) => [
    shown(row.pattern),
    excludes(row) ? `-${row.resolvedCount}` : String(row.resolvedCount),
    excludes(row) ? '' : row.staleRate === null ? 'n/a' : fixed4(row.staleRate),
    ...(declared === null ? [] : [row.status ?? 'new']),
  ]);
  const header = ['pattern', 'files', 'stale', ...(declared === null ? [] : ['status'])];
  const all = [header, ...cells];
  const widths = header.map((_, c) => Math.max(...all.map((row) => row[c]!.length)));
  const leftAligned = (c: number) => c === 0 || c === 3;
  return all.map((row) =>
    `  ${row.map((cell, c) => (leftAligned(c) ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join('  ')}`.trimEnd(),
  );
}

// SPEC §14.9: the declared patterns that no Suggestion has
function onlyDeclared(entry: SuggestEntry): string[] {
  const proposed = new Set(entry.suggestions.map((row) => row.pattern));
  return [...new Set(entry.declared ?? [])].filter((pattern) => !proposed.has(pattern));
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

// SPEC §14.9: the first `limit` rows over the blocks; 0 keeps every row
function paged(
  entries: readonly SuggestEntry[],
  limit: number,
): { kept: SuggestEntry[]; closing: string } {
  const total = entries.reduce((sum, entry) => sum + entry.suggestions.length, 0);
  if (limit === 0 || total <= limit) return { kept: [...entries], closing: '' };
  let budget = limit;
  const kept: SuggestEntry[] = [];
  for (const entry of entries) {
    if (budget === 0) break;
    kept.push({ ...entry, suggestions: entry.suggestions.slice(0, budget) });
    budget -= Math.min(budget, entry.suggestions.length);
  }
  const files = count(entries.length - kept.length, 'more file');
  const where = kept.length === entries.length ? '' : ` in ${files}`;
  const more = count(total - limit, 'more suggestion');
  return { kept, closing: `... and ${more}${where}. Fix these, then run again.\n` };
}

export function suggestText(
  everyEntry: readonly SuggestEntry[],
  write: boolean,
  all = false,
  limit = 0,
): string {
  const { kept: entries, closing } = all
    ? paged(everyEntry, limit)
    : { kept: everyEntry, closing: '' };
  let out = '';
  for (const entry of entries) {
    out += `suggest ${shown(entry.file)}\n`;
    if (entry.suggestions.length === 0) out += '  no paths found\n';
    else
      out += table(entry.suggestions, entry.declared)
        .map((line) => `${line}\n`)
        .join('');
    if (all) continue;
    for (const path of entry.ignored) out += `  ignored  ${shown(path)}\n`;
    for (const pattern of onlyDeclared(entry)) out += `  only declared  ${shown(pattern)}\n`;
  }
  if (write) {
    for (const entry of entries) {
      out += `${entry.written === true ? 'written  ' : 'unchanged  '}${shown(entry.file)}\n`;
    }
  }
  return out + closing;
}

export interface SuggestJsonDoc {
  exitCode: number;
  write: boolean;
  all?: boolean;
  files: readonly SuggestEntry[];
  diagnostics: readonly Diagnostic[];
}

export function suggestJsonText(doc: SuggestJsonDoc): string {
  const files = doc.files.map((entry) => {
    const members: Array<[string, Json]> = [
      ['file', entry.file],
      [
        'suggestions',
        entry.suggestions.map((row) =>
          obj([
            ['pattern', row.pattern],
            ['resolvedCount', row.resolvedCount],
            ['staleRate', row.staleRate === null ? null : row.staleRate / 10000],
            ['status', row.status],
          ]),
        ),
      ],
      ['ignored', [...entry.ignored]],
      ['declared', entry.declared === null ? null : [...entry.declared]],
      ['diagnostics', []],
    ];
    if (doc.write) members.push(['written', entry.written === true]);
    return obj(members);
  });
  const top: Array<[string, Json]> = [
    ['version', 2],
    ['mode', 'suggest'],
    ['exitCode', doc.exitCode],
    ['files', files],
    ['diagnostics', sortDiagnostics(doc.diagnostics).map(diagJson)],
    ...(doc.all === true ? [['all', true] as [string, Json]] : []),
  ];
  return `${render(obj(top), '')}\n`;
}
