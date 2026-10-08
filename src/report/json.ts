import { sortDiagnostics } from '../core/diagnostics.ts';
import { quote } from '../core/quote.ts';
import type { Diagnostic, Result, ReverseDependent, ReverseEntry } from '../core/types.ts';
import type { FileStats } from '../engine/stats.ts';

export interface JsonDoc {
  mode: 'check' | 'update';
  evaluated?: boolean;
  onlyStale?: boolean;
  exitCode: number;
  selected: readonly Result[];
  diagnostics: readonly Diagnostic[];
  written?: ReadonlySet<string>;
  removed?: readonly string[];
}

export type Json = null | boolean | number | string | readonly Json[] | JsonObject;
type JsonObject = { readonly members: ReadonlyArray<readonly [string, Json]> };

export const obj = (members: Array<[string, Json]>): JsonObject => ({ members });

export function render(value: Json, indent: string): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') return quote(value);
  const inner = `${indent}  `;
  if (!Array.isArray(value)) {
    const { members } = value as JsonObject;
    if (members.length === 0) return '{}';
    const lines = members.map(([k, v]) => `${inner}${quote(k)}: ${render(v, inner)}`);
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  const items = value as readonly Json[];
  if (items.length === 0) return '[]';
  return `[\n${items.map((x) => `${inner}${render(x, inner)}`).join(',\n')}\n${indent}]`;
}

export const diagJson = (d: Diagnostic): JsonObject =>
  obj([
    ['code', d.code],
    ['severity', d.severity],
    ['file', d.file === '' ? null : d.file],
    ['subject', d.subject === '' ? null : d.subject],
    ['message', d.message],
  ]);

// SPEC §14.5
export function jsonText(doc: JsonDoc): string {
  const count = (s: Result['state']) => doc.selected.filter((r) => r.state === s).length;
  const listed =
    doc.onlyStale === true ? doc.selected.filter((r) => r.state !== 'ok') : doc.selected;
  const dependents = listed.map((r) => {
    const members: Array<[string, Json]> = [
      ['file', r.file],
      ['state', r.state],
      ['reasons', [...r.reasons]],
      ['dependencies', [...r.dependencies]],
      [
        'changes',
        r.changes
          ? r.changes.map((c) =>
              obj([
                ['status', c.status],
                ['path', c.path],
                ['via', [...c.via]],
                ...(c.whitespaceOnly ? [['whitespaceOnly', true] as [string, Json]] : []),
                ...(c.pair === undefined ? [] : [['pair', c.pair] as [string, Json]]),
              ]),
            )
          : null,
      ],
      ...(r.edited === undefined ? [] : [['dependenciesEdited', true] as [string, Json]]),
      ['diagnostics', sortDiagnostics(r.diagnostics).map(diagJson)],
    ];
    if (doc.mode === 'update') members.push(['written', doc.written?.has(r.file) ?? false]);
    return obj(members);
  });
  const top: Array<[string, Json]> = [
    ['version', 2],
    ['mode', doc.mode],
    ['exitCode', doc.exitCode],
    ...(doc.evaluated !== false
      ? [
          [
            'summary',
            obj([
              ['ok', count('ok')],
              ['stale', count('stale')],
              ['invalid', count('invalid')],
            ]),
          ] as [string, Json],
        ]
      : []),
    ['files', dependents],
    ['diagnostics', sortDiagnostics(doc.diagnostics).map(diagJson)],
  ];
  if (doc.mode === 'update') top.push(['removed', [...(doc.removed ?? [])]]);
  return `${render(obj(top), '')}\n`;
}

export interface ListJsonDoc {
  exitCode: number;
  selected: readonly Result[];
  diagnostics: readonly Diagnostic[];
}

// SPEC §14.5
export function listJsonText(doc: ListJsonDoc): string {
  const dependents = doc.selected.map((r) => {
    const members: Array<[string, Json]> = [
      ['file', r.file],
      ['dependencies', [...r.dependencies]],
    ];
    if ((r.use ?? []).length > 0) {
      members.push(['use', [...r.use!]]);
      members.push(['origins', r.dependencies.map((_, i) => r.origins?.[i] ?? null)]);
    }
    members.push(['resolvedFiles', [...r.resolved]]);
    members.push(['diagnostics', sortDiagnostics(r.diagnostics).map(diagJson)]);
    return obj(members);
  });
  const top: Array<[string, Json]> = [
    ['version', 2],
    ['mode', 'list-dependencies'],
    ['exitCode', doc.exitCode],
    ['files', dependents],
    ['diagnostics', sortDiagnostics(doc.diagnostics).map(diagJson)],
  ];
  return `${render(obj(top), '')}\n`;
}

export interface ReverseJsonDoc {
  exitCode: number;
  entries: readonly ReverseEntry[];
  diagnostics: readonly Diagnostic[];
}

function dependentJson(d: ReverseDependent): JsonObject {
  const members: Array<[string, Json]> = [
    ['file', d.file],
    ['via', [...d.via]],
  ];
  if (d.dependents !== undefined) {
    members.push(['dependents', d.dependents.map(dependentJson)]);
    members.push(['cycle', d.cycle === true]);
    members.push(['repeated', d.repeated === true]);
  }
  return obj(members);
}

// SPEC §14.5
export function reverseJsonText(doc: ReverseJsonDoc): string {
  const files = doc.entries.map((e) =>
    obj([
      ['file', e.file],
      ['dependents', e.dependents.map(dependentJson)],
      ['diagnostics', sortDiagnostics(e.diagnostics).map(diagJson)],
    ]),
  );
  const top: Array<[string, Json]> = [
    ['version', 2],
    ['mode', 'list-dependents'],
    ['exitCode', doc.exitCode],
    ['files', files],
    ['diagnostics', sortDiagnostics(doc.diagnostics).map(diagJson)],
  ];
  return `${render(obj(top), '')}\n`;
}

export interface StatsWindow {
  readonly kind: 'days' | 'revision';
  readonly value: string;
  readonly commits: number;
  readonly untouched: number;
}

export interface StatsJsonDoc {
  exitCode: number;
  window: StatsWindow | null;
  files: readonly FileStats[];
  diagnostics: readonly Diagnostic[];
}

// SPEC §14.5: rates are integers of ten-thousandths in memory, JSON numbers on output
export function statsJsonText(doc: StatsJsonDoc): string {
  const { window } = doc;
  const files = doc.files.map((f) =>
    obj([
      ['file', f.file],
      ['patterns', f.patterns],
      ['resolvedCount', f.resolvedCount],
      ['staleCommits', f.staleCommits],
      ['days', f.days],
      ['staleRate', f.staleRate / 10000],
      ['sweepCommits', f.sweepCommits],
      ['sweepShare', f.sweepShare / 10000],
      ['diagnostics', sortDiagnostics(f.diagnostics).map(diagJson)],
    ]),
  );
  const top: Array<[string, Json]> = [
    ['version', 2],
    ['mode', 'stats'],
    ['exitCode', doc.exitCode],
    [
      'window',
      window === null
        ? null
        : obj([
            ['kind', window.kind],
            ['value', window.value],
            ['commits', window.commits],
            ['untouched', window.untouched],
          ]),
    ],
    ['files', files],
    ['diagnostics', sortDiagnostics(doc.diagnostics).map(diagJson)],
  ];
  return `${render(obj(top), '')}\n`;
}
