import { sortDiagnostics } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import { needsQuoting, quote } from '../core/quote.ts';
import type { Diagnostic, Result, ReverseEntry } from '../core/types.ts';

// SPEC §14.2
function shown(s: string): string {
  return needsQuoting(s) || /[ ()]/u.test(s) ? quote(s) : s;
}

const LABEL = { ok: 'OK', stale: 'STALE', invalid: 'INVALID' } as const;

// SPEC §14.3
export function checkText(selected: readonly Result[], rootArg?: string): string {
  let out = '';
  for (const r of selected) {
    if (r.state === 'ok') continue;
    out += `${LABEL[r.state].padEnd(9)}${shown(r.dependent)}`;
    out += r.state === 'stale' ? `  (${r.reasons.join(', ')})\n` : '\n';
    if (r.state === 'stale') {
      if (r.changes && r.changes.length > 0) {
        for (const c of r.changes) out += `  ${c.status.padEnd(8)}  ${shown(c.path)}\n`;
      } else for (const c of r.dependencies) out += `  depends   ${shown(c)}\n`;
    }
  }
  const count = (s: Result['state']) => selected.filter((r) => r.state === s).length;
  out += `${count('ok')} ok, ${count('stale')} stale, ${count('invalid')} invalid\n`;
  const stale = selected.filter((r) => r.state === 'stale').map((r) => shown(r.dependent));
  if (stale.length > 0) {
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
    out += `${shown(r.dependent)}\n`;
    if (r.state === 'invalid') continue;
    for (const c of r.dependencies) out += `  depends   ${shown(c)}\n`;
    for (const f of r.resolved) out += `  resolved  ${shown(f)}\n`;
  }
  return out;
}

// SPEC §14.4
export function updateText(written: readonly string[], removed: readonly string[]): string {
  return (
    sortPaths(written)
      .map((d) => `written  ${shown(d)}\n`)
      .join('') +
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
      if (d.dependent !== '') parts.push(shown(d.dependent));
      if (d.subject !== '') parts.push(shown(d.subject));
      return `${parts.join(': ')}: ${d.message}\n`;
    })
    .join('');
}

// SPEC §14.7
export function reverseText(entries: readonly ReverseEntry[]): string {
  let out = '';
  for (const entry of entries) {
    out += `${shown(entry.file)}\n`;
    if (entry.dependents.length === 0) out += '  (no dependents)\n';
    const names = entry.dependents.map((d) => shown(d.file));
    const width = Math.max(0, ...names.map((n) => n.length));
    entry.dependents.forEach((d, i) => {
      out += `  ${names[i]!.padEnd(width)}   via ${d.via.map(shown).join(', ')}\n`;
    });
  }
  return out;
}
