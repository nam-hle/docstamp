import { sortDiagnostics } from '../core/diagnostics.ts';
import { quote } from '../core/quote.ts';
import type { Diagnostic, Result } from '../core/types.ts';

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
    ['dependent', d.dependent === '' ? null : d.dependent],
    ['subject', d.subject === '' ? null : d.subject],
    ['message', d.message],
  ]);

// SPEC §14.5
export function jsonText(doc: JsonDoc): string {
  const count = (s: Result['state']) => doc.selected.filter((r) => r.state === s).length;
  const dependents = doc.selected.map((r) => {
    const members: Array<[string, Json]> = [
      ['dependent', r.dependent],
      ['state', r.state],
      ['reasons', [...r.reasons]],
      ['covers', [...r.covers]],
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
    if (doc.mode === 'update') members.push(['written', doc.written?.has(r.dependent) ?? false]);
    return obj(members);
  });
  const top: Array<[string, Json]> = [
    ['version', 1],
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
    ['dependents', dependents],
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
      ['dependent', r.dependent],
      ['covers', [...r.covers]],
      ['files', [...r.covered]],
      ['diagnostics', sortDiagnostics(r.diagnostics).map(diagJson)],
    ]),
  );
  const top: Array<[string, Json]> = [
    ['version', 1],
    ['mode', 'list-dependents'],
    ['exitCode', doc.exitCode],
    ['dependents', dependents],
    ['diagnostics', sortDiagnostics(doc.diagnostics).map(diagJson)],
  ];
  return `${render(obj(top), '')}\n`;
}
