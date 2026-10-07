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
    expect(config.declarations.map((b) => b.dependent)).toEqual(['a.md', 'b.md']);
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
  it('collects every structural error', () => {
    expect(
      codes('version: 2\nfoo: 1\ngitignore: yes-ish\nfiles:\n  a.md: {dependencies: []}\n'),
    ).toEqual(['E_UNKNOWN_KEY', 'E_CONFIG', 'E_CONFIG']);
  });
  it('bad pattern is attached, not fatal', () => {
    const { attached } = read('version: 2\nfiles:\n  a.md:\n    dependencies: ["/abs"]\n');
    expect(attached.map((d) => [d.code, d.dependent, d.subject])).toEqual([
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
  it('missing file', () => {
    expect(() => readConfig(makeTree({}))).toThrow(Raised);
  });
});
