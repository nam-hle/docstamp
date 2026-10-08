import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import { comparePaths } from '../core/order.ts';
import { closestKey, unknownKeyMessage } from '../core/did-you-mean.ts';
import { isRepoPath } from '../core/repo-path.ts';
import type { Declaration, Config, Diagnostic } from '../core/types.ts';
import { parsePattern } from '../pattern/parse.ts';
import { loadScript } from './script.ts';
import { CONFIG_NAMES, PRESET_NAME, isMap, isStrings, type Value } from './value.ts';
import { parseStrictYaml, type YamlMap, type YamlValue } from './yaml-profile.ts';

const TOP_KEYS = ['version', 'gitignore', 'ignore', 'include', 'presets', 'files'];
const DEFAULT_INCLUDE: readonly string[] = ['**/*.md'];

const FILE_KEYS = ['dependencies', 'use'];

const optional = (message: string | undefined) => (message === undefined ? {} : { message });

// SPEC §9.3 step 8.2: an entry without "dependencies" whose key is a near miss of it
function missingMessage(value: Value | undefined, dependencies: Value | undefined) {
  if (!isMap(value) || dependencies !== undefined) return undefined;
  const near = [...value.keys()].find((k) => closestKey(k, ['dependencies']) !== null);
  return near === undefined
    ? undefined
    : `The entry has no "dependencies" key; "${near}" is not a key: did you mean "dependencies"?`;
}

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
    fatal.push(diag('E_CONFIG', { file: key, ...optional(missingMessage(value, dependencies)) }));
    return;
  }
  const use = value.get('use');
  if (
    use !== undefined &&
    (!isStrings(use) || use.length === 0 || new Set(use).size < use.length)
  ) {
    fatal.push(diag('E_CONFIG', { file: key, subject: 'use' }));
  }
  for (const k of value.keys()) {
    if (k !== 'dependencies' && k !== 'use') {
      const message =
        k === 'covers' ? 'Rename "covers" to "dependencies".' : unknownKeyMessage(k, FILE_KEYS);
      fatal.push(diag('E_UNKNOWN_KEY', { file: key, subject: k, ...optional(message) }));
    }
  }
  for (const pattern of dependencies) {
    if (!parsePattern(pattern)) {
      attached.push(diag('E_PATTERN', { file: key, subject: pattern }));
    }
  }
  out.push({ file: key, dependencies, ...(isStrings(use) ? { use } : {}) });
}

// SPEC §9.3 step 6
function collectPresets(
  presets: Value | undefined,
  fatal: Diagnostic[],
): Map<string, readonly string[]> {
  const found = new Map<string, readonly string[]>();
  if (presets === undefined) return found;
  if (!isMap(presets)) {
    fatal.push(diag('E_CONFIG', { subject: 'presets' }));
    return found;
  }
  for (const [name, list] of presets) {
    if (!PRESET_NAME.test(name) || !isStrings(list) || list.length === 0) {
      fatal.push(diag('E_CONFIG', { subject: `presets.${name}` }));
      continue;
    }
    for (const pattern of list) {
      if (!parsePattern(pattern)) fatal.push(diag('E_PATTERN', { subject: pattern }));
    }
    found.set(name, list);
  }
  return found;
}

// SPEC §9.3
export function readConfig(root: string): {
  config: Config;
  attached: Diagnostic[];
  present: boolean;
} {
  const top = readValue(root);
  if (top === undefined) {
    const config = {
      ignore: [],
      useGitignore: true,
      include: DEFAULT_INCLUDE,
      presets: new Map<string, readonly string[]>(),
      declarations: [],
    };
    return { config, attached: [], present: false };
  }
  if (!isMap(top)) throw new Raised([diag('E_CONFIG')]);
  if (top.get('version') !== 2) {
    // §9.3 step 4: name the migration only when an old key shows a version 1 file
    const fresh = !top.has('version') && !top.has('dependents');
    const message = fresh ? 'Add "version: 2" to the configuration file.' : undefined;
    throw new Raised([diag('E_CONFIG_VERSION', optional(message))]);
  }

  const fatal: Diagnostic[] = [];
  const attached: Diagnostic[] = [];
  for (const key of top.keys()) {
    if (!TOP_KEYS.includes(key)) {
      const message =
        key === 'dependents' ? 'Rename "dependents" to "files".' : unknownKeyMessage(key, TOP_KEYS);
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

  const presets = collectPresets(top.get('presets'), fatal);
  const declarations: Declaration[] = [];
  const files = top.get('files');
  if (files === undefined) {
    // §9.3 step 7: a near miss of "files" is reported once more as E_UNKNOWN_KEY
    const typo = [...top.keys()].find(
      (key) => !TOP_KEYS.includes(key) && closestKey(key, TOP_KEYS) === 'files',
    );
    const message =
      typo === undefined
        ? '"files" is required; write "files: {}" for none.'
        : `"files" is required; the unknown key "${typo}" (E_UNKNOWN_KEY) looks like it: ` +
          'did you mean "files"?';
    fatal.push(diag('E_CONFIG', { subject: 'files', message }));
  } else if (!isMap(files)) {
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
      presets,
      declarations,
    },
    attached,
    present: true,
  };
}
