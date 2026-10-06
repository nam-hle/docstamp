import { afterEach, describe, expect, it } from 'vitest';
import { readConfig } from '../../src/config/read-config.ts';
import { CONFIG_NAMES } from '../../src/config/value.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import { defineConfig } from '../../src/lib.ts';
import { cleanupTrees, makeTree, type TreeSpec } from '../helpers/fixture.ts';

afterEach(cleanupTrees);

const YAML =
  'version: 1\nignore: [dist]\ndependents:\n  b.md:\n    covers: [src/**]\n  a.md:\n    covers: [x]\n';
const BODY =
  "{ version: 1, ignore: ['dist'], dependents: { 'b.md': { covers: ['src/**'] }, 'a.md': { covers: ['x'] } } }";
const SOURCES: Record<(typeof CONFIG_NAMES)[number], string> = {
  'docstamp.yaml': YAML,
  'docstamp.config.ts': `const c: { version: 1 } & Record<string, unknown> = ${BODY} as never;\nexport default c;\n`,
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
const VALID = '{ version: 1, dependents: {} }';

describe('§9.1 Carriers', () => {
  it.each(CONFIG_NAMES)('%s normalizes to the same Config', (name) => {
    const { config, attached } = readConfig(makeTree({ [name]: SOURCES[name] }));
    expect(attached).toEqual([]);
    expect(config.ignore).toEqual(['dist']);
    expect(config.useGitignore).toBe(true);
    expect(config.bindings).toEqual([
      { dependent: 'a.md', covers: ['x'] },
      { dependent: 'b.md', covers: ['src/**'] },
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
  it('none is E_CONFIG_MISSING', () => {
    expect(failure({ 'other.txt': '' })).toEqual([['E_CONFIG_MISSING', '']]);
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
    expect(config.bindings).toEqual([]);
  });
  it('the module itself is used without a default export', () => {
    expect(script(`export const version = 1;\nexport const dependents = {};\n`)).toEqual([
      ['E_CONFIG', ''],
    ]);
    expect(failure({ 'docstamp.config.js': `module.exports = ${VALID};\n` })).toEqual([]);
  });
  it('version is the Number 1', () => {
    expect(script('export default { version: "1", dependents: {} };')).toEqual([
      ['E_CONFIG_VERSION', ''],
    ]);
    expect(script('export default { dependents: {} };')).toEqual([['E_CONFIG_VERSION', '']]);
  });
  it('validation of the normalized value still runs', () => {
    expect(script('export default { version: 1, nope: 1, dependents: {} };')).toEqual([
      ['E_UNKNOWN_KEY', 'nope'],
    ]);
    expect(
      script(`export default { version: 1, dependents: { '../x': { covers: ['a'] } } };`),
    ).toEqual([['E_CONFIG', '../x']]);
  });
  it('key order of dependents is irrelevant', () => {
    const { config } = readConfig(
      makeTree({
        'docstamp.config.mjs': `export default { version: 1, dependents: { 'z': { covers: ['a'] }, '1': { covers: ['a'] } } };`,
      }),
    );
    expect(config.bindings.map((b) => b.dependent)).toEqual(['1', 'z']);
  });
  it.each([
    ['a throwing module', 'throw new Error("boom");'],
    ['a syntax error', 'export default {'],
    ['top-level await', 'await Promise.resolve(); export default { version: 1, dependents: {} };'],
    ['a missing import', 'import "./missing.mjs"; export default { version: 1, dependents: {} };'],
    ['no export', ''],
    ['a function export', 'export default () => ({ version: 1, dependents: {} });'],
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
    expect(script(`export default { version: 1, dependents: {}, ${member} };`)).toEqual([
      ['E_CONFIG', subject],
    ]);
  });
  it('a non-enumerable property is E_CONFIG', () => {
    expect(
      script(
        'const c = { version: 1 }; Object.defineProperty(c, "dependents", { value: {} });\nexport default c;',
      ),
    ).toEqual([['E_CONFIG', 'dependents']]);
  });
  it('an array with an extra property is E_CONFIG', () => {
    expect(
      script(
        'const l = ["a"]; l.extra = 1;\nexport default { version: 1, dependents: { "a.md": { covers: l } } };',
      ),
    ).toEqual([['E_CONFIG', 'dependents']]);
  });
  it('a cycle is E_CONFIG', () => {
    expect(
      script('const d = {}; d.self = d;\nexport default { version: 1, dependents: d };'),
    ).toEqual([['E_CONFIG', 'dependents']]);
  });
  it('a shared reference without a cycle is allowed', () => {
    expect(
      failure({
        'docstamp.config.mjs': `const covers = ['a'];\nexport default { version: 1, dependents: { 'a.md': { covers }, 'b.md': { covers } } };`,
      }),
    ).toEqual([]);
  });
  it('a null-prototype object is plain', () => {
    expect(
      failure({
        'docstamp.config.mjs': `export default Object.assign(Object.create(null), { version: 1, dependents: {} });`,
      }),
    ).toEqual([]);
  });
  it('a __proto__ own key is data, not a prototype', () => {
    expect(
      script(`export default JSON.parse('{"version":1,"dependents":{},"__proto__":{"x":1}}');`),
    ).toEqual([['E_UNKNOWN_KEY', '__proto__']]);
  });
  it('a deeply nested value is E_CONFIG, not a crash', () => {
    expect(
      script(
        'let v = []; for (let i = 0; i < 100000; i++) v = [v];\nexport default { version: 1, dependents: {}, x: v };',
      ),
    ).toEqual([['E_CONFIG', '']]);
  });
});

describe('§9.5 defineConfig', () => {
  it('is the identity', () => {
    const config = { version: 1, dependents: { 'a.md': { covers: ['x'] } } } as const;
    expect(defineConfig({ version: 1, dependents: { 'a.md': { covers: ['x'] } } })).toEqual(config);
    const same = { version: 1 as const, dependents: {} };
    expect(defineConfig(same)).toBe(same);
  });
});
