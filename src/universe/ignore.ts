import { compileGlob } from '../pattern/match.ts';
import { parsePattern } from '../pattern/parse.ts';

export interface IgnoreRule {
  scope: string;
  negated: boolean;
  dirOnly: boolean;
  anchored: boolean;
  re: RegExp;
}

function trimTrailingSpaces(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === ' ' && line[end - 2] !== '\\') end--;
  return line.slice(0, end);
}

// SPEC §7.3
export function parseIgnoreLines(text: string, scope: string): IgnoreRule[] {
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  const out: IgnoreRule[] = [];
  for (const rawLine of body.split('\n')) {
    let line = trimTrailingSpaces(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine);
    if (line === '' || line.startsWith('#')) continue;
    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const parsed = parsePattern(line.startsWith('!') ? `\\${line}` : line, { alternation: false });
    if (!parsed || parsed.negated) continue;
    out.push({ scope, negated, dirOnly, anchored, re: compileGlob(parsed.segments) });
  }
  return out;
}

function ruleMatches(rule: IgnoreRule, path: string): boolean {
  const prefix = rule.scope === '' ? '' : `${rule.scope}/`;
  if (!path.startsWith(prefix) || path === rule.scope) return false;
  const rel = path.slice(prefix.length);
  return rule.anchored ? rule.re.test(rel) : rule.re.test(rel.slice(rel.lastIndexOf('/') + 1));
}

// SPEC §7.3
export function isIgnored(path: string, isDir: boolean, rules: readonly IgnoreRule[]): boolean {
  let result = false;
  for (const rule of rules) {
    if ((!rule.dirOnly || isDir) && ruleMatches(rule, path)) result = !rule.negated;
  }
  return result;
}
