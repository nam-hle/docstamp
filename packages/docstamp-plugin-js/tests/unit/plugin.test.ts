import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import plugin from '../../src/index.ts';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const extract = (text: string, select: unknown, path = 'file.ts'): string[] => [
  ...plugin.extract({ path, text, select: select as never }).hashes,
];

// The expected Shape: the statement text with the given bodies removed, written out by hand.
const without = (text: string, ...bodies: string[]): string =>
  bodies.reduce((rest, body) => rest.replace(body, ''), text);

const FN = 'export function abc(a: string): number {\n  return a.length;\n}';
const FN_BODY = '{\n  return a.length;\n}';

describe('§3 The Plugin', () => {
  it('registers for JavaScript and TypeScript files', () => {
    expect(plugin.name).toBe('docstamp-plugin-js');
    expect(plugin.apiVersion).toBe(1);
    expect(plugin.files).toEqual([
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.jsx',
      '**/*.ts',
      '**/*.mts',
      '**/*.cts',
      '**/*.tsx',
    ]);
  });
});

describe('§4 Selector', () => {
  it('takes a name, or an object with name and an optional kind and part', () => {
    const expected = [sha(without(FN, FN_BODY))];
    expect(extract(FN, 'abc')).toEqual(expected);
    expect(extract(FN, { name: 'abc' })).toEqual(expected);
    expect(extract(FN, { name: 'abc', kind: 'function' })).toEqual(expected);
    expect(extract(FN, { name: 'abc', part: 'shape' })).toEqual(expected);
  });

  it('removes leading and trailing blanks from the name', () => {
    expect(extract(FN, ' \tabc \t')).toEqual(extract(FN, 'abc'));
  });

  it('filters by kind', () => {
    expect(extract(FN, { name: 'abc', kind: 'class' })).toEqual([]);
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['a list', ['abc']],
    ['an empty string', ''],
    ['blanks', ' \t '],
    ['an object without name', {}],
    ['an empty name', { name: '' }],
    ['a name that is not a string', { name: 3 }],
    ['an unknown key', { name: 'abc', extra: 1 }],
    ['an unknown kind', { name: 'abc', kind: 'method' }],
    ['a kind that is not a string', { name: 'abc', kind: 1 }],
    ['an unknown part', { name: 'abc', part: 'body' }],
  ])('raises for %s', (_, select) => {
    expect(() => extract(FN, select)).toThrow();
  });
});

describe('§5 Parsing', () => {
  it('reads TypeScript in .ts, .mts, .cts and .tsx files', () => {
    for (const path of ['a.ts', 'a.mts', 'a.cts', 'a.tsx']) {
      expect(extract('export interface I { x: number }', 'I', path)).toHaveLength(1);
    }
  });

  it('reads JSX in .js, .jsx and .tsx files, but not in .ts files', () => {
    const jsx = 'export const A = () => <div />;';
    for (const path of ['a.js', 'a.jsx', 'a.tsx']) expect(extract(jsx, 'A', path)).toHaveLength(1);
    expect(() => extract(jsx, 'A', 'a.ts')).toThrow();
  });

  it('reads an angle-bracket type assertion in a .ts file', () => {
    expect(extract('export const a = <string>b;', 'a', 'a.ts')).toHaveLength(1);
  });

  it('does not read TypeScript in a .js file', () => {
    expect(() => extract('export interface I { x: number }', 'I', 'a.js')).toThrow();
  });

  it('reads CommonJS and ES modules alike', () => {
    expect(extract('const a = 1;\nmodule.exports = { a };\n', 'a', 'a.cjs')).toHaveLength(1);
    expect(extract('export const a = 1;\n', 'a', 'a.mjs')).toHaveLength(1);
  });

  it('reads a hashbang line and decorators', () => {
    expect(extract('#!/usr/bin/env node\nexport const a = 1;\n', 'a', 'a.js')).toHaveLength(1);
    expect(extract('@dec() export class A {}', 'A')).toHaveLength(1);
  });

  it('reads a file that starts with a byte order mark', () => {
    expect(extract(`﻿${FN}`, 'abc')).toEqual(extract(FN, 'abc'));
  });

  it('finds an ambient variable and a qualified namespace', () => {
    expect(extract('declare const x: number;', 'x')).toEqual([sha('declare const x: number;')]);
    expect(extract('namespace A.B { export const c = 1; }', 'A')).toHaveLength(1);
    expect(extract('namespace A.B { export const c = 1; }', 'A.B')).toEqual([]);
  });

  it('finds no declaration in an export default of an expression', () => {
    expect(extract('const a = 1;\nexport default a;\n', 'default')).toEqual([]);
    expect(extract('export default 42;\n', 'default')).toEqual([]);
  });

  it('raises for a file that does not parse', () => {
    expect(() => extract('export function (', 'a')).toThrow();
  });

  it('gives the same hashes for CR LF text as for LF text', () => {
    expect(extract(FN.replaceAll('\n', '\r\n'), 'abc')).toEqual(extract(FN, 'abc'));
  });
});

describe('§6.1 Declarations', () => {
  const TEXT = [
    'export function fn(a: string): void {}',
    'class Cls {}',
    'interface Iface { x: number }',
    'type Alias<T> = { a: T };',
    'enum Color { Red, Green }',
    'const value = 1;',
    'namespace Space { export const z = 1; }',
    "declare module 'external' { export const q: number; }",
  ].join('\n');

  it.each([
    ['fn', 'function'],
    ['Cls', 'class'],
    ['Iface', 'interface'],
    ['Alias', 'type'],
    ['Color', 'enum'],
    ['value', 'variable'],
    ['Space', 'namespace'],
    ['external', 'namespace'],
  ])('finds %s as a %s', (name, kind) => {
    expect(extract(TEXT, { name, kind })).toHaveLength(1);
    expect(extract(TEXT, name)).toHaveLength(1);
  });

  it('finds an exported declaration, with its export keyword in the statement', () => {
    expect(extract('export const a = 1;', 'a')).toEqual([sha('export const a = 1;')]);
    expect(extract('const a = 1;', 'a')).toEqual([sha('const a = 1;')]);
  });

  it('names an anonymous default export default, and a named one by its identifier', () => {
    expect(extract('export default function () {}', 'default')).toHaveLength(1);
    expect(extract('export default class {}', 'default')).toHaveLength(1);
    expect(extract('export default function named() {}', 'named')).toHaveLength(1);
    expect(extract('export default function named() {}', 'default')).toEqual([]);
  });

  it('gives a declaration per declarator, and none for a destructuring pattern', () => {
    const text = 'export const k = 1, l = 2;';
    expect(extract(text, 'k')).toEqual([sha(text)]);
    expect(extract(text, 'l')).toEqual([sha(text)]);
    expect(extract('const { a, b } = obj;', 'a')).toEqual([]);
  });

  it('finds no declaration in an export list, a re-export or an expression', () => {
    const text = "const a = 1;\nexport { a as b };\nexport * from './x';\ncall();\n";
    expect(extract(text, 'b')).toEqual([]);
    expect(extract(text, 'call')).toEqual([]);
  });

  it('takes a constant arrow function for a variable, not a function', () => {
    const text = 'export const f = (a: number): string => String(a);';
    expect(extract(text, { name: 'f', kind: 'function' })).toEqual([]);
    expect(extract(text, { name: 'f', kind: 'variable' })).toHaveLength(1);
  });

  it('does not select a declaration that is not at the top level', () => {
    expect(extract('function outer() { function inner() {} }', 'inner')).toEqual([]);
    expect(extract('if (x) { var y = 1; }', 'y')).toEqual([]);
  });

  it('returns one match per kind when a name is shared, so a kind picks one', () => {
    const text = 'function abc() {}\ninterface abc { x: number }\n';
    expect(extract(text, 'abc')).toHaveLength(2);
    expect(extract(text, { name: 'abc', kind: 'function' })).toEqual([sha('function abc() ')]);
    expect(extract(text, { name: 'abc', kind: 'interface' })).toEqual([
      sha('interface abc { x: number }'),
    ]);
  });
});

describe('§6.2 Groups', () => {
  const OVERLOADED = [
    'export function abc(a: string): void;',
    'export function abc(a: number): void;',
    'export function abc(a: unknown) {',
    '  return a;',
    '}',
  ].join('\n');

  it('takes the overload signatures and the implementation for one match', () => {
    expect(extract(OVERLOADED, 'abc')).toHaveLength(1);
  });

  it('keeps functions of one name that are not adjacent as separate matches', () => {
    const text = 'function a(): void;\nconst x = 1;\nfunction a() {}\n';
    expect(extract(text, 'a')).toHaveLength(2);
    // a statement that declares nothing between them still separates them
    const between = 'function a(): void;\ncall();\nfunction a() {}\n';
    expect(extract(between, 'a')).toHaveLength(2);
  });

  it('keeps two implementations as separate matches', () => {
    expect(extract('function a() {}\nfunction a() {}\n', 'a')).toHaveLength(2);
  });

  it('keeps merged interfaces as separate matches', () => {
    expect(extract('interface A { x: 1 }\ninterface A { y: 2 }\n', 'A')).toHaveLength(2);
  });

  it('groups ambient overloads', () => {
    expect(
      extract('declare function d(a: string): void;\ndeclare function d(a: number): void;\n', 'd'),
    ).toHaveLength(1);
  });
});

describe('§7.2 Shape', () => {
  it('removes the body of a function', () => {
    expect(extract(FN, 'abc')).toEqual([sha(without(FN, FN_BODY))]);
  });

  it('keeps the hash for a changed body, and changes it for a changed signature', () => {
    const base = extract(FN, 'abc');
    expect(extract(FN.replace('return a.length;', 'return 0;'), 'abc')).toEqual(base);
    expect(extract(FN.replace('a: string', 'a: number'), 'abc')).not.toEqual(base);
    expect(extract(FN.replace('): number', '): bigint'), 'abc')).not.toEqual(base);
    expect(extract(FN.replace('(a:', '(b:'), 'abc')).not.toEqual(base);
    expect(extract(FN.replace('export ', ''), 'abc')).not.toEqual(base);
    expect(extract(FN.replace('function', 'async function'), 'abc')).not.toEqual(base);
  });

  it('shapes every signature of an overloaded function and its implementation', () => {
    const text =
      'function a(x: string): void;\nfunction a(x: number): void;\nfunction a(x: any) { body(); }';
    expect(extract(text, 'a')).toEqual([
      sha('function a(x: string): void;\nfunction a(x: number): void;\nfunction a(x: any) '),
    ]);
  });

  describe('a class', () => {
    const CLASS = [
      'export class Foo<T> extends Bar implements Baz {',
      '  private x: number = 1;',
      '  static s = 2;',
      '  constructor(public y: string) {',
      '    super();',
      '  }',
      '  get v(): number {',
      '    return 1;',
      '  }',
      '  m(a: string): number {',
      '    return 2;',
      '  }',
      '  static { init(); }',
      '}',
    ].join('\n');
    const BODIES = [
      '{\n    super();\n  }',
      '{\n    return 1;\n  }',
      '{\n    return 2;\n  }',
      '{ init(); }',
    ];

    it('removes the bodies of its constructor, accessors, methods and static blocks', () => {
      expect(extract(CLASS, 'Foo')).toEqual([sha(without(CLASS, ...BODIES))]);
    });

    it('keeps the hash for a changed method body', () => {
      expect(extract(CLASS.replace('return 2;', 'return 3;'), 'Foo')).toEqual(
        extract(CLASS, 'Foo'),
      );
    });

    it.each([
      ['a method signature', 'm(a: string): number', 'm(a: number): number'],
      ['a property type', 'x: number = 1', 'x: string = 1'],
      ['a property initializer', 'static s = 2', 'static s = 3'],
      ['a modifier', 'private x', 'protected x'],
      ['a parameter property', 'public y', 'private y'],
      ['the heritage', 'extends Bar', 'extends Qux'],
      ['a type parameter', 'Foo<T>', 'Foo<T, U>'],
    ])('changes the hash for %s', (_, from, to) => {
      expect(extract(CLASS.replace(from, to), 'Foo')).not.toEqual(extract(CLASS, 'Foo'));
    });

    it('changes the hash for an added member and a decorator', () => {
      const base = extract(CLASS, 'Foo');
      expect(
        extract(CLASS.replace('  static s = 2;', '  static s = 2;\n  extra = 1;'), 'Foo'),
      ).not.toEqual(base);
      expect(extract(`@dec() ${CLASS}`, 'Foo')).not.toEqual(base);
    });
  });

  describe('a variable', () => {
    it('removes the body of an arrow function, block or expression', () => {
      const expression = 'export const f = (a: number): string => String(a);';
      expect(extract(expression, 'f')).toEqual([sha(without(expression, 'String(a)'))]);
      const block = 'export const g = async (a: number) => {\n  return a;\n};';
      expect(extract(block, 'g')).toEqual([sha(without(block, '{\n  return a;\n}'))]);
    });

    it('removes the body of a function expression', () => {
      const text = 'export const g = function (a: number) {\n  return a;\n};';
      expect(extract(text, 'g')).toEqual([sha(without(text, '{\n  return a;\n}'))]);
    });

    it('keeps the hash for a changed function body and changes it for a changed signature', () => {
      const text = 'export const f = (a: number): string => String(a);';
      const base = extract(text, 'f');
      expect(extract(text.replace('String(a)', 'a.toFixed()'), 'f')).toEqual(base);
      expect(extract(text.replace('a: number', 'a: string'), 'f')).not.toEqual(base);
    });

    it('keeps the initializer of a constant that is not a function', () => {
      const text = 'export const VERSION = "1.0";';
      expect(extract(text, 'VERSION')).toEqual([sha(text)]);
      expect(extract(text.replace('1.0', '2.0'), 'VERSION')).not.toEqual(extract(text, 'VERSION'));
    });

    it('keeps a function nested in another expression', () => {
      const text = 'export const x = wrap(() => 1);';
      expect(extract(text, 'x')).toEqual([sha(text)]);
    });
  });

  it('is the whole text of an interface, a type, an enum and a namespace', () => {
    for (const text of [
      'export interface I { x: number; y(): void }',
      'export type T = { a: string } | null;',
      'export enum E { A = 1, B = "b" }',
      'export namespace N { export function f() { return 1; } }',
    ]) {
      const name = /(?:interface|type|enum|namespace) (\w+)/u.exec(text)![1]!;
      expect(extract(text, name)).toEqual([sha(text)]);
    }
  });

  it('leaves out the comments above and after the statement, and keeps those inside it', () => {
    const base = extract(FN, 'abc');
    expect(extract(`/** about */\n${FN}\n// after\n`, 'abc')).toEqual(base);
    expect(extract(FN.replace('(a: string)', '(a: string /* in */)'), 'abc')).not.toEqual(base);
  });
});

describe('§7.1 Source', () => {
  const source = (text: string, name = 'abc') => extract(text, { name, part: 'source' });

  it('is the text of the statement, body included', () => {
    expect(source(FN)).toEqual([sha(FN)]);
  });

  it('changes for a changed body', () => {
    expect(source(FN.replace('return a.length;', 'return 0;'))).not.toEqual(source(FN));
  });

  it('spans from the first overload to the implementation', () => {
    const text = 'function a(x: string): void;\n// between\nfunction a(x: any) { body(); }';
    expect(source(text, 'a')).toEqual([sha(text)]);
  });

  it('leaves out the comment above the statement', () => {
    expect(source(`/** about */\n${FN}`)).toEqual([sha(FN)]);
  });
});

describe('§8 Extract', () => {
  it('returns one hash per matching group, in source order', () => {
    const text = 'class A {}\nfunction abc() {}\ninterface abc { x: 1 }\n';
    expect(extract(text, 'abc')).toEqual([sha('function abc() '), sha('interface abc { x: 1 }')]);
  });

  it('returns no hash when nothing matches', () => {
    expect(extract(FN, 'missing')).toEqual([]);
    expect(extract('', 'abc')).toEqual([]);
  });

  it('returns lower-case hexadecimal SHA-256 digests', () => {
    expect(extract(FN, 'abc')[0]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('keeps the hash for an edit elsewhere in the file', () => {
    const base = extract(FN, 'abc');
    expect(extract(`const other = 1;\n${FN}\nexport class Z {}\n`, 'abc')).toEqual(base);
  });
});
