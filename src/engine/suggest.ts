import { comparePaths, sortPaths } from '../core/order.ts';
import { patternMatches, select } from '../pattern/match.ts';
import { literalPath, parsePattern, type ParsedPattern } from '../pattern/parse.ts';
import { mentionedPaths } from './mentions.ts';

// SPEC §12.6
export interface Suggestion {
  readonly pattern: string;
  readonly files: readonly string[];
}

export interface Proposal {
  readonly suggestions: readonly Suggestion[];
  readonly ignored: readonly string[];
}

// SPEC §12.6 step 7: the files at the root that nearly every commit touches
const GENERIC = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.json',
  'deno.jsonc',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'setup.cfg',
  'poetry.lock',
  'uv.lock',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'pom.xml',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gradle.properties',
  'Makefile',
  'CMakeLists.txt',
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'COPYING',
  'CHANGELOG.md',
  '.gitignore',
  '.gitattributes',
  'docstamp.yaml',
  'docstamp.config.ts',
  'docstamp.config.mts',
  'docstamp.config.js',
  'docstamp.config.mjs',
  'docstamp-lock.yaml',
]);
const TSCONFIG = /^tsconfig.*\.json$/u;
const isGeneric = (path: string): boolean =>
  !path.includes('/') && (GENERIC.has(path) || TSCONFIG.test(path));

// SPEC §12.6 step 9
const TEST_SEGMENTS = new Set(['test', 'tests', 'spec', 'specs', '__test__', '__tests__']);
const TEST_SHAPES = ['**/*.test.*', '**/*.spec.*', '**/__test__', '**/__tests__'];
const COLLAPSE_AT = 3;
const SMALL_DIRECTORY = 5;

const GLOB_CHARS = /[*?[{]/u;
const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const parsed = (source: string): ParsedPattern | null => {
  const pattern = parsePattern(source);
  return pattern !== null && !pattern.negated ? pattern : null;
};
const isLiteral = (source: string): boolean => {
  const pattern = parsed(source);
  return pattern !== null && literalPath(pattern) === source;
};

// SPEC §12.6
export function propose(
  doc: string,
  text: string,
  universe: readonly string[],
  isIgnored: (path: string) => boolean,
): Proposal {
  const files = universe.filter((path) => path !== doc);
  const known = new Set(files);
  const directories = new Set(
    files.flatMap((path) => {
      const parts = path.split('/').slice(0, -1);
      return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    }),
  );

  const mentioned = new Set<string>();
  const dirs = new Set<string>();
  const globs = new Set<string>();
  const ignored = new Set<string>();
  for (const candidate of mentionedPaths(text, parentOf(doc))) {
    if (!GLOB_CHARS.test(candidate)) {
      if (!isLiteral(candidate)) continue;
      if (known.has(candidate)) {
        if (!isGeneric(candidate)) mentioned.add(candidate);
      } else if (directories.has(candidate)) dirs.add(candidate);
      else if (candidate !== doc && isIgnored(candidate)) ignored.add(candidate);
      continue;
    }
    const glob = parsed(candidate);
    const named = glob?.segments.some(
      (segment) => segment.kind === 'parts' && segment.atoms.some((atom) => atom.kind === 'lit'),
    );
    if (glob !== null && named && select([glob], files).some((path) => !isGeneric(path))) {
      globs.add(candidate);
    }
  }

  // §12.6 step 8
  const directFiles = new Map<string, string[]>();
  for (const path of mentioned) {
    const parent = parentOf(path);
    if (parent !== '') directFiles.set(parent, [...(directFiles.get(parent) ?? []), path]);
  }
  const kept = new Set(mentioned);
  for (const [dir, direct] of directFiles) {
    const below = files.filter((path) => path.startsWith(`${dir}/`));
    if (direct.length < COLLAPSE_AT) continue;
    if (below.length > SMALL_DIRECTORY && !below.every((path) => mentioned.has(path))) continue;
    dirs.add(dir);
  }

  // §12.6 step 9
  const roots = [...dirs].filter(
    (dir) => ![...dirs].some((o) => o !== dir && dir.startsWith(`${o}/`)),
  );
  const exclusions = new Map<string, string[]>(
    roots.map((dir) => {
      const hasTestSegment = dir.split('/').some((segment) => TEST_SEGMENTS.has(segment));
      const sources = TEST_SHAPES.map((shape) => `!${dir}/${shape}`).filter((source) => {
        const exclusion = parsePattern(source)!;
        return !hasTestSegment && files.some((path) => patternMatches(exclusion, path));
      });
      return [dir, sources];
    }),
  );
  const cutBy = (dir: string, path: string): boolean =>
    exclusions.get(dir)!.some((source) => patternMatches(parsePattern(source)!, path));
  for (const path of mentioned) {
    const covering = roots.find((dir) => path.startsWith(`${dir}/`));
    if (covering !== undefined && !cutBy(covering, path)) kept.delete(path);
  }

  // §12.6 step 10
  const positives = [...new Set([...kept, ...roots, ...globs])].sort(comparePaths);
  const suggestions = positives.flatMap((source): Suggestion[] => {
    const cuts = exclusions.get(source) ?? [];
    const patterns = [source, ...cuts].map((s) => parsePattern(s)!);
    const own: Suggestion = { pattern: source, files: select(patterns, files) };
    return [
      own,
      ...cuts.map((cut) => ({
        pattern: cut,
        files: files.filter((path) => patternMatches(parsePattern(cut)!, path)),
      })),
    ];
  });
  return { suggestions, ignored: sortPaths([...ignored]) };
}
