import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { Raised } from '../../src/core/diagnostics.ts';
import type { Diagnostic } from '../../src/core/types.ts';
import { builtinPlugins } from '../../src/plugin/builtin.ts';
import { canonicalJson } from '../../src/plugin/canonical.ts';
import { claim, runExtract, validatePlugins } from '../../src/plugin/plugins.ts';

const raised = (run: () => unknown): Diagnostic[] => {
  try {
    run();
  } catch (error) {
    if (error instanceof Raised) return error.diagnostics;
    throw error;
  }
  throw new Error('did not raise');
};

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const [json, yaml] = builtinPlugins;
const jsonHashes = (text: string, select: unknown, path = 'a.json') =>
  json!.extract({ path, text, select: select as never }).hashes;
const yamlHashes = (text: string, select: unknown, path = 'a.yaml') =>
  yaml!.extract({ path, text, select: select as never }).hashes;

describe('§8.8 Builtin Plugins', () => {
  it('are docstamp-json and docstamp-yaml, apiVersion 1', () => {
    expect(builtinPlugins.map((p) => [p.name, p.apiVersion, p.files])).toEqual([
      ['docstamp-json', 1, ['**/*.json']],
      ['docstamp-yaml', 1, ['**/*.yaml', '**/*.yml']],
    ]);
  });

  it('are valid plugins', () => {
    expect(() => validatePlugins([...builtinPlugins])).not.toThrow();
  });
});

describe('§8.7 claim falls back to the builtins', () => {
  it('claims json, yaml and yml files with no registration', () => {
    expect(claim([], 'package.json').name).toBe('docstamp-json');
    expect(claim([], 'deep/dir/ci.yml').name).toBe('docstamp-yaml');
    expect(claim([], 'config.yaml').name).toBe('docstamp-yaml');
  });

  it('still raises E_SELECT for a path nobody claims', () => {
    expect(raised(() => claim([], 'a.md')).map((d) => d.code)).toEqual(['E_SELECT']);
  });

  it('prefers a registered plugin over the builtin for the paths it claims', () => {
    const custom = validatePlugins([
      {
        name: 'pkg',
        apiVersion: 1,
        files: ['package.json'],
        extract: () => ({ hashes: ['x'] }),
      },
    ])[0]!;
    expect(claim([custom], 'package.json')).toBe(custom);
    expect(claim([custom], 'other.json').name).toBe('docstamp-json');
  });
});

describe('§8.8 Extract: the Value Path', () => {
  const text = JSON.stringify({
    scripts: { build: 'tsc', test: 'vitest' },
    items: [{ name: 'a' }, { name: 'b' }],
    'a.b': { c: 1 },
    none: null,
    flag: false,
  });
  const hash = (value: unknown) => [sha(canonicalJson(value as never))];

  it('selects a member by a dotted path', () => {
    expect(jsonHashes(text, 'scripts.build')).toEqual(hash('tsc'));
  });

  it('selects a List element by index', () => {
    expect(jsonHashes(text, 'items.1.name')).toEqual(hash('b'));
    expect(jsonHashes(text, 'items.0')).toEqual(hash({ name: 'a' }));
  });

  it('selects a key with a dot by a bracket', () => {
    expect(jsonHashes(text, '["a.b"].c')).toEqual(hash(1));
    expect(jsonHashes(text, 'scripts["build"]')).toEqual(hash('tsc'));
  });

  it('hashes null and false as values', () => {
    expect(jsonHashes(text, 'none')).toEqual(hash(null));
    expect(jsonHashes(text, 'flag')).toEqual(hash(false));
  });

  it('hashes a whole subtree by the canonical form of its value', () => {
    expect(jsonHashes(text, 'scripts')).toEqual(hash({ build: 'tsc', test: 'vitest' }));
  });

  it('returns no hash for a path that is not there', () => {
    for (const select of ['missing', 'scripts.lint', 'items.2', 'items.01', 'items.x', 'flag.x']) {
      expect(jsonHashes(text, select)).toEqual([]);
    }
  });

  it('does not walk the prototype', () => {
    expect(jsonHashes(text, 'scripts.constructor')).toEqual([]);
    expect(jsonHashes(text, 'toString')).toEqual([]);
  });

  it('throws for a select that is not a Value Path', () => {
    for (const select of [
      '',
      '.a',
      'a.',
      'a..b',
      'a[',
      'a[0]',
      '["a"',
      '[a]',
      1,
      null,
      {},
      ['a'],
    ]) {
      expect(() => jsonHashes(text, select), JSON.stringify(select)).toThrow();
    }
  });
});

describe('§8.8 Extract: json', () => {
  it('is blind to key order and formatting, not to a value', () => {
    const one = jsonHashes('{"a":1,"b":{"x":1,"y":2}}', 'b');
    expect(jsonHashes('{\n  "b": { "y": 2,\n "x": 1 },\n "a": 9\n}', 'b')).toEqual(one);
    expect(jsonHashes('{"b":{"x":1,"y":3}}', 'b')).not.toEqual(one);
  });

  it('takes the last of a repeated key', () => {
    expect(jsonHashes('{"a":1,"a":2}', 'a')).toEqual(jsonHashes('{"a":2}', 'a'));
  });

  it('throws on text that is not JSON', () => {
    expect(() => jsonHashes('{"a":', 'a')).toThrow();
    expect(() => jsonHashes('{"a":1,}', 'a')).toThrow();
    expect(() => jsonHashes('', 'a')).toThrow();
  });
});

describe('§8.8 Extract: yaml', () => {
  const text = [
    '# comment',
    'scripts:',
    '  build: tsc',
    'list: [1, two, {k: v}]',
    'anchored: &base {x: 1}',
    'copy: *base',
    '<<: {merged: 1}',
    '',
  ].join('\n');

  it('selects by the same Value Path', () => {
    expect(yamlHashes(text, 'scripts.build')).toEqual([sha(canonicalJson('tsc'))]);
    expect(yamlHashes(text, 'list.2.k')).toEqual([sha(canonicalJson('v'))]);
  });

  it('resolves an alias to the value it names', () => {
    expect(yamlHashes(text, 'copy')).toEqual(yamlHashes(text, 'anchored'));
  });

  it('treats a merge key as an ordinary key', () => {
    expect(yamlHashes(text, 'merged')).toEqual([]);
    expect(yamlHashes(text, '["<<"].merged')).toEqual([sha(canonicalJson(1))]);
  });

  it('is blind to comments, quoting, style and key order', () => {
    const a = yamlHashes('a: 1\nb:\n  x: "s"\n  y: [1, 2]\n', 'b');
    const b = yamlHashes('# note\nb: {y: [1, 2], x: s}\na: 2\n', 'b');
    expect(b).toEqual(a);
    expect(yamlHashes('b: {y: [1, 3], x: s}\n', 'b')).not.toEqual(a);
  });

  it('keeps the type: the string "1" is not the number 1', () => {
    expect(yamlHashes('a: "1"\n', 'a')).not.toEqual(yamlHashes('a: 1\n', 'a'));
  });

  it('throws on a YAML error or warning, and on more than one document', () => {
    expect(() => yamlHashes('a: 1\na: 2\n', 'a')).toThrow();
    expect(() => yamlHashes('a: *missing\n', 'a')).toThrow();
    expect(() => yamlHashes('a: [1\n', 'a')).toThrow();
    expect(() => yamlHashes('a: 1\n---\na: 2\n', 'a')).toThrow();
  });

  it('throws on a selected value that is not finite or not plain', () => {
    expect(() => yamlHashes('a: .inf\n', 'a')).toThrow();
    expect(() => yamlHashes('a: .nan\n', 'a')).toThrow();
    expect(() => yamlHashes('a: !!binary aGk=\n', 'a')).toThrow();
  });

  it('finds nothing in an empty document', () => {
    expect(yamlHashes('', 'a')).toEqual([]);
  });
});

describe('§8.7 runExtract with a builtin', () => {
  it('turns a throw into E_SELECT', () => {
    const [diagnostic] = raised(() =>
      runExtract(json!, { path: 'a.json', text: '{', select: 'a' }),
    );
    expect(diagnostic?.code).toBe('E_SELECT');
  });
});

describe('§8.8 Extract: focus', () => {
  const focus = (text: string, select: string) =>
    json!.extract({ path: 'a.json', text, select }).focus;

  it('names the value path and the type of the value', () => {
    const text = '{"s":"x","n":1,"b":true,"z":null,"l":[1],"o":{"k":1}}';
    expect(focus(text, 's')).toEqual(['s (string)']);
    expect(focus(text, 'n')).toEqual(['n (number)']);
    expect(focus(text, 'b')).toEqual(['b (boolean)']);
    expect(focus(text, 'z')).toEqual(['z (null)']);
    expect(focus(text, 'l')).toEqual(['l (list)']);
    expect(focus(text, 'o')).toEqual(['o (object)']);
  });

  it('is the same for yaml', () => {
    expect(yaml!.extract({ path: 'a.yaml', text: 'a:\n  b: 1\n', select: 'a.b' }).focus).toEqual([
      'a.b (number)',
    ]);
  });

  it('gives none for a path that is not there', () => {
    expect(json!.extract({ path: 'a.json', text: '{}', select: 'x' })).toEqual({ hashes: [] });
  });
});
