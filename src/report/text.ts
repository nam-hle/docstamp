import { sortDiagnostics } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import { needsQuoting, quote } from '../core/quote.ts';
import type { Diagnostic, Result, ReverseDependent, ReverseEntry } from '../core/types.ts';
import type { FileStats } from '../engine/stats.ts';
import type { StatsWindow } from './json.ts';

// SPEC §14.2
function shown(s: string): string {
  return needsQuoting(s) || /[ ()]/u.test(s) ? quote(s) : s;
}

const LABEL = { ok: 'OK', stale: 'STALE', invalid: 'INVALID' } as const;

export interface CheckTextOptions {
  root?: string;
  next?: boolean;
  quiet?: boolean;
}

// SPEC §14.3
export function checkText(
  selected: readonly Result[],
  { root: rootArg, next: withNext = true, quiet = false }: CheckTextOptions = {},
): string {
  let out = '';
  for (const r of selected) {
    if (r.state === 'ok') continue;
    out += `${LABEL[r.state].padEnd(9)}${shown(r.file)}`;
    out += r.state === 'stale' ? `  (${r.reasons.join(', ')})\n` : '\n';
    if (r.state === 'stale') {
      if (r.changes && r.changes.length > 0) {
        for (const c of r.changes) out += `  ${c.status.padEnd(8)}  ${shown(c.path)}\n`;
      } else for (const c of r.dependencies) out += `  depends   ${shown(c)}\n`;
    }
  }
  const count = (s: Result['state']) => selected.filter((r) => r.state === s).length;
  if (!quiet || count('stale') + count('invalid') > 0) {
    out += `${count('ok')} ok, ${count('stale')} stale, ${count('invalid')} invalid\n`;
  }
  const stale = selected.filter((r) => r.state === 'stale').map((r) => shown(r.file));
  if (withNext && stale.length > 0) {
    const root = rootArg === undefined ? '' : ` --root ${shown(rootArg)}`;
    out +=
      'next: review each stale file against its dependencies, then run: ' +
      `docstamp update ${stale.join(' ')}${root}\n`;
  }
  return out;
}

// SPEC §14.6
export function listText(selected: readonly Result[]): string {
  let out = '';
  for (const r of selected) {
    out += `${shown(r.file)}\n`;
    if (r.state === 'invalid') continue;
    r.dependencies.forEach((c, i) => {
      const preset = r.origins?.[i] ?? null;
      out += `  depends   ${shown(c)}${preset === null ? '' : ` (preset ${shown(preset)})`}\n`;
    });
    for (const f of r.resolved) out += `  resolved  ${shown(f)}\n`;
  }
  return out;
}

// SPEC §14.4
export function updateText(
  written: readonly string[],
  unchanged: readonly string[],
  removed: readonly string[],
): string {
  const targets = [
    ...written.map((file) => ({ file, label: 'written  ' })),
    ...unchanged.map((file) => ({ file, label: 'unchanged  ' })),
  ];
  const order = sortPaths(targets.map((t) => t.file));
  return (
    order.map((file) => `${targets.find((t) => t.file === file)!.label}${shown(file)}\n`).join('') +
    sortPaths(removed)
      .map((d) => `removed  ${shown(d)}\n`)
      .join('')
  );
}

// SPEC §14.3
export function diagnosticsText(ds: readonly Diagnostic[]): string {
  return sortDiagnostics(ds)
    .map((d) => {
      const parts: string[] = [d.severity, d.code];
      if (d.file !== '') parts.push(shown(d.file));
      if (d.subject !== '') parts.push(shown(d.subject));
      return `${parts.join(': ')}: ${d.message}\n`;
    })
    .join('');
}

// SPEC §14.7
function reverseRows(dependents: readonly ReverseDependent[], depth: number): string {
  const names = dependents.map((d) => shown(d.file));
  const width = Math.max(0, ...names.map((n) => n.length));
  let out = '';
  dependents.forEach((d, i) => {
    const mark = d.cycle === true ? ' (cycle)' : d.repeated === true ? ' (listed above)' : '';
    const via = d.via.map(shown).join(', ');
    out += `${'  '.repeat(depth + 1)}${names[i]!.padEnd(width)}   via ${via}${mark}\n`;
    out += reverseRows(d.dependents ?? [], depth + 1);
  });
  return out;
}

// SPEC §14.7
export function reverseText(entries: readonly ReverseEntry[]): string {
  let out = '';
  for (const entry of entries) {
    out += `${shown(entry.file)}\n`;
    if (entry.dependents.length === 0) out += '  (no dependents)\n';
    out += reverseRows(entry.dependents, 0);
  }
  return out;
}

const fixed4 = (tenThousandths: number): string =>
  `${Math.floor(tenThousandths / 10000)}.${String(tenThousandths % 10000).padStart(4, '0')}`;

// SPEC §14.8
export function statsText(files: readonly FileStats[], window: StatsWindow): string {
  const rows = files.map((f) => [
    shown(f.file),
    String(f.patterns),
    String(f.resolvedCount),
    String(f.staleCommits),
    String(f.days),
    fixed4(f.staleRate),
    fixed4(f.sweepShare),
  ]);
  const table =
    files.length === 0
      ? []
      : [['file', 'patterns', 'files', 'commits', 'days', 'stale', 'sweep'], ...rows];
  const widths = [0, 1, 2, 3, 4, 5, 6].map((c) =>
    Math.max(0, ...table.map((row) => row[c]!.length)),
  );
  let out = table
    .map((row) =>
      row
        .map((cell, c) => (c === 0 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!)))
        .join('  ')
        .trimEnd(),
    )
    .map((line) => `${line}\n`)
    .join('');
  const where =
    window.kind === 'days'
      ? `in the last ${window.value.slice(0, -1)} days`
      : `in ${shown(`${window.value}..HEAD`)}`;
  out += `window: ${window.commits} commits ${where}, ${window.untouched} make no file stale\n`;
  return out;
}
