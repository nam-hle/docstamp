import { describe, expect, it } from 'vitest';
import { Raised, diag } from '../../src/core/diagnostics.ts';
import type { Declaration, Json, Lock, SelectedEntry } from '../../src/core/types.ts';
import { dependentsOf } from '../../src/engine/reverse.ts';
import { evaluate, type EngineFs } from '../../src/engine/evaluate.ts';
import { dependencyHashFrom } from '../../src/hash/hash.ts';

const newLock = (): Lock & { entries: Map<string, string> } => ({
  entries: new Map<string, string>(),
});
const fsWith = (
  extract: (path: string, select: Json) => string[],
  fileHash: (path: string) => string = (path) => `hash-of-${path}`,
): EngineFs => ({
  isStampedFile: () => true,
  fileHash,
  extractHashes: extract,
});
const entry = (over: Partial<SelectedEntry> = {}): SelectedEntry => ({
  path: 'docs/guide.md',
  select: 'Install',
  ...over,
});
const decl = (selected: SelectedEntry[], dependencies: string[] = []): Declaration => ({
  file: 'CLAUDE.md',
  dependencies,
  selected,
});
const universe = ['CLAUDE.md', 'docs/guide.md', 'src/a.ts'];
const run = (b: Declaration, extract: (path: string, select: Json) => string[], lock = newLock()) =>
  evaluate(b, universe, lock, [], fsWith(extract));

describe('§8.7 / §12.1 selected dependencies', () => {
  it('is ok with one fragment once recorded', () => {
    const lock = newLock();
    const result = run(decl([entry()]), () => ['x'], lock);
    expect(result.state).toBe('stale');
    expect(result.reasons).toEqual(['unrecorded']);
    expect(result.resolved).toEqual(['docs/guide.md']);
    expect(result.current).toMatch(/^[0-9a-f]{64}$/);
    expect(result.selected).toEqual([entry()]);
    lock.entries.set('CLAUDE.md', result.current);
    expect(run(decl([entry()]), () => ['x'], lock).state).toBe('ok');
  });

  it('changes the hash when the fragment changes', () => {
    expect(run(decl([entry()]), () => ['y']).current).not.toBe(
      run(decl([entry()]), () => ['x']).current,
    );
  });

  it('ignores changes outside the fragment', () => {
    const first = evaluate(
      decl([entry()]),
      universe,
      newLock(),
      [],
      fsWith(() => ['x']),
    );
    const second = evaluate(
      decl([entry()]),
      universe,
      newLock(),
      [],
      fsWith(
        () => ['x'],
        () => 'other',
      ),
    );
    expect(second.current).toBe(first.current);
  });

  it('hashes both the whole file and the fragment when a pattern also matches', () => {
    const result = run(decl([entry()], ['docs/**']), () => ['x']);
    expect(result.current).toBe(
      dependencyHashFrom(
        [['docs/guide.md', 'hash-of-docs/guide.md']],
        [{ path: 'docs/guide.md', select: '"Install"', hashes: ['x'] }],
      ),
    );
  });

  it('still reports E_EMPTY_DEPENDENCIES with no dependencies and no selected', () => {
    const result = run({ file: 'CLAUDE.md', dependencies: [] }, () => []);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E_EMPTY_DEPENDENCIES']);
  });

  it('reports E_SELECT_NOT_FOUND when nothing matches', () => {
    const result = run(decl([entry()]), () => []);
    expect(result.state).toBe('invalid');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E_SELECT_NOT_FOUND']);
    expect(result.diagnostics[0]!.subject).toBe('docs/guide.md#"Install"');
  });

  it('reports E_SELECT_AMBIGUOUS when the plugin returns several hashes', () => {
    const ambiguous = run(decl([entry()]), () => ['a', 'b']);
    expect(ambiguous.state).toBe('invalid');
    expect(ambiguous.diagnostics.map((d) => d.code)).toEqual(['E_SELECT_AMBIGUOUS']);
    expect(ambiguous.diagnostics[0]!.message).toContain('narrow "select"');
  });

  it('does not depend on the select key order', () => {
    const one = run(decl([entry({ select: { kind: 'function', name: 'abc' } })]), () => ['x']);
    const two = run(decl([entry({ select: { name: 'abc', kind: 'function' } })]), () => ['x']);
    expect(one.current).toBe(two.current);
  });

  it('reports E_EMPTY_PATTERN for a missing path', () => {
    const result = run(decl([entry({ path: 'src/missing.ts' })]), () => ['x']);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E_EMPTY_PATTERN']);
    expect(result.diagnostics[0]!.subject).toBe('src/missing.ts');
  });

  it('reports E_EMPTY_PATTERN for the own file', () => {
    const result = run(decl([entry({ path: 'CLAUDE.md' })]), () => ['x']);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E_EMPTY_PATTERN']);
  });

  it('passes Raised plugin errors through and rethrows bugs', () => {
    const result = run(decl([entry()]), () => {
      throw new Raised([diag('E_SELECT', { subject: 'docs/guide.md' })]);
    });
    expect(result.state).toBe('invalid');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E_SELECT']);
    expect(() =>
      run(decl([entry()]), () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });

  it('lists a selected dependent with the canonical select as via', () => {
    expect(dependentsOf('docs/guide.md', [decl([entry()])], new Set(universe), [])).toEqual([
      { file: 'CLAUDE.md', via: ['docs/guide.md#"Install"'] },
    ]);
  });
});
