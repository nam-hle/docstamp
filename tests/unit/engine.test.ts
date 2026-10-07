import { describe, expect, it } from 'vitest';
import {
  evaluate,
  orphans,
  resolveDependencies,
  type EngineFs,
} from '../../src/engine/evaluate.ts';
import { dependencyHashFrom } from '../../src/hash/hash.ts';
import { Raised, diag } from '../../src/core/diagnostics.ts';
import type { Declaration, Lock } from '../../src/core/types.ts';

const H = (c: string) => c.repeat(64);
const files: Record<string, string> = { 'src/a.ts': H('1'), 'src/b.ts': H('2'), 'B.md': H('3') };
const fs: EngineFs = {
  isStampedFile: (p) => p in files || p === 'C.md',
  fileHash: (p) => {
    const h = files[p];
    if (!h) throw new Raised([diag('E_UNREADABLE', { subject: p })]);
    return h;
  },
};
const universe = Object.keys(files).sort();
const declare = (file: string, dependencies: string[]): Declaration => ({
  file,
  dependencies,
});
const lockOf = (e: Record<string, string>): Lock => ({
  entries: new Map(Object.entries(e)),
});
const hashOf = (paths: string[]) => dependencyHashFrom(paths.map((p) => [p, files[p]!]));

describe('§8.5 resolveDependencies', () => {
  it('excludes the file itself', () => {
    expect(resolveDependencies(declare('src/a.ts', ['src/**']), universe)).toEqual(['src/b.ts']);
  });
  it('a positive pattern that matches nothing is E_EMPTY_PATTERN', () => {
    try {
      resolveDependencies(declare('B.md', ['src/**', 'nope/**', 'src\\cli']), universe);
      expect.unreachable();
    } catch (e) {
      expect((e as Raised).diagnostics.map((d) => [d.code, d.subject])).toEqual([
        ['E_EMPTY_PATTERN', 'nope/**'],
        ['E_EMPTY_PATTERN', 'src\\cli'],
      ]);
    }
  });
  it('an exclusion that matches nothing is a warning and changes nothing', () => {
    const plain = resolveDependencies(declare('B.md', ['src/**']), universe);
    expect(resolveDependencies(declare('B.md', ['src/**', '!nope/**']), universe)).toEqual(plain);
    const r = evaluate(declare('B.md', ['src/**', '!nope/**']), universe, lockOf({}), [], fs);
    expect([r.state, r.reasons, r.resolved]).toEqual(['stale', ['unrecorded'], plain]);
    expect(r.diagnostics.map((d) => [d.code, d.severity, d.file, d.subject])).toEqual([
      ['W_EMPTY_EXCLUSION', 'warning', 'B.md', '!nope/**'],
    ]);
  });
  it('an ok file keeps its warning, and its hash is the one without the exclusion', () => {
    const current = hashOf(['src/a.ts', 'src/b.ts']);
    const r = evaluate(
      declare('B.md', ['src/**', '!nope']),
      universe,
      lockOf({ 'B.md': current }),
      [],
      fs,
    );
    expect([r.state, r.current, r.diagnostics.map((d) => d.code)]).toEqual([
      'ok',
      current,
      ['W_EMPTY_EXCLUSION'],
    ]);
  });
  it('an exclusion that matches a file nothing selected is not warned about', () => {
    const r = evaluate(declare('B.md', ['src/a.ts', '!src/b.ts']), universe, lockOf({}), [], fs);
    expect([r.resolved, r.diagnostics]).toEqual([['src/a.ts'], []]);
  });
  it('the warning does not depend on the order of the patterns', () => {
    for (const patterns of [
      ['!nope', 'src/**'],
      ['src/**', '!nope'],
      ['src/a.ts', '!nope', 'src/b.ts'],
    ]) {
      const r = evaluate(declare('B.md', patterns), universe, lockOf({}), [], fs);
      expect(
        r.diagnostics.map((d) => d.code),
        patterns.join(' '),
      ).toEqual(['W_EMPTY_EXCLUSION']);
    }
  });
  it('an exclusion that matches only the file itself matches nothing', () => {
    const r = evaluate(declare('B.md', ['src/**', '!B.md']), universe, lockOf({}), [], fs);
    expect(r.diagnostics.map((d) => d.subject)).toEqual(['!B.md']);
  });
  it('a file with only exclusions selects nothing: E_EMPTY_DEPENDENCIES, plus the warning', () => {
    const r = evaluate(declare('B.md', ['!nope', '!src/a.ts']), universe, lockOf({}), [], fs);
    expect([r.state, r.diagnostics.map((d) => [d.code, d.severity])]).toEqual([
      'invalid',
      [
        ['E_EMPTY_DEPENDENCIES', 'error'],
        ['W_EMPTY_EXCLUSION', 'warning'],
      ],
    ]);
  });
  it('an invalid file reports the warning next to its errors, in diagnostic order', () => {
    const r = evaluate(
      declare('B.md', ['gone', '!nope', '!also-nope']),
      universe,
      lockOf({}),
      [],
      fs,
    );
    expect(r.diagnostics.map((d) => [d.code, d.subject])).toEqual([
      ['E_EMPTY_DEPENDENCIES', ''],
      ['E_EMPTY_PATTERN', 'gone'],
      ['W_EMPTY_EXCLUSION', '!also-nope'],
      ['W_EMPTY_EXCLUSION', '!nope'],
    ]);
  });
  it('an exclusion that matches only files outside the universe is warned about', () => {
    const r = evaluate(
      declare('B.md', ['src/**', '!src/ignored.ts']),
      universe,
      lockOf({}),
      [],
      fs,
    );
    expect(r.diagnostics.map((d) => d.code)).toEqual(['W_EMPTY_EXCLUSION']);
  });
  it('empty selection', () => {
    expect(() => resolveDependencies(declare('B.md', ['src/**', '!src/**']), universe)).toThrow(
      Raised,
    );
  });
});

describe('§8.5 step 4 W_DUPLICATE_PATTERN', () => {
  it('warns once per distinct repeated pattern and changes nothing else', () => {
    const plain = evaluate(declare('B.md', ['src/**', '!src/b.ts']), universe, lockOf({}), [], fs);
    const r = evaluate(
      declare('B.md', ['src/**', '!src/b.ts', 'src/**', 'src/**', '!src/b.ts']),
      universe,
      lockOf({}),
      [],
      fs,
    );
    expect([r.state, r.resolved, r.current]).toEqual([plain.state, plain.resolved, plain.current]);
    expect(r.diagnostics.map((d) => [d.code, d.severity, d.file, d.subject])).toEqual([
      ['W_DUPLICATE_PATTERN', 'warning', 'B.md', '!src/b.ts'],
      ['W_DUPLICATE_PATTERN', 'warning', 'B.md', 'src/**'],
    ]);
    expect(plain.diagnostics).toEqual([]);
  });
  it('compares the strings exactly', () => {
    const r = evaluate(
      declare('B.md', ['src', 'src/**', 'src/a.ts']),
      universe,
      lockOf({}),
      [],
      fs,
    );
    expect(r.diagnostics).toEqual([]);
  });
  it('an ok file keeps the warning and its exit-relevant state', () => {
    const current = hashOf(['src/a.ts', 'src/b.ts']);
    const r = evaluate(
      declare('B.md', ['src/**', 'src/**']),
      universe,
      lockOf({ 'B.md': current }),
      [],
      fs,
    );
    expect([r.state, r.diagnostics.map((d) => d.code)]).toEqual(['ok', ['W_DUPLICATE_PATTERN']]);
  });
  it('is reported next to the errors of an invalid file', () => {
    const r = evaluate(declare('B.md', ['gone', 'gone']), universe, lockOf({}), [], fs);
    expect(r.diagnostics.map((d) => [d.code, d.subject])).toEqual([
      ['E_EMPTY_DEPENDENCIES', ''],
      ['E_EMPTY_PATTERN', 'gone'],
      ['W_DUPLICATE_PATTERN', 'gone'],
    ]);
  });
});

describe('§8.5 NOTE E_EMPTY_PATTERN names an ignored path', () => {
  const ignoredPaths = new Set(['.npmrc', 'build', 'build/out']);
  const withIgnored: EngineFs = { ...fs, isIgnoredPath: (p) => ignoredPaths.has(p) };
  const messageOf = (pattern: string, engine: EngineFs = withIgnored) => {
    const r = evaluate(declare('B.md', ['src/**', pattern]), universe, lockOf({}), [], engine);
    return r.diagnostics.find((d) => d.code === 'E_EMPTY_PATTERN')?.message;
  };
  it('says so for a literal path that exists and is ignored', () => {
    for (const pattern of ['.npmrc', 'build', 'build/out']) {
      expect(messageOf(pattern), pattern).toContain('it exists but is ignored');
    }
  });
  it('keeps the old message for a missing path, a glob and when nothing can tell', () => {
    const plain = 'Correct or remove the pattern; it matches no file.';
    expect(messageOf('missing.js')).toBe(plain);
    expect(messageOf('build/*')).toBe(plain);
    expect(messageOf('.npmrc', fs)).toBe(plain);
  });
  it('changes only the message: code, subject, state and order stay', () => {
    const run = (engine: EngineFs) =>
      evaluate(declare('B.md', ['.npmrc', 'build', 'src/**']), universe, lockOf({}), [], engine);
    const shape = (r: ReturnType<typeof run>) => [
      r.state,
      r.diagnostics.map((d) => [d.code, d.subject]),
    ];
    expect(shape(run(withIgnored))).toEqual(shape(run(fs)));
    expect(run(withIgnored).diagnostics.map((d) => d.subject)).toEqual(['.npmrc', 'build']);
  });
});

describe('§12.1 evaluate', () => {
  const b = declare('B.md', ['src/**']);
  const current = hashOf(['src/a.ts', 'src/b.ts']);

  it('unrecorded when no entry', () => {
    const r = evaluate(b, universe, lockOf({}), [], fs);
    expect([r.state, r.reasons]).toEqual(['stale', ['unrecorded']]);
  });
  it('ok when hash matches', () => {
    const lock = lockOf({ 'B.md': current });
    const r = evaluate(b, universe, lock, [], fs);
    expect([r.state, r.resolved, r.current]).toEqual(['ok', ['src/a.ts', 'src/b.ts'], current]);
  });
  it('content-changed when the hash differs', () => {
    const r = evaluate(b, universe, lockOf({ 'B.md': H('0') }), [], fs);
    expect([r.state, r.reasons]).toEqual(['stale', ['content-changed']]);
  });
  it('a pattern change that keeps the set of dependencies stays ok', () => {
    const same = declare('B.md', ['src/a.ts', 'src/b.ts']);
    const r = evaluate(same, universe, lockOf({ 'B.md': current }), [], fs);
    expect(r.state).toBe('ok');
  });
  it('a pattern change that alters the set of dependencies is content-changed', () => {
    const narrower = declare('B.md', ['src/a.ts']);
    const r = evaluate(narrower, universe, lockOf({ 'B.md': current }), [], fs);
    expect(r.reasons).toEqual(['content-changed']);
  });
  it('missing file is invalid but still reports pattern problems', () => {
    const r = evaluate(declare('gone.md', ['nope']), universe, lockOf({}), [], fs);
    expect(r.state).toBe('invalid');
    expect(r.diagnostics.map((d) => d.code)).toEqual([
      'E_EMPTY_DEPENDENCIES',
      'E_EMPTY_PATTERN',
      'E_FILE_MISSING',
    ]);
    expect(r.diagnostics.every((d) => d.file === 'gone.md')).toBe(true);
  });
  it('attached E_PATTERN skips resolution', () => {
    const att = [diag('E_PATTERN', { file: 'B.md', subject: '/x' })];
    const r = evaluate(declare('B.md', ['/x']), universe, lockOf({}), att, fs);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['E_PATTERN']);
  });
  it('hashing problems are collected as invalid', () => {
    const r = evaluate(b, [...universe, 'src/ghost.ts'], lockOf({}), [], fs);
    expect([r.state, r.diagnostics.map((d) => d.code)]).toEqual(['invalid', ['E_UNREADABLE']]);
  });
  it('chain A -> B -> C: C stays ok when only the lock changed', () => {
    const c = declare('C.md', ['B.md']);
    const lock = lockOf({ 'C.md': hashOf(['B.md']) });
    expect(evaluate(c, universe, lock, [], fs).state).toBe('ok');
  });
});

describe('§12.2 orphans', () => {
  it('warns for lock entries without declaration', () => {
    const ds = orphans([declare('a', ['x'])], lockOf({ a: H('1'), z: H('1') }));
    expect(ds.map((d) => [d.code, d.subject, d.severity])).toEqual([['W_ORPHAN', 'z', 'warning']]);
  });
});
