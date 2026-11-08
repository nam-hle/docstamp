import { diag, Raised } from '../core/diagnostics.ts';
import type { Result } from '../core/types.ts';
import { planUpdate } from '../engine/update-plan.ts';
import type { Host } from '../host/host.ts';
import { stampFile } from '../inline/read-inline.ts';
import { lockExists, writeLock } from '../lock/lock.ts';
import { checkChunks, reviewInputText, updateText } from '../report/text.ts';
import { determineRoot, resolveCwd } from '../universe/walk.ts';
import type { Args } from './args.ts';
import { withChanges } from './check.ts';
import { emit, hasError, type Output } from './emit.ts';
import { evaluateAll } from './evaluate.ts';
import type { Io } from './io.ts';
import { selectResults } from './paths.ts';

// SPEC §13.6: the only command that writes the Lockfile, or an inline `hash:` line
export function runUpdate(
  host: Host,
  args: Extract<Args, { mode: 'update' }>,
  processCwd: string,
  io: Io,
): number {
  const empty: Output = {
    json: args.json,
    mode: 'update',
    evaluated: false,
    exitCode: 2,
    selected: [],
    global: [],
    text: '',
    written: new Set<string>(),
    removed: [],
    dryRun: args.dryRun,
  };
  try {
    const cwd = resolveCwd(host, processCwd, args.cwd);
    const root = determineRoot(host, cwd);
    const evaluated = evaluateAll(host, root, args.all ? 'discard-invalid' : 'strict');
    const selected = args.all
      ? evaluated.results
      : selectResults(args.paths, cwd, root, evaluated.results, host.windows);
    const global = evaluated.global;
    const refused = hasError(global) || selected.some((r) => r.state === 'invalid');
    if (refused) {
      const chunks = checkChunks(selected, global, { cwd: args.cwd, next: false });
      return emit(io, { ...empty, evaluated: true, selected, global, chunks });
    }
    // SPEC §13.6 step 5: --all alone does not pass the gate over a changed dependency
    const stale = selected.filter((r) => r.reasons.includes('content-changed')).map((r) => r.file);
    if (args.all && !args.reviewed && stale.length > 0) {
      const message =
        `${stale.length} stale ${stale.length === 1 ? 'file' : 'files'} (${stale.join(', ')}); ` +
        'review them, then name them in "docstamp update", or pass --all --reviewed.';
      throw new Raised([diag('E_UNREVIEWED', { subject: '--all', message })]);
    }
    // SPEC §13.6: the review input, read before the write
    const whitespace = new Map<string, boolean>();
    const reviewed = selected.map((r) =>
      r.state === 'ok' ? { ...r, changes: [] } : withChanges(host, root, r, evaluated, whitespace),
    );
    const wasOk = new Set(selected.filter((r) => r.state === 'ok').map((r) => r.file));
    const plan = planUpdate(selected, evaluated.declarations, evaluated.lock);
    // SPEC §13.6: --dry-run decides the writes and makes none
    if (!args.dryRun) {
      if (plan.hasLockedFiles || lockExists(host, root)) {
        writeLock(host, root, { entries: plan.entries });
      }
      for (const [file, hash] of plan.stamps) stampFile(host, root, evaluated.universe, file, hash);
    }
    const afterWrite = reviewed.map((r): Result => ({ ...r, state: 'ok', reasons: [] }));
    return emit(io, {
      ...empty,
      evaluated: true,
      exitCode: 0,
      selected: afterWrite,
      global: global.filter((d) => d.code !== 'W_ORPHAN'),
      text:
        reviewInputText(reviewed, wasOk, !args.all) +
        updateText(plan.written, plan.unchanged, plan.removed, args.dryRun),
      written: new Set(plan.written),
      removed: plan.removed,
    });
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    return emit(io, { ...empty, global: e.diagnostics });
  }
}
