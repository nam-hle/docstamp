import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import { comparePaths } from '../core/order.ts';
import { isRepoPath } from '../core/repo-path.ts';
import type { Declaration, Config, Diagnostic } from '../core/types.ts';
import { parsePattern } from '../pattern/parse.ts';
import { loadScript } from './script.ts';
import { CONFIG_NAMES, isMap, isStrings, type Value } from './value.ts';
import { parseStrictYaml, type YamlMap, type YamlValue } from './yaml-profile.ts';

const TOP_KEYS = ['version', 'gitignore', 'ignore', 'include', 'files'];
const DEFAULT_INCLUDE: readonly string[] = ['**/*.md'];

const optional = (message: string | undefined) => (message === undefined ? {} : { message });

const hasEntry = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const isFile = (path: string): boolean => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};

const isYamlMap = (v: YamlValue): v is YamlMap =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const fromYaml = (v: YamlValue): Value => {
  if (Array.isArray(v)) return v.map(fromYaml);
  if (isYamlMap(v)) {
    return new Map([...v.entries].map(([key, info]) => [key, fromYaml(info.value)]));
  }
  return v;
};

// SPEC §9.2
function readYaml(path: string): Value {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
  } catch {
    throw new Raised([diag('E_CONFIG')]);
  }
  const doc = parseStrictYaml(text);
  const value = doc ? fromYaml(doc.value) : null;
  if (!doc || !isMap(value)) throw new Raised([diag('E_CONFIG')]);
  const version = isYamlMap(doc.value) ? doc.value.entries.get('version') : undefined;
  if (version) value.set('version', version.plainSource === '2' ? 2 : null);
  return value;
}

// SPEC §9.3 steps 2 and 3; undefined when there is no configuration file
function readValue(root: string): Value | undefined {
  const names = CONFIG_NAMES.filter((name) => hasEntry(join(root, name)));
  if (names.length > 1)
    throw new Raised([diag('E_CONFIG_AMBIGUOUS', { subject: names.join(', ') })]);
  const [name] = names;
  if (name === undefined) return undefined;
  if (!isFile(join(root, name))) throw new Raised([diag('E_CONFIG_MISSING')]);
  const path = join(root, name);
  return name === 'docstamp.yaml' ? readYaml(path) : loadScript(path);
}

function collectDeclaration(
  key: string,
  value: Value | undefined,
  fatal: Diagnostic[],
  attached: Diagnostic[],
  out: Declaration[],
): void {
  if (!isRepoPath(key)) {
    fatal.push(diag('E_CONFIG', { subject: key }));
    return;
  }
  const dependencies = isMap(value) ? value.get('dependencies') : undefined;
  if (!isMap(value) || !isStrings(dependencies) || dependencies.length === 0) {
    fatal.push(diag('E_CONFIG', { file: key }));
    return;
  }
  for (const k of value.keys()) {
    if (k !== 'dependencies') {
      const message = k === 'covers' ? 'Rename "covers" to "dependencies".' : undefined;
      fatal.push(diag('E_UNKNOWN_KEY', { file: key, subject: k, ...optional(message) }));
    }
  }
  for (const pattern of dependencies) {
    if (!parsePattern(pattern)) {
      attached.push(diag('E_PATTERN', { file: key, subject: pattern }));
    }
  }
  out.push({ file: key, dependencies });
}

// SPEC §9.3
export function readConfig(root: string): {
  config: Config;
  attached: Diagnostic[];
  present: boolean;
} {
  const top = readValue(root);
  if (top === undefined) {
    const config = { ignore: [], useGitignore: true, include: DEFAULT_INCLUDE, declarations: [] };
    return { config, attached: [], present: false };
  }
  if (!isMap(top)) throw new Raised([diag('E_CONFIG')]);
  if (top.get('version') !== 2) throw new Raised([diag('E_CONFIG_VERSION')]);

  const fatal: Diagnostic[] = [];
  const attached: Diagnostic[] = [];
  for (const key of top.keys()) {
    if (!TOP_KEYS.includes(key)) {
      const message = key === 'dependents' ? 'Rename "dependents" to "files".' : undefined;
      fatal.push(diag('E_UNKNOWN_KEY', { subject: key, ...optional(message) }));
    }
  }
  const gitignore = top.get('gitignore');
  if (gitignore !== undefined && typeof gitignore !== 'boolean') {
    fatal.push(diag('E_CONFIG', { subject: 'gitignore' }));
  }
  const ignore = top.get('ignore');
  if (ignore !== undefined && !isStrings(ignore)) {
    fatal.push(diag('E_CONFIG', { subject: 'ignore' }));
  }
  const include = top.get('include');
  if (include !== undefined && (!isStrings(include) || include.length === 0)) {
    fatal.push(diag('E_CONFIG', { subject: 'include' }));
  } else if (isStrings(include)) {
    for (const pattern of include) {
      if (!parsePattern(pattern)) fatal.push(diag('E_PATTERN', { subject: pattern }));
    }
  }

  const declarations: Declaration[] = [];
  const files = top.get('files');
  if (!isMap(files)) {
    fatal.push(diag('E_CONFIG', { subject: 'files' }));
  } else {
    for (const [key, value] of files) {
      collectDeclaration(key, value, fatal, attached, declarations);
    }
  }
  if (fatal.length > 0) throw new Raised(fatal);
  declarations.sort((a, b) => comparePaths(a.file, b.file));
  return {
    config: {
      ignore: isStrings(ignore) ? ignore : [],
      useGitignore: gitignore !== false,
      include: isStrings(include) ? include : DEFAULT_INCLUDE,
      declarations,
    },
    attached,
    present: true,
  };
}
