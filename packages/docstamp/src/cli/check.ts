import { Raised } from '../core/diagnostics.ts';
import type { Result } from '../core/types.ts';
import { selectionChanges } from '../engine/selection.ts';
import type { Host } from '../host/host.ts';
import { resolveSelector } from '../config/shorthand.ts';
import { changedSince } from '../history/changes.ts';
import { checkChunks } from '../report/text.ts';
import { determineRoot, resolveCwd } from '../universe/walk.ts';
import type { Args } from './args.ts';
import { emit, hasError, type Output } from './emit.ts';
import { evaluateAll, type Evaluated } from './evaluate.ts';
import type { Io } from './io.ts';
import { rootFromCwd, selectResults } from './paths.ts';

// SPEC §12.3
function withChanges(
  host: Host,
  root: string,
  result: Result,
  evaluated: Evaluated,
  whitespace: Map<string, boolean>,
): Result {
  const declaration = evaluated.declarations.find((b) => b.file === result.file);
  const inline = declaration?.inline;
  const entry = inline ? inline.recorded : evaluated.lock.entries.get(result.file);
  if (result.state !== 'stale' || !result.reasons.includes('content-changed') || !entry) {
    return result;
  }
  const probe = declaration?.selected?.length
    ? evaluated.fragmentProbe(declaration.selected)
    : undefined;
  const report = changedSince(
    host.git(root),
    result,
    entry,
    inline !== undefined,
    whitespace,
    probe,
    (shorthand) => {
      const resolved = resolveSelector(evaluated.plugins, result.file, shorthand);
      return 'select' in resolved ? resolved.select : null;
    },
  );
  if (report === null) return { ...result, changes: null };
  const { universe, presets, defaultPresets } = evaluated;
  const { ownThen } = report;
  const selection =
    ownThen === undefined
      ? null
      : selectionChanges(
          result.file,
          ownThen,
          presets,
          defaultPresets,
          universe.paths,
          result.resolved,
        );
  return {
    ...result,
    changes: report.changes,
    base: report.base,
    ...(report.edited === undefined ? {} : { edited: report.edited }),
    ...(selection === null ? {} : { selection }),
    ...(report.fragments === undefined ? {} : { fragments: report.fragments }),
  };
}

// SPEC §13.5
export function runCheck(
  host: Host,
  args: Extract<Args, { mode: 'check' }>,
  processCwd: string,
  io: Io,
): number {
  const empty: Output = {
    json: args.json,
    mode: 'check',
    evaluated: false,
    exitCode: 2,
    selected: [],
    global: [],
    text: '',
  };
  try {
    const cwd = resolveCwd(host, processCwd, args.cwd);
    const root = determineRoot(host, cwd);
    const evaluated = evaluateAll(host, root, 'strict');
    const selected = selectResults(args.paths, cwd, root, evaluated.results, host.windows);
    const global = evaluated.global;
    const refused = hasError(global) || selected.some((r) => r.state === 'invalid');
    const stale = selected.some((r) => r.state === 'stale');
    const exitCode = refused ? 2 : stale ? 1 : 0;
    const whitespace = new Map<string, boolean>();
    const reported = selected.map((r) => withChanges(host, root, r, evaluated, whitespace));
    const chunks = checkChunks(reported, global, {
      cwd: args.cwd,
      quiet: args.quiet,
      rootFromCwd: rootFromCwd(cwd, root, host.windows),
      inline: new Set(evaluated.declarations.filter((b) => b.inline).map((b) => b.file)),
    });
    return emit(io, {
      ...empty,
      evaluated: true,
      onlyStale: args.onlyStale,
      exitCode,
      selected: reported,
      global,
      chunks,
    });
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    return emit(io, { ...empty, global: e.diagnostics });
  }
}
