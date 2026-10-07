import { afterEach, describe, expect, it } from 'vitest';
import { readConfig } from '../../src/config/read-config.ts';
import { CONFIG_NAMES } from '../../src/config/value.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import { defineConfig } from '../../src/lib.ts';
import { cleanupTrees, makeTree, type TreeSpec } from '../helpers/fixture.ts';

afterEach(cleanupTrees);

const YAML =
  'version: 2\nignore: [dist]\nfiles:\n  b.md:\n    dependencies: [src/**]\n  a.md:\n    dependencies: [x]\n';
const BODY =
  "{ version: 2, ignore: ['dist'], files: { 'b.md': { dependencies: ['src/**'] }, 'a.md': { dependencies: ['x'] } } }";
const SOURCES: Record<(typeof CONFIG_NAMES)[number], string> = {
  'docstamp.yaml': YAML,
  'docstamp.config.ts': `const c: { version: 2 } & Record<string, unknown> = ${BODY} as never;\nexport default c;\n`,
  'docstamp.config.mts': `export default ${BODY} satisfies object;\n`,
  'docstamp.config.js': `module.exports = ${BODY};\n`,
  'docstamp.config.mjs': `export default ${BODY};\n`,
};

const failure = (spec: TreeSpec) => {
  try {
    readConfig(makeTree(spec));
  } catch (e) {
    if (e instanceof Raised) return e.diagnostics.map((d) => [d.code, d.subject]);
    throw e;
  }
  return [];
};
const script = (body: string) => failure({ 'docstamp.config.mjs': body });
const VALID = '{ version: 2, files: {} }';

describe('§9.1 Carriers', () => {
  it.each(CONFIG_NAMES)('%s normalizes to the same Config', (name) => {
    const { config, attached } = readConfig(makeTree({ [name]: SOURCES[name] }));
    expect(attached).toEqual([]);
    expect(config.ignore).toEqual(['dist']);
    expect(config.useGitignore).toBe(true);
    expect(config.declarations).toEqual([
      { file: 'a.md', dependencies: ['x'] },
      { file: 'b.md', dependencies: ['src/**'] },
    ]);
  });
  it('discovery order is the documented one', () => {
    expect(CONFIG_NAMES).toEqual([
      'docstamp.yaml',
      'docstamp.config.ts',
      'docstamp.config.mts',
      'docstamp.config.js',
      'docstamp.config.mjs',
    ]);
  });
});

describe('§9.3 discovery', () => {
  it('more than one configuration file is E_CONFIG_AMBIGUOUS naming them', () => {
    expect(failure({ 'docstamp.config.ts': 'export default {}', 'docstamp.yaml': YAML })).toEqual([
      ['E_CONFIG_AMBIGUOUS', 'docstamp.yaml, docstamp.config.ts'],
    ]);
  });
  it('a directory with a configuration name still counts toward ambiguity', () => {
    expect(failure({ 'docstamp.yaml': YAML, 'docstamp.config.js/x': '' })).toEqual([
      ['E_CONFIG_AMBIGUOUS', 'docstamp.yaml, docstamp.config.js'],
    ]);
  });
  it('none is the defaults, not present (§9.3 step 2)', () => {
    const { config, attached, present } = readConfig(makeTree({ 'other.txt': '' }));
    expect({ present, attached }).toEqual({ present: false, attached: [] });
    expect(config).toEqual({
      ignore: [],
      useGitignore: true,
      include: ['**/*.md'],
      declarations: [],
    });
  });
  it.each(CONFIG_NAMES.slice(1))('symlinked %s is E_CONFIG_MISSING', (name) => {
    expect(failure({ 'real.txt': SOURCES[name], [name]: { link: 'real.txt' } })).toEqual([
      ['E_CONFIG_MISSING', ''],
    ]);
  });
  it('a directory named like a configuration file is E_CONFIG_MISSING', () => {
    expect(failure({ 'docstamp.config.ts/x': '' })).toEqual([['E_CONFIG_MISSING', '']]);
  });
});

describe('§9.5 script carriers', () => {
  it('a named default export wins over the module itself', () => {
    const { config } = readConfig(
      makeTree({ 'docstamp.config.js': `exports.default = ${VALID}; exports.other = 1;\n` }),
    );
    expect(config.declarations).toEqual([]);
  });
  it('the module itself is used without a default export', () => {
    expect(script(`export const version = 2;\nexport const files = {};\n`)).toEqual([
      ['E_CONFIG', ''],
    ]);
    expect(failure({ 'docstamp.config.js': `module.exports = ${VALID};\n` })).toEqual([]);
  });
  it('version is the Number 2', () => {
    expect(script('export default { version: "2", files: {} };')).toEqual([
      ['E_CONFIG_VERSION', ''],
    ]);
    expect(script('export default { files: {} };')).toEqual([['E_CONFIG_VERSION', '']]);
  });
  it('validation of the normalized value still runs', () => {
    expect(script('export default { version: 2, nope: 1, files: {} };')).toEqual([
      ['E_UNKNOWN_KEY', 'nope'],
    ]);
    expect(
      script(`export default { version: 2, files: { '../x': { dependencies: ['a'] } } };`),
    ).toEqual([['E_CONFIG', '../x']]);
  });
  it('key order of files is irrelevant', () => {
    const { config } = readConfig(
      makeTree({
        'docstamp.config.mjs': `export default { version: 2, files: { 'z': { dependencies: ['a'] }, '1': { dependencies: ['a'] } } };`,
      }),
    );
    expect(config.declarations.map((b) => b.file)).toEqual(['1', 'z']);
  });
  it.each([
    ['a throwing module', 'throw new Error("boom");'],
    ['a syntax error', 'export default {'],
    ['top-level await', 'await Promise.resolve(); export default { version: 2, files: {} };'],
    ['a missing import', 'import "./missing.mjs"; export default { version: 2, files: {} };'],
    ['no export', ''],
    ['a function export', 'export default () => ({ version: 2, files: {} });'],
    ['an array export', 'export default [];'],
    ['a string export', 'export default "x";'],
    ['a null export', 'export default null;'],
  ])('%s is E_CONFIG', (_name, body) => {
    expect(script(body)).toEqual([['E_CONFIG', '']]);
  });
  it.each([
    ['a function', 'x: () => 1', 'x'],
    ['a getter', 'get x() { return 1; }', 'x'],
    ['a setter', 'set x(v) {}', 'x'],
    ['a class instance', 'x: new (class A {})()', 'x'],
    ['a Date', 'x: new Date(0)', 'x'],
    ['a Map', 'x: new Map()', 'x'],
    ['a symbol', 'x: Symbol("s")', 'x'],
    ['a symbol key', '[Symbol("s")]: 1', ''],
    ['undefined', 'x: undefined', 'x'],
    ['NaN', 'x: NaN', 'x'],
    ['Infinity', 'x: Infinity', 'x'],
    ['a bigint', 'x: 1n', 'x'],
    ['a sparse array', 'x: [1, , 2]', 'x'],
    ['a nested class instance', 'x: { y: [{ z: new (class B {})() }] }', 'x'],
    ['a nested undefined', 'x: { y: undefined }', 'x'],
  ])('%s is E_CONFIG naming the top-level key', (_name, member, subject) => {
    expect(script(`export default { version: 2, files: {}, ${member} };`)).toEqual([
      ['E_CONFIG', subject],
    ]);
  });
  it('a non-enumerable property is E_CONFIG', () => {
    expect(
      script(
        'const c = { version: 2 }; Object.defineProperty(c, "files", { value: {} });\nexport default c;',
      ),
    ).toEqual([['E_CONFIG', 'files']]);
  });
  it('an array with an extra property is E_CONFIG', () => {
    expect(
      script(
        'const l = ["a"]; l.extra = 1;\nexport default { version: 2, files: { "a.md": { dependencies: l } } };',
      ),
    ).toEqual([['E_CONFIG', 'files']]);
  });
  it('a cycle is E_CONFIG', () => {
    expect(script('const d = {}; d.self = d;\nexport default { version: 2, files: d };')).toEqual([
      ['E_CONFIG', 'files'],
    ]);
  });
  it('a shared reference without a cycle is allowed', () => {
    expect(
      failure({
        'docstamp.config.mjs': `const dependencies = ['a'];\nexport default { version: 2, files: { 'a.md': { dependencies }, 'b.md': { dependencies } } };`,
      }),
    ).toEqual([]);
  });
  it('a null-prototype object is plain', () => {
    expect(
      failure({
        'docstamp.config.mjs': `export default Object.assign(Object.create(null), { version: 2, files: {} });`,
      }),
    ).toEqual([]);
  });
  it('a __proto__ own key is data, not a prototype', () => {
    expect(
      script(`export default JSON.parse('{"version":2,"files":{},"__proto__":{"x":1}}');`),
    ).toEqual([['E_UNKNOWN_KEY', '__proto__']]);
  });
  it('§9.5 step 3: a Proxy object is E_CONFIG', () => {
    expect(script('export default { version: 2, files: {}, x: new Proxy({}, {}) };')).toEqual([
      ['E_CONFIG', 'x'],
    ]);
    expect(script('export default new Proxy({ version: 2, files: {} }, {});')).toEqual([
      ['E_CONFIG', ''],
    ]);
  });
  it('§9.5 step 3: a Proxy array is E_CONFIG', () => {
    expect(
      script(
        'export default { version: 2, files: { "a.md": { dependencies: new Proxy(["a"], {}) } } };',
      ),
    ).toEqual([['E_CONFIG', 'files']]);
  });
  it('§9.5 NOTE: a deeply nested value is E_CONFIG, not a crash', () => {
    expect(
      script(
        'let v = []; for (let i = 0; i < 100000; i++) v = [v];\nexport default { version: 2, files: {}, x: v };',
      ),
    ).toEqual([['E_CONFIG', '']]);
  });
});

describe('§9.5 defineConfig', () => {
  it('is the identity', () => {
    const config = { version: 2, files: { 'a.md': { dependencies: ['x'] } } } as const;
    expect(defineConfig({ version: 2, files: { 'a.md': { dependencies: ['x'] } } })).toEqual(
      config,
    );
    const same = { version: 2 as const, files: {} };
    expect(defineConfig(same)).toBe(same);
  });
});
