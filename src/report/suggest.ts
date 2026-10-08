import { sortDiagnostics } from '../core/diagnostics.ts';
import type { Diagnostic } from '../core/types.ts';
import { diagJson, obj, render, type Json } from './json.ts';
import { shown } from './text.ts';

// SPEC §14.5, §14.9: the rate is an integer of ten-thousandths, or null when it cannot be told
interface SuggestRow {
  readonly pattern: string;
  readonly resolvedCount: number;
  readonly staleRate: number | null;
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
    ...(declared === null ? [] : [declared.includes(row.pattern) ? 'declared' : 'new']),
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

export function suggestText(entries: readonly SuggestEntry[], write: boolean): string {
  let out = '';
  for (const entry of entries) {
    out += `suggest ${shown(entry.file)}\n`;
    if (entry.suggestions.length === 0) out += '  no paths found\n';
    else
      out += table(entry.suggestions, entry.declared)
        .map((line) => `${line}\n`)
        .join('');
    for (const path of entry.ignored) out += `  ignored  ${shown(path)}\n`;
    for (const pattern of onlyDeclared(entry)) out += `  only declared  ${shown(pattern)}\n`;
  }
  if (write) {
    for (const entry of entries) {
      out += `${entry.written === true ? 'written  ' : 'unchanged  '}${shown(entry.file)}\n`;
    }
  }
  return out;
}

export interface SuggestJsonDoc {
  exitCode: number;
  write: boolean;
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
  ];
  return `${render(obj(top), '')}\n`;
}
