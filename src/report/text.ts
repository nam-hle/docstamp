import { sortDiagnostics } from '../core/diagnostics.ts';
import { comparePaths, sortPaths } from '../core/order.ts';
import { needsQuoting, quote, shellQuote } from '../core/quote.ts';
import type { Change, Diagnostic, Result, ReverseDependent, ReverseEntry } from '../core/types.ts';
import type { FileStats } from '../engine/stats.ts';
import type { StatsWindow } from './json.ts';

// SPEC §14.2
export function shown(s: string): string {
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
  rootFromCwd?: string;
}

export interface Chunk {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

const directoryOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);

interface Entry {
  readonly status: Change['status'] | 'renamed';
  readonly path: string;
  readonly to?: string;
  readonly whitespaceOnly: boolean;
}

// SPEC §14.3.1: a pair is one renamed entry at its deleted path
function entriesOf(changes: readonly Change[]): Entry[] {
  return changes
    .filter((c) => c.pair === undefined || c.status === 'deleted')
    .map((c) => (c.pair === undefined ? c : { ...c, status: 'renamed', to: c.pair }));
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const RANK = { modified: 0, added: 0, deleted: 1, renamed: 2 } as const;

// SPEC §14.3.1: the run of an entry, or null when it is in none
function runOf(e: Entry): { key: string; head: string } | null {
  const dir = directoryOf(e.path);
  if (e.status === 'modified' || dir === '') return null;
  if (e.status !== 'renamed') return { key: `${e.status}\0${dir}`, head: shown(dir) };
  const to = directoryOf(e.to!);
  if (to === '' || to === dir || nameOf(e.to!) !== nameOf(e.path)) return null;
  return { key: `renamed\0${dir}\0${to}`, head: `${shown(dir)} -> ${shown(to)}` };
}

// SPEC §14.3.1
export function changeLines(changes: readonly Change[]): string[] {
  const entries = entriesOf(changes);
  const sizes = new Map<string, number>();
  for (const e of entries) {
    const run = runOf(e);
    if (run !== null) sizes.set(run.key, (sizes.get(run.key) ?? 0) + 1);
  }
  const lines: Array<{ sort: string; rank: number; line: string }> = [];
  const grouped = new Set<string>();
  for (const e of entries) {
    const run = runOf(e);
    const size = run === null ? 0 : (sizes.get(run.key) ?? 0);
    const status = e.status.padEnd(8);
    if (run === null || size < GROUP_MIN) {
      const marker = e.whitespaceOnly ? ' (whitespace only)' : '';
      const target = e.to === undefined ? '' : ` -> ${shown(e.to)}`;
      const line = `  ${status}  ${shown(e.path)}${target}${marker}\n`;
      lines.push({ sort: e.path, rank: 0, line });
    } else if (!grouped.has(run.key)) {
      grouped.add(run.key);
      const line = `  ${status}  ${run.head}  (${size} files)\n`;
      lines.push({ sort: directoryOf(e.path), rank: RANK[e.status], line });
    }
  }
  lines.sort((a, b) => comparePaths(a.sort, b.sort) || a.rank - b.rank);
  return lines.map((entry) => entry.line);
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

const pathArg = (path: string): string => (LITERAL_NEEDED.test(path) ? `:(literal)${path}` : path);

// SPEC §14.3: the edited line and the summary line
function headLines(r: Result): string {
  const changes = r.changes ?? [];
  const edited =
    r.edited === undefined ? '' : `  edited    ${shown(r.edited)}  (dependency list)\n`;
  const entries = entriesOf(changes);
  const counts = (['modified', 'added', 'deleted', 'renamed'] as const)
    .map((status) => ({ status, n: entries.filter((e) => e.status === status).length }))
    .filter(({ n }) => n > 0)
    .map(({ status, n }) => `${n} ${status}`);
  return changes.length < GROUP_MIN ? edited : `${edited}  changed   ${counts.join(', ')}\n`;
}

// SPEC §14.3.4
export function reviewLine(r: Result, rootArg?: string): string {
  if (r.base === undefined || !r.changes) return '';
  if (r.changes.length === 0 && r.edited === undefined) return '';
  const listed =
    r.changes.length <= REVIEW_PATH_MAX
      ? r.changes.map((c) => pathArg(c.path))
      : pathspecsOf(r.dependencies);
  if (listed === null) return '';
  const { edited } = r;
  const extra =
    edited !== undefined && !r.changes.some((c) => c.path === edited) ? [pathArg(edited)] : [];
  const args = [...listed, ...extra];
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
  { root: rootArg, next: withNext = true, quiet = false, rootFromCwd = '' }: CheckTextOptions = {},
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
        if (r.changes && (r.changes.length > 0 || r.edited !== undefined)) {
          block += headLines(r) + changeLines(r.changes).join('') + reviewLine(r, rootArg);
        } else for (const c of r.dependencies) block += `  depends   ${shown(c)}\n`;
      }
      emit('stdout', block);
    }
    emit('stderr', diagnosticsText(r.diagnostics));
  }
  const argument = (file: string) => (rootFromCwd === '' ? file : `${rootFromCwd}/${file}`);
  const files = (state: Result['state']) =>
    selected.filter((r) => r.state === state).map((r) => argument(r.file));
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
