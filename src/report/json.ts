import { sortDiagnostics } from '../core/diagnostics.ts';
import { quote } from '../core/quote.ts';
import type { Diagnostic, Result, ReverseEntry } from '../core/types.ts';

export interface JsonDoc {
  mode: 'check' | 'update';
  exitCode: number;
  selected: readonly Result[];
  diagnostics: readonly Diagnostic[];
  written?: ReadonlySet<string>;
  removed?: readonly string[];
}

type Json = null | boolean | number | string | readonly Json[] | JsonObject;
type JsonObject = { readonly members: ReadonlyArray<readonly [string, Json]> };

const obj = (members: Array<[string, Json]>): JsonObject => ({ members });

function render(value: Json, indent: string): string {
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

const diagJson = (d: Diagnostic): JsonObject =>
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
  const dependents = doc.selected.map((r) => {
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
              ]),
            )
          : null,
      ],
      ['diagnostics', sortDiagnostics(r.diagnostics).map(diagJson)],
    ];
    if (doc.mode === 'update') members.push(['written', doc.written?.has(r.file) ?? false]);
    return obj(members);
  });
  const top: Array<[string, Json]> = [
    ['version', 2],
    ['mode', doc.mode],
    ['exitCode', doc.exitCode],
    [
      'summary',
      obj([
        ['ok', count('ok')],
        ['stale', count('stale')],
        ['invalid', count('invalid')],
      ]),
    ],
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
  const dependents = doc.selected.map((r) =>
    obj([
      ['file', r.file],
      ['dependencies', [...r.dependencies]],
      ['resolvedFiles', [...r.resolved]],
      ['diagnostics', sortDiagnostics(r.diagnostics).map(diagJson)],
    ]),
  );
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

// SPEC §14.5
export function reverseJsonText(doc: ReverseJsonDoc): string {
  const files = doc.entries.map((e) =>
    obj([
      ['file', e.file],
      [
        'dependents',
        e.dependents.map((d) =>
          obj([
            ['file', d.file],
            ['via', [...d.via]],
          ]),
        ),
      ],
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
