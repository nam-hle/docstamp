import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTrees, makeTree } from '../helpers/fixture.ts';
import { readConfig } from '../../src/config/read-config.ts';
import { parseStrictYaml } from '../../src/config/yaml-profile.ts';
import { Raised } from '../../src/core/diagnostics.ts';

afterEach(cleanupTrees);

const read = (yaml: string) => readConfig(makeTree({ 'docsync.yaml': yaml }));
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
    'version: 1\ndependents:\n  b.md:\n    covers: [src/**]\n  a.md:\n    covers: ["x"]\n';
  it('reads bindings in path order with defaults', () => {
    const { config, attached } = read(good);
    expect(config.bindings.map((b) => b.dependent)).toEqual(['a.md', 'b.md']);
    expect(config.useGitignore).toBe(true);
    expect(attached).toEqual([]);
  });
  it('version must be plain 1', () => {
    expect(codes('version: 1.0\ndependents: {}\n')).toEqual(['E_CONFIG_VERSION']);
    expect(codes('version: "1"\ndependents: {}\n')).toEqual(['E_CONFIG_VERSION']);
    expect(codes('dependents: {}\n')).toEqual(['E_CONFIG_VERSION']);
  });
  it('collects every structural error', () => {
    expect(
      codes('version: 1\nfoo: 1\ngitignore: yes-ish\ndependents:\n  a.md: {covers: []}\n'),
    ).toEqual(['E_UNKNOWN_KEY', 'E_CONFIG', 'E_CONFIG']);
  });
  it('bad pattern is attached, not fatal', () => {
    const { attached } = read('version: 1\ndependents:\n  a.md:\n    covers: ["/abs"]\n');
    expect(attached.map((d) => [d.code, d.dependent, d.subject])).toEqual([
      ['E_PATTERN', 'a.md', '/abs'],
    ]);
  });
  it('non-RepoPath key is E_CONFIG', () => {
    expect(codes('version: 1\ndependents:\n  ../x.md: {covers: [a]}\n')).toEqual(['E_CONFIG']);
  });
  it.each(['0x1', '+1', '01'])('version %s rejected', (v) => {
    expect(codes(`version: ${v}\ndependents: {}\n`)).toEqual(['E_CONFIG_VERSION']);
  });
  it('version with trailing comment accepted', () => {
    expect(codes('version: 1 # comment\ndependents: {}\n')).toEqual([]);
  });
  it('empty file is E_CONFIG', () => {
    expect(codes('')).toEqual(['E_CONFIG']);
  });
  it('symlinked docsync.yaml is E_CONFIG_MISSING', () => {
    const root = makeTree({
      'real.yaml': 'version: 1\ndependents: {}\n',
      'docsync.yaml': { link: 'real.yaml' },
    });
    expect(() => readConfig(root)).toThrow(
      expect.objectContaining({
        diagnostics: [expect.objectContaining({ code: 'E_CONFIG_MISSING' })],
      }),
    );
  });
  it('invalid UTF-8 is E_CONFIG', () => {
    const root = makeTree({});
    writeFileSync(join(root, 'docsync.yaml'), Buffer.from([0x76, 0x3a, 0x20, 0xff, 0x0a]));
    expect(() => readConfig(root)).toThrow(
      expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'E_CONFIG' })] }),
    );
  });
  it('missing file', () => {
    expect(() => readConfig(makeTree({}))).toThrow(Raised);
  });
});
