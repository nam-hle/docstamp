import { sortDiagnostics } from '../core/diagnostics.ts';
import { comparePaths, sortPaths } from '../core/order.ts';
import { needsQuoting, quote, shellQuote } from '../core/quote.ts';
import type {
  Change,
  Diagnostic,
  Result,
  ReverseDependent,
  ReverseEntry,
} from '../core/types.ts';
import type { FileStats } from '../engine/stats.ts';
import type { StatsWindow } from './json.ts';

// SPEC §14.2
function shown(s: string): string {
  return needsQuoting(s) || /[ ()]/u.test(s) ? quote(s) : s;
}

const LABEL = { ok: 'OK', stale: 'STALE', invalid: 'INVALID' } as const;
const GROUP_MIN = 5;
const NEXT_MAX = 10;
const REVIEW_PATH_MAX = 10;
const LITERAL_NEEDED = /^:|[*?[\\]/u;

export interface CheckTextOptions {
  root?: string;
  next?: boolean;
  quiet?: boolean;
}

export interface Chunk {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

const directoryOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);

// SPEC §14.3.1
export function changeLines(changes: readonly Change[]): string[] {
  const sizes = new Map<string, number>();
  const runKey = (c: Change) => `${c.status}\0${directoryOf(c.path)}`;
  const groupable = (c: Change) => c.status !== 'modified' && directoryOf(c.path) !== '';
  for (const c of changes.filter(groupable)) sizes.set(runKey(c), (sizes.get(runKey(c)) ?? 0) + 1);
  const entries: Array<{ sort: string; rank: number; line: string }> = [];
  const grouped = new Set<string>();
  for (const c of changes) {
    const size = groupable(c) ? (sizes.get(runKey(c)) ?? 0) : 0;
    const status = c.status.padEnd(8);
    if (size < GROUP_MIN) {
      const marker = c.whitespaceOnly ? ' (whitespace only)' : '';
      entries.push({ sort: c.path, rank: 0, line: `  ${status}  ${shown(c.path)}${marker}\n` });
    } else if (!grouped.has(runKey(c))) {
      grouped.add(runKey(c));
      const dir = directoryOf(c.path);
      const line = `  ${status}  ${shown(dir)}  (${size} files)\n`;
      entries.push({ sort: dir, rank: c.status === 'added' ? 0 : 1, line });
    }
  }
  entries.sort((a, b) => comparePaths(a.sort, b.sort) || a.rank - b.rank);
  return entries.map((entry) => entry.line);
}

// SPEC §14.3.4
function pathspecsOf(dependencies: readonly string[]): string[] | null {
  if (dependencies.some((pattern) => pattern.includes('{'))) return null;
  return dependencies.flatMap((pattern) => {
    const negated = pattern.startsWith('!');
    const glob = negated ? pattern.slice(1) : pattern;
    const magic = negated ? ':(exclude,glob)' : ':(glob)';
    const wildcard = /[*?[]/u.test(glob) && !glob.endsWith('**');
    return wildcard ? [`${magic}${glob}`, `${magic}${glob}/**`] : [`${magic}${glob}`];
  });
}

// SPEC §14.3.4
export function reviewLine(r: Result, rootArg?: string): string {
  if (r.base === undefined || !r.changes || r.changes.length === 0) return '';
  const args =
    r.changes.length <= REVIEW_PATH_MAX
      ? r.changes.map((c) => (LITERAL_NEEDED.test(c.path) ? `:(literal)${c.path}` : c.path))
      : pathspecsOf(r.dependencies);
  if (args === null) return '';
  const git = rootArg === undefined ? 'git' : `git -C ${shellQuote(rootArg)}`;
  return `  review: ${git} diff ${r.base} -- ${args.map(shellQuote).join(' ')}\n`;
}

// SPEC §14.3.3
function nextLine(lead: string, command: string, files: readonly string[], root: string): string {
  const listed = files.slice(0, NEXT_MAX).map(shown).join(' ');
  const more = files.length > NEXT_MAX ? `  and ${files.length - NEXT_MAX} more\n` : '';
  return `next: ${lead}, then run: docstamp ${command} ${listed}${root}\n${more}`;
}

// SPEC §14.3, §14.3.2
export function checkChunks(
  selected: readonly Result[],
  global: readonly Diagnostic[],
  { root: rootArg, next: withNext = true, quiet = false }: CheckTextOptions = {},
): Chunk[] {
  const chunks: Chunk[] = [];
  const emit = (stream: Chunk['stream'], text: string) => {
    if (text !== '') chunks.push({ stream, text });
  };
  emit('stderr', diagnosticsText(global));
  for (const r of selected) {
    if (r.state !== 'ok') {
      let block = `${LABEL[r.state].padEnd(9)}${shown(r.file)}`;
      block += r.state === 'stale' ? `  (${r.reasons.join(', ')})\n` : '\n';
      if (r.state === 'stale') {
        if (r.changes && r.changes.length > 0) {
          block += changeLines(r.changes).join('') + reviewLine(r, rootArg);
        } else for (const c of r.dependencies) block += `  depends   ${shown(c)}\n`;
      }
      emit('stdout', block);
    }
    emit('stderr', diagnosticsText(r.diagnostics));
  }
  const files = (state: Result['state']) =>
    selected.filter((r) => r.state === state).map((r) => r.file);
  const [stale, invalid] = [files('stale'), files('invalid')];
  if (!quiet || stale.length + invalid.length > 0) {
    const ok = selected.length - stale.length - invalid.length;
    emit('stdout', `${ok} ok, ${stale.length} stale, ${invalid.length} invalid\n`);
  }
  if (withNext) {
    const root = rootArg === undefined ? '' : ` --root ${shown(rootArg)}`;
    if (stale.length > 0) {
      const lead = 'review each stale file against its dependencies';
      emit('stdout', nextLine(lead, 'update', stale, root));
    }
    if (invalid.length > 0) {
      emit(
        'stdout',
        nextLine('fix the configuration of each invalid file', 'check', invalid, root),
      );
    }
  }
  return chunks;
}

// SPEC §14.3
export function checkText(selected: readonly Result[], options: CheckTextOptions = {}): string {
  return checkChunks(selected, [], options)
    .filter((chunk) => chunk.stream === 'stdout')
    .map((chunk) => chunk.text)
    .join('');
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
