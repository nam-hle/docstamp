import { describe, expect, it } from 'vitest';
import { evaluate, orphans, resolveCovers, type EngineFs } from '../../src/engine/evaluate.ts';
import { coverHashFrom } from '../../src/hash/hash.ts';
import { Raised, diag } from '../../src/core/diagnostics.ts';
import type { Binding, Lock } from '../../src/core/types.ts';

const H = (c: string) => c.repeat(64);
const files: Record<string, string> = { 'src/a.ts': H('1'), 'src/b.ts': H('2'), 'B.md': H('3') };
const fs: EngineFs = {
  isDependentFile: (p) => p in files || p === 'C.md',
  fileHash: (p) => {
    const h = files[p];
    if (!h) throw new Raised([diag('E_UNREADABLE', { subject: p })]);
    return h;
  },
};
const universe = Object.keys(files).sort();
const bind = (dependent: string, covers: string[]): Binding => ({ dependent, covers });
const lockOf = (e: Record<string, string>): Lock => ({
  entries: new Map(Object.entries(e)),
});
const hashOf = (paths: string[]) => coverHashFrom(paths.map((p) => [p, files[p]!]));

describe('§8.5 resolveCovers', () => {
  it('excludes the dependent itself', () => {
    expect(resolveCovers(bind('src/a.ts', ['src/**']), universe)).toEqual(['src/b.ts']);
  });
  it('every pattern, negated or not, must match', () => {
    try {
      resolveCovers(bind('B.md', ['src/**', '!nope/**', 'src\\cli']), universe);
      expect.unreachable();
    } catch (e) {
      expect((e as Raised).diagnostics.map((d) => [d.code, d.subject])).toEqual([
        ['E_EMPTY_PATTERN', '!nope/**'],
        ['E_EMPTY_PATTERN', 'src\\cli'],
      ]);
    }
  });
  it('empty selection', () => {
    expect(() => resolveCovers(bind('B.md', ['src/**', '!src/**']), universe)).toThrow(Raised);
  });
});

describe('§12.1 evaluate', () => {
  const b = bind('B.md', ['src/**']);
  const current = hashOf(['src/a.ts', 'src/b.ts']);

  it('unrecorded when no entry', () => {
    const r = evaluate(b, universe, lockOf({}), [], fs);
    expect([r.state, r.reasons]).toEqual(['stale', ['unrecorded']]);
  });
  it('ok when hash matches', () => {
    const lock = lockOf({ 'B.md': current });
    const r = evaluate(b, universe, lock, [], fs);
    expect([r.state, r.covered, r.current]).toEqual(['ok', ['src/a.ts', 'src/b.ts'], current]);
  });
  it('content-changed when the hash differs', () => {
    const r = evaluate(b, universe, lockOf({ 'B.md': H('0') }), [], fs);
    expect([r.state, r.reasons]).toEqual(['stale', ['content-changed']]);
  });
  it('a pattern change that keeps the covered set stays ok', () => {
    const same = bind('B.md', ['src/a.ts', 'src/b.ts']);
    const r = evaluate(same, universe, lockOf({ 'B.md': current }), [], fs);
    expect(r.state).toBe('ok');
  });
  it('a pattern change that alters the covered set is content-changed', () => {
    const narrower = bind('B.md', ['src/a.ts']);
    const r = evaluate(narrower, universe, lockOf({ 'B.md': current }), [], fs);
    expect(r.reasons).toEqual(['content-changed']);
  });
  it('missing dependent is invalid but still reports pattern problems', () => {
    const r = evaluate(bind('gone.md', ['nope']), universe, lockOf({}), [], fs);
    expect(r.state).toBe('invalid');
    expect(r.diagnostics.map((d) => d.code)).toEqual([
      'E_DEPENDENT_MISSING',
      'E_EMPTY_COVERS',
      'E_EMPTY_PATTERN',
    ]);
    expect(r.diagnostics.every((d) => d.dependent === 'gone.md')).toBe(true);
  });
  it('attached E_PATTERN skips resolution', () => {
    const att = [diag('E_PATTERN', { dependent: 'B.md', subject: '/x' })];
    const r = evaluate(bind('B.md', ['/x']), universe, lockOf({}), att, fs);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['E_PATTERN']);
  });
  it('hashing problems are collected as invalid', () => {
    const r = evaluate(b, [...universe, 'src/ghost.ts'], lockOf({}), [], fs);
    expect([r.state, r.diagnostics.map((d) => d.code)]).toEqual(['invalid', ['E_UNREADABLE']]);
  });
  it('chain A -> B -> C: C stays ok when only the lock changed', () => {
    const c = bind('C.md', ['B.md']);
    const lock = lockOf({ 'C.md': hashOf(['B.md']) });
    expect(evaluate(c, universe, lock, [], fs).state).toBe('ok');
  });
});

describe('§12.2 orphans', () => {
  it('warns for lock entries without binding', () => {
    const ds = orphans([bind('a', ['x'])], lockOf({ a: H('1'), z: H('1') }));
    expect(ds.map((d) => [d.code, d.subject, d.severity])).toEqual([['W_ORPHAN', 'z', 'warning']]);
  });
});
