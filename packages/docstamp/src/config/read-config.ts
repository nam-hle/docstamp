import { join } from 'node:path';
import { Raised, diag } from '../core/diagnostics.ts';
import { comparePaths } from '../core/order.ts';
import { closestKey, unknownKeyMessage } from '../core/did-you-mean.ts';
import { isRepoPath } from '../core/repo-path.ts';
import type { Declaration, Config, Diagnostic } from '../core/types.ts';
import type { Host } from '../host/host.ts';
import { parsePattern } from '../pattern/parse.ts';
import { validatePlugins } from '../plugin/plugins.ts';
import type { DocstampPlugin } from '../plugin/types.ts';
import { fromYaml, isYamlMap } from './from-yaml.ts';
import { loadScript } from './script.ts';
import { SELECTED_MESSAGE, dedupeSelected, parseSelected } from './selected.ts';
import { CONFIG_NAMES, PRESET_NAME, isMap, isStrings, type Value } from './value.ts';
import { parseStrictYaml } from './yaml-profile.ts';

const TOP_KEYS = [
  'version',
  'gitignore',
  'ignore',
  'include',
  'presets',
  'default-presets',
  'files',
];
const DEFAULT_INCLUDE: readonly string[] = ['**/*.md'];

const FILE_KEYS = ['dependencies', 'use'];

const EMPTY_USE_MESSAGE =
  'An empty "use" opts out of default presets, and the configuration file names none ' +
  '("default-presets"): remove the "use" key.';

const isNameList = (v: Value | undefined): v is string[] =>
  isStrings(v) && new Set(v).size === v.length;

const optional = (message: string | undefined) => (message === undefined ? {} : { message });

// SPEC §9.3 step 8.2: an entry without "dependencies" whose key is a near miss of it
function missingMessage(value: Value | undefined, dependencies: Value | undefined) {
  if (!isMap(value) || dependencies !== undefined) return undefined;
  const near = [...value.keys()].find((k) => closestKey(k, ['dependencies']) !== null);
  return near === undefined
    ? undefined
    : `The entry has no "dependencies" key; "${near}" is not a key: did you mean "dependencies"?`;
}

// SPEC §9.2
function readYaml(host: Host, path: string): Value {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      host.fs.readFile(path),
    );
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
function readValue(host: Host, root: string): { value: Value; plugins: unknown } | undefined {
  const names = CONFIG_NAMES.filter((name) => host.fs.kind(join(root, name)) !== null);
  if (names.length > 1)
    throw new Raised([diag('E_CONFIG_AMBIGUOUS', { subject: names.join(', ') })]);
  const [name] = names;
  if (name === undefined) return undefined;
  if (host.fs.kind(join(root, name)) !== 'file') throw new Raised([diag('E_CONFIG_MISSING')]);
  const path = join(root, name);
  return name === 'docstamp.yaml'
    ? { value: readYaml(host, path), plugins: undefined }
    : loadScript(path);
}

function collectDeclaration(
  key: string,
  value: Value | undefined,
  defaults: boolean,
  fatal: Diagnostic[],
  attached: Diagnostic[],
  out: Declaration[],
): void {
  if (!isRepoPath(key)) {
    fatal.push(diag('E_CONFIG', { subject: key }));
    return;
  }
  const items = isMap(value) ? value.get('dependencies') : undefined;
  // §9.3 step 8.1, §8.7: Strings are Patterns, Maps are Selected Dependencies
  const entries = Array.isArray(items) ? items.filter((item) => typeof item !== 'string') : [];
  if (!isMap(value) || !Array.isArray(items) || items.length === 0 || !entries.every(isMap)) {
    fatal.push(diag('E_CONFIG', { file: key, ...optional(missingMessage(value, items)) }));
    return;
  }
  const dependencies = items.filter((item) => typeof item === 'string');
  const selected = entries.map(parseSelected);
  if (!selected.every((entry) => entry !== null)) {
    const message = SELECTED_MESSAGE;
    fatal.push(diag('E_CONFIG', { file: key, subject: 'dependencies', message }));
    return;
  }
  const use = value.get('use');
  // §9.3 step 8.3: an empty `use` opts out of the default Presets, so it needs some
  if (use !== undefined && !isNameList(use)) {
    fatal.push(diag('E_CONFIG', { file: key, subject: 'use' }));
  } else if (use !== undefined && use.length === 0 && !defaults) {
    fatal.push(diag('E_CONFIG', { file: key, subject: 'use', message: EMPTY_USE_MESSAGE }));
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
  out.push({
    file: key,
    dependencies,
    ...(selected.length > 0 ? { selected: dedupeSelected(selected) } : {}),
    ...(isStrings(use) ? { use } : {}),
  });
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

// SPEC §9.3 step 6: the default Presets, each a name of `presets`
function collectDefaults(
  value: Value | undefined,
  presets: ReadonlyMap<string, readonly string[]>,
  fatal: Diagnostic[],
): readonly string[] {
  if (value === undefined) return [];
  if (!isNameList(value) || value.length === 0) {
    fatal.push(diag('E_CONFIG', { subject: 'default-presets' }));
    return [];
  }
  for (const name of value) {
    if (!presets.has(name)) {
      fatal.push(
        diag('E_UNKNOWN_PRESET', {
          subject: name,
          message: `"default-presets" names "${name}", which is not a key of "presets": define it there or correct the name.`,
        }),
      );
    }
  }
  return value;
}

// SPEC §9.5 NOTE: `plugins` is a script Carrier member, never a YAML key
const unknownTopKeyMessage = (key: string): string | undefined => {
  if (key === 'dependents') return 'Rename "dependents" to "files".';
  if (key === 'plugins') {
    return (
      'Plugins are functions: register them in docstamp.config.ts or docstamp.config.js, ' +
      'not in YAML.'
    );
  }
  return unknownKeyMessage(key, TOP_KEYS);
};

// SPEC §9.3
export function readConfig(
  host: Host,
  root: string,
): {
  config: Config;
  attached: Diagnostic[];
  present: boolean;
  plugins: DocstampPlugin[];
} {
  const loaded = readValue(host, root);
  const top = loaded?.value;
  if (top === undefined) {
    const config = {
      ignore: [],
      useGitignore: true,
      include: DEFAULT_INCLUDE,
      presets: new Map<string, readonly string[]>(),
      defaultPresets: [],
      declarations: [],
    };
    return { config, attached: [], present: false, plugins: [] };
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
  // SPEC §9.3 step 5: a bad plugin list is collected with the other errors
  let plugins: DocstampPlugin[] = [];
  try {
    if (loaded?.plugins !== undefined) plugins = validatePlugins(loaded.plugins);
  } catch (error) {
    if (!(error instanceof Raised)) throw error;
    fatal.push(...error.diagnostics);
  }
  for (const key of top.keys()) {
    if (!TOP_KEYS.includes(key)) {
      const message = unknownTopKeyMessage(key);
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
  const defaultPresets = collectDefaults(top.get('default-presets'), presets, fatal);
  const declarations: Declaration[] = [];
  const files = top.get('files');
  if (files === undefined) {
    // §9.3 step 7: a near miss of "files" is its E_UNKNOWN_KEY alone
    const typo = [...top.keys()].some(
      (key) => !TOP_KEYS.includes(key) && closestKey(key, TOP_KEYS) === 'files',
    );
    if (!typo) {
      const message = '"files" is required; write "files: {}" for none.';
      fatal.push(diag('E_CONFIG', { subject: 'files', message }));
    }
  } else if (!isMap(files)) {
    fatal.push(diag('E_CONFIG', { subject: 'files' }));
  } else {
    for (const [key, value] of files) {
      collectDeclaration(key, value, top.has('default-presets'), fatal, attached, declarations);
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
      defaultPresets,
      declarations,
    },
    attached,
    present: true,
    plugins,
  };
}
