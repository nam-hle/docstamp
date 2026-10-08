import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';
import { readConfig } from '../../src/config/read-config.ts';
import { parseStrictYaml } from '../../src/config/yaml-profile.ts';
import { Raised } from '../../src/core/diagnostics.ts';

afterEach(cleanupTrees);

const read = (yaml: string) => readConfig(makeTree({ 'docstamp.yaml': yaml }));
const codes = (yaml: string) => {
  try {
    read(yaml);
  } catch (e) {
    if (e instanceof Raised) return e.diagnostics.map((d) => d.code);
  }
  return [];
};

describe('§9.2 YAML profile', () => {
  it.each([
    'a: 1\n---\nb: 2\n',
    'a: &x 1\nb: *x\n',
    'a: !!str 1\n',
    '<<: {a: 1}\n',
    '1: a\n',
    'true: a\n',
    'null: a\n',
    'a: 1\na: 2\n',
    '? [a]\n: 1\n',
  ])('rejects %j', (t) => expect(parseStrictYaml(t)).toBeNull());
  it('accepts BOM and quoted keys', () => {
    expect(parseStrictYaml('﻿"1": a\n')).not.toBeNull();
  });
  it('accepts implicitly typed scalars', () => {
    expect(parseStrictYaml('a: 1\nb: true\nc: null\n')).not.toBeNull();
  });
});

describe('§9.3 readConfig', () => {
  const good =
    'version: 2\nfiles:\n  b.md:\n    dependencies: [src/**]\n  a.md:\n    dependencies: ["x"]\n';
  it('reads declarations in path order with defaults', () => {
    const { config, attached } = read(good);
    expect(config.declarations.map((b) => b.file)).toEqual(['a.md', 'b.md']);
    expect(config.useGitignore).toBe(true);
    expect(attached).toEqual([]);
  });
  it('version must be plain 2', () => {
    expect(codes('version: 2.0\nfiles: {}\n')).toEqual(['E_CONFIG_VERSION']);
    expect(codes('version: "2"\nfiles: {}\n')).toEqual(['E_CONFIG_VERSION']);
    expect(codes('files: {}\n')).toEqual(['E_CONFIG_VERSION']);
  });
  it('a version 1 file raises E_CONFIG_VERSION naming the migration', () => {
    const v1 = 'version: 1\ndependents:\n  a.md:\n    covers: [x]\n';
    expect(codes(v1)).toEqual(['E_CONFIG_VERSION']);
    try {
      read(v1);
    } catch (e) {
      const message = (e as Raised).diagnostics[0]!.message;
      expect(message).toContain('Rename "dependents" to "files" and "covers" to "dependencies"');
      expect(message).toContain('set "version: 2"');
    }
  });
  it('a first configuration file without version is told to add it, not to migrate', () => {
    const message = (text: string) => {
      try {
        read(text);
      } catch (e) {
        return (e as Raised).diagnostics.map((d) => [d.code, d.subject, d.message]);
      }
      throw new Error('not raised');
    };
    expect(message('presets:\n  t: ["!**/*.test.*"]\nfiles: {}\n')).toEqual([
      ['E_CONFIG_VERSION', '', 'Add "version: 2" to the configuration file.'],
    ]);
    expect(message('dependents: {}\n')[0]![2]).toContain('Rename "dependents" to "files"');
    expect(message('version: 3\nfiles: {}\n')[0]![2]).toContain('set "version: 2"');
    expect(message('version: 2\n')).toEqual([
      ['E_CONFIG', 'files', '"files" is required; write "files: {}" for none.'],
    ]);
    expect(message('version: 2\nfils: {}\n')).toEqual([
      ['E_UNKNOWN_KEY', 'fils', 'Remove or correct the key; did you mean "files"?'],
      [
        'E_CONFIG',
        'files',
        '"files" is required; the unknown key "fils" (E_UNKNOWN_KEY) looks like it: ' +
          'did you mean "files"?',
      ],
    ]);
    expect(message('version: 2\nfiles: []\n')[0]![2]).toBe(
      'Fix the configuration file; the key named, if any, is the problem.',
    );
  });
  it('the version 1 keys in a version 2 file are E_UNKNOWN_KEY', () => {
    expect(codes('version: 2\ndependents:\n  a.md:\n    covers: [x]\n')).toEqual([
      'E_UNKNOWN_KEY',
      'E_CONFIG',
    ]);
    expect(codes('version: 2\nfiles:\n  a.md:\n    covers: [x]\n')).toEqual(['E_CONFIG']);
  });
  it('the version 1 keys in a version 2 file get a rename hint', () => {
    const messages = (yaml: string) => {
      try {
        read(yaml);
      } catch (e) {
        return (e as Raised).diagnostics.map((d) => [d.subject, d.message]);
      }
      return [];
    };
    expect(messages('version: 2\ndependents:\n  a.md:\n    covers: [x]\n')).toEqual([
      ['dependents', 'Rename "dependents" to "files".'],
      ['files', expect.any(String)],
    ]);
    expect(
      messages('version: 2\nfiles:\n  a.md:\n    dependencies: [x]\n    covers: [x]\n'),
    ).toEqual([['covers', 'Rename "covers" to "dependencies".']]);
  });
  it('§9.3 NOTE: an unknown key names its near key', () => {
    const messages = (yaml: string) => {
      try {
        read(yaml);
      } catch (e) {
        return (e as Raised).diagnostics.map((d) => [d.code, d.subject, d.message]);
      }
      return [];
    };
    expect(messages('version: 2\nfile: {}\nignores: []\nfiles: {}\n')).toEqual([
      ['E_UNKNOWN_KEY', 'file', 'Remove or correct the key; did you mean "files"?'],
      ['E_UNKNOWN_KEY', 'ignores', 'Remove or correct the key; did you mean "ignore"?'],
    ]);
    expect(
      messages('version: 2\nfiles:\n  a.md:\n    dependencies: [x]\n    uses: [t]\n')[0],
    ).toEqual(['E_UNKNOWN_KEY', 'uses', 'Remove or correct the key; did you mean "use"?']);
    expect(messages('version: 2\nfiles:\n  a.md:\n    dependecies: [x]\n')).toEqual([
      [
        'E_CONFIG',
        '',
        'The entry has no "dependencies" key; "dependecies" is not a key: ' +
          'did you mean "dependencies"?',
      ],
    ]);
    expect(messages('version: 2\nzzzzzz: 1\nfiles: {}\n')).toEqual([
      ['E_UNKNOWN_KEY', 'zzzzzz', 'Remove or correct the key.'],
    ]);
  });
  it('collects every structural error', () => {
    expect(
      codes('version: 2\nfoo: 1\ngitignore: yes-ish\nfiles:\n  a.md: {dependencies: []}\n'),
    ).toEqual(['E_UNKNOWN_KEY', 'E_CONFIG', 'E_CONFIG']);
  });
  it('bad pattern is attached, not fatal', () => {
    const { attached } = read('version: 2\nfiles:\n  a.md:\n    dependencies: ["/abs"]\n');
    expect(attached.map((d) => [d.code, d.file, d.subject])).toEqual([
      ['E_PATTERN', 'a.md', '/abs'],
    ]);
  });
  it('non-RepoPath key is E_CONFIG', () => {
    expect(codes('version: 2\nfiles:\n  ../x.md: {dependencies: [a]}\n')).toEqual(['E_CONFIG']);
  });
  it.each(['0x2', '+2', '02'])('version %s rejected', (v) => {
    expect(codes(`version: ${v}\nfiles: {}\n`)).toEqual(['E_CONFIG_VERSION']);
  });
  it('version with trailing comment accepted', () => {
    expect(codes('version: 2 # comment\nfiles: {}\n')).toEqual([]);
  });
  it('empty file is E_CONFIG', () => {
    expect(codes('')).toEqual(['E_CONFIG']);
  });
  it('symlinked docstamp.yaml is E_CONFIG_MISSING', () => {
    const root = makeTree({
      'real.yaml': 'version: 2\nfiles: {}\n',
      'docstamp.yaml': { link: 'real.yaml' },
    });
    expect(() => readConfig(root)).toThrow(
      expect.objectContaining({
        diagnostics: [expect.objectContaining({ code: 'E_CONFIG_MISSING' })],
      }),
    );
  });
  it('invalid UTF-8 is E_CONFIG', () => {
    const root = makeTree({});
    writeFileSync(join(root, 'docstamp.yaml'), Buffer.from([0x76, 0x3a, 0x20, 0xff, 0x0a]));
    expect(() => readConfig(root)).toThrow(
      expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'E_CONFIG' })] }),
    );
  });
  it('no file is the defaults and not present (§9.3 step 2)', () => {
    expect(readConfig(makeTree({}))).toMatchObject({ present: false, attached: [] });
  });
});

describe('§9.3 include', () => {
  const include = (value: string) => `version: 2\ninclude: ${value}\nfiles: {}\n`;
  it('defaults to **/*.md and is replaced by the key', () => {
    expect(read('version: 2\nfiles: {}\n').config.include).toEqual(['**/*.md']);
    expect(read(include('[docs/**/*.md, "!docs/drafts"]')).config.include).toEqual([
      'docs/**/*.md',
      '!docs/drafts',
    ]);
  });
  it.each(['[]', 'a.md', '[1]', '{}'])('%s is E_CONFIG with subject include', (value) => {
    try {
      read(include(value));
      expect.unreachable();
    } catch (e) {
      expect((e as Raised).diagnostics.map((d) => [d.code, d.subject])).toEqual([
        ['E_CONFIG', 'include'],
      ]);
    }
  });
  it('an invalid pattern is E_PATTERN, not attached to a file', () => {
    try {
      read(include('["/abs/*.md"]'));
      expect.unreachable();
    } catch (e) {
      expect((e as Raised).diagnostics.map((d) => [d.code, d.file, d.subject])).toEqual([
        ['E_PATTERN', '', '/abs/*.md'],
      ]);
    }
  });
});
