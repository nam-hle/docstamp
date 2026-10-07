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
  readonly written?: boolean;
}

const excludes = (row: SuggestRow): boolean => row.pattern.startsWith('!');
const fixed4 = (tenThousandths: number): string =>
  `${Math.floor(tenThousandths / 10000)}.${String(tenThousandths % 10000).padStart(4, '0')}`;

// SPEC §14.9
function table(rows: readonly SuggestRow[]): string[] {
  const cells = rows.map((row) => [
    shown(row.pattern),
    excludes(row) ? `-${row.resolvedCount}` : String(row.resolvedCount),
    excludes(row) ? '' : row.staleRate === null ? 'n/a' : fixed4(row.staleRate),
  ]);
  const all = [['pattern', 'files', 'stale'], ...cells];
  const widths = [0, 1, 2].map((c) => Math.max(...all.map((row) => row[c]!.length)));
  return all.map((row) =>
    `  ${row.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join('  ')}`.trimEnd(),
  );
}

export function suggestText(entries: readonly SuggestEntry[], write: boolean): string {
  let out = '';
  for (const entry of entries) {
    out += `suggest ${shown(entry.file)}\n`;
    if (entry.suggestions.length === 0) out += '  no paths found\n';
    else
      out += table(entry.suggestions)
        .map((line) => `${line}\n`)
        .join('');
    for (const path of entry.ignored) out += `  ignored  ${shown(path)}\n`;
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
