import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from '../config/read-config.ts';
import { Raised, diag } from '../core/diagnostics.ts';
import { sortPaths } from '../core/order.ts';
import type { Diagnostic } from '../core/types.ts';
import { propose, statusOf, type Suggestion } from '../engine/suggest.ts';
import { statistics } from '../engine/stats.ts';
import { replay } from '../history/replay.ts';
import { parseBlock } from '../inline/block.ts';
import { scanFrontmatter } from '../inline/frontmatter.ts';
import { replaceFile, textOf } from '../inline/read-inline.ts';
import { writeBlock } from '../inline/write-block.ts';
import { select } from '../pattern/match.ts';
import { parsePattern, type ParsedPattern } from '../pattern/parse.ts';
import { suggestJsonText, suggestText, type SuggestEntry } from '../report/suggest.ts';
import { diagnosticsText } from '../report/text.ts';
import { computeUniverse, determineRoot, isIgnoredPath } from '../universe/walk.ts';
import type { Args } from './args.ts';
import { resolutionMessage, toRepoPath } from './paths.ts';
import type { Io } from './run.ts';

const WINDOW_DAYS = 30;
const usage = (subject: string, message: string) => diag('E_USAGE', { subject, message });

// SPEC §13.10 step 6: the stale rate of each pattern, null when the history cannot tell
function staleRates(root: string, proposals: ReadonlyMap<string, readonly Suggestion[]>) {
  const rates = new Map<string, number | null>();
  const inputs = [...proposals].flatMap(([doc, suggestions]) =>
    suggestions
      .filter((s) => !s.pattern.startsWith('!'))
      .map((s) => ({
        file: `${doc}\0${s.pattern}`,
        patterns: 1,
        resolved: s.files,
        diagnostics: [],
      })),
  );
  let commits;
  try {
    const window = replay(root, { kind: 'days', days: WINDOW_DAYS }, Math.floor(Date.now() / 1000));
    commits = window.commits.length === 0 ? null : window.commits;
  } catch {
    commits = null;
  }
  const measured = commits === null ? [] : statistics(inputs, commits).files;
  for (const input of inputs) {
    rates.set(input.file, measured.find((f) => f.file === input.file)?.staleRate ?? null);
  }
  return rates;
}

function suggestAll(args: Extract<Args, { mode: 'suggest' }>, cwd: string): SuggestEntry[] {
  const root = determineRoot(cwd, args.root);
  const { config } = readConfig(root);
  const universe = computeUniverse(root, config);
  const problems: Diagnostic[] = [];
  const texts = new Map<string, string>();
  const absolute = (path: string) => join(root, universe.onDisk.get(path) ?? path);
  for (const arg of args.paths) {
    const path = toRepoPath(arg, cwd, root);
    if (path === null) {
      problems.push(usage(arg, resolutionMessage(arg, cwd, root)));
      continue;
    }
    let text: string | null = null;
    try {
      text = lstatSync(absolute(path)).isFile() ? textOf(absolute(path)) : null;
    } catch {
      text = null;
    }
    if (text === null) {
      const message = `Cannot read ${path} as text; name a readable text file.`;
      problems.push(diag('E_UNREADABLE', { subject: path, message }));
    } else texts.set(path, text);
  }
  if (problems.length > 0) throw new Raised(problems);
  const names = sortPaths([...texts.keys()]);

  const include = config.include.map((source) => parsePattern(source) as ParsedPattern);
  if (args.write) {
    const configured = new Set(config.declarations.map((d) => d.file));
    for (const path of names) {
      if (configured.has(path)) {
        const message = `${path} is declared in the configuration file; edit it there by hand.`;
        problems.push(usage(path, message));
      } else if (universe.kinds.get(path) !== 'file' || select(include, [path]).length === 0) {
        const message =
          `${path} is ignored or not selected by include, so a docstamp block in it ` +
          'would never be read; name a file that include selects.';
        problems.push(usage(path, message));
      }
    }
    if (problems.length > 0) throw new Raised(problems);
  }

  // SPEC §13.10 step 4: the own patterns already declared for the file, from the unwritten text
  const declaredOf = (path: string): readonly string[] | null => {
    const configured = config.declarations.find((d) => d.file === path);
    if (configured !== undefined) return configured.dependencies;
    if (universe.kinds.get(path) !== 'file' || select(include, [path]).length === 0) return null;
    const scan = scanFrontmatter(texts.get(path)!);
    return scan === null ? null : parseBlock(path, scan).declaration.dependencies;
  };
  const isIgnored = (path: string) => isIgnoredPath(root, universe, path);
  const proposals = new Map(
    names.map((path) => [path, propose(path, texts.get(path)!, universe.paths, isIgnored)]),
  );
  const rates = staleRates(
    root,
    new Map([...proposals].map(([path, proposal]) => [path, proposal.suggestions])),
  );

  const rewritten = new Map<string, string>();
  if (args.write) {
    for (const path of names) {
      const { suggestions } = proposals.get(path)!;
      if (suggestions.length === 0) continue;
      const text = writeBlock(
        path,
        texts.get(path)!,
        suggestions.map((s) => s.pattern),
      );
      if (text !== texts.get(path)) rewritten.set(path, text);
    }
    for (const [path, text] of rewritten) replaceFile(absolute(path), path, () => text);
  }
  return names.map((path) => {
    const { suggestions, ignored } = proposals.get(path)!;
    const declared = declaredOf(path);
    const others = universe.paths.filter((p) => p !== path);
    return {
      file: path,
      suggestions: suggestions.map((s) => ({
        pattern: s.pattern,
        resolvedCount: s.files.length,
        staleRate: s.pattern.startsWith('!') ? null : (rates.get(`${path}\0${s.pattern}`) ?? null),
        status: declared === null ? null : statusOf(s, declared, others),
      })),
      ignored,
      declared,
      written: rewritten.has(path),
    };
  });
}

// SPEC §13.10; reads the clock for the window (§2)
export function runSuggest(args: Extract<Args, { mode: 'suggest' }>, cwd: string, io: Io): number {
  let files: SuggestEntry[] = [];
  let global: Diagnostic[] = [];
  let exitCode = 2;
  try {
    files = suggestAll(args, cwd);
    exitCode = 0;
  } catch (e) {
    if (!(e instanceof Raised)) throw e;
    global = e.diagnostics;
  }
  if (args.json) {
    io.stdout(suggestJsonText({ exitCode, write: args.write, files, diagnostics: global }));
  } else {
    io.stdout(suggestText(files, args.write));
    io.stderr(diagnosticsText(global));
  }
  return exitCode;
}
