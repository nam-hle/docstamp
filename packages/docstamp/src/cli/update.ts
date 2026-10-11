import { Raised } from '../core/diagnostics.ts';
import type { Result } from '../core/types.ts';
import { planUpdate } from '../engine/update-plan.ts';
import type { Host } from '../host/host.ts';
import { stampFile } from '../inline/read-inline.ts';
import { lockExists, writeLock } from '../lock/lock.ts';
import { checkChunks, updateText } from '../report/text.ts';
import { determineRoot, resolveCwd } from '../universe/walk.ts';
import type { Args } from './args.ts';
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
  };
  try {
    const cwd = resolveCwd(host, processCwd, args.cwd);
    const root = determineRoot(host, cwd);
    const evaluated = evaluateAll(host, root, args.all ? 'discard-invalid' : 'strict');
    const selected = args.all
      ? evaluated.results
      : selectResults(args.paths, cwd, root, evaluated.results);
    const global = evaluated.global;
    const refused = hasError(global) || selected.some((r) => r.state === 'invalid');
    if (refused) {
      const chunks = checkChunks(selected, global, { cwd: args.cwd, next: false });
      return emit(io, { ...empty, evaluated: true, selected, global, chunks });
    }
    const plan = planUpdate(selected, evaluated.declarations, evaluated.lock);
    if (plan.hasLockedFiles || lockExists(host, root)) {
      writeLock(host, root, { entries: plan.entries });
    }
    for (const [file, hash] of plan.stamps) stampFile(host, root, evaluated.universe, file, hash);
    const afterWrite = selected.map((r): Result => ({ ...r, state: 'ok', reasons: [] }));
    return emit(io, {
      ...empty,
      evaluated: true,
      exitCode: 0,
      selected: afterWrite,
      global: global.filter((d) => d.code !== 'W_ORPHAN'),
      text: updateText(plan.written, plan.unchanged, plan.removed),
      written: new Set(plan.written),
      removed: plan.removed,
    });
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    return emit(io, { ...empty, global: e.diagnostics });
  }
}
