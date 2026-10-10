import { describe, expect, it } from 'vitest';
import { Raised, diag } from '../../src/core/diagnostics.ts';
import type { Declaration, Json, Lock, SelectedEntry } from '../../src/core/types.ts';
import { dependentsOf } from '../../src/engine/reverse.ts';
import { evaluate, type EngineFs, type Extraction } from '../../src/engine/evaluate.ts';
import { dependencyHashFrom } from '../../src/hash/hash.ts';

const newLock = (): Lock & { entries: Map<string, string> } => ({
  entries: new Map<string, string>(),
});
const fsWith = (
  extract: (path: string, select: Json) => Extraction,
  fileHash: (path: string) => string = (path) => `hash-of-${path}`,
): EngineFs => ({
  isStampedFile: () => true,
  fileHash,
  extractParts: extract,
});
const found = (...contents: string[]): Extraction => ({
  parts: contents.map((content) => ({ content })),
  warnings: [],
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
const run = (
  b: Declaration,
  extract: (path: string, select: Json) => Extraction,
  lock = newLock(),
) => evaluate(b, universe, lock, [], fsWith(extract));

describe('§8.7 / §12.1 selected dependencies', () => {
  it('is ok with one fragment once recorded', () => {
    const lock = newLock();
    const result = run(decl([entry()]), () => found('x'), lock);
    expect(result.state).toBe('stale');
    expect(result.reasons).toEqual(['unrecorded']);
    expect(result.resolved).toEqual(['docs/guide.md']);
    expect(result.current).toMatch(/^[0-9a-f]{64}$/);
    expect(result.selected).toEqual([entry()]);
    lock.entries.set('CLAUDE.md', result.current);
    expect(run(decl([entry()]), () => found('x'), lock).state).toBe('ok');
  });

  it('changes the hash when the fragment changes', () => {
    expect(run(decl([entry()]), () => found('y')).current).not.toBe(
      run(decl([entry()]), () => found('x')).current,
    );
  });

  it('ignores changes outside the fragment', () => {
    const first = evaluate(
      decl([entry()]),
      universe,
      newLock(),
      [],
      fsWith(() => found('x')),
    );
    const second = evaluate(
      decl([entry()]),
      universe,
      newLock(),
      [],
      fsWith(
        () => found('x'),
        () => 'other',
      ),
    );
    expect(second.current).toBe(first.current);
  });

  it('hashes both the whole file and the fragment when a pattern also matches', () => {
    const result = run(decl([entry()], ['docs/**']), () => found('x'));
    expect(result.current).toBe(
      dependencyHashFrom(
        [['docs/guide.md', 'hash-of-docs/guide.md']],
        [{ path: 'docs/guide.md', select: '"Install"', parts: [{ content: 'x' }] }],
      ),
    );
  });

  it('still reports E_EMPTY_DEPENDENCIES with no dependencies and no selected', () => {
    const result = run({ file: 'CLAUDE.md', dependencies: [] }, () => found());
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E_EMPTY_DEPENDENCIES']);
  });

  it('adds the warnings a plugin reported to a result that stays valid', () => {
    const warning = diag('W_SELECT', {
      subject: 'docs/guide.md#"Install"',
      message: 'Two headings.',
    });
    const result = run(decl([entry()]), () => ({ parts: [{ content: 'x' }], warnings: [warning] }));
    expect(result.state).toBe('stale');
    expect(result.diagnostics.map((d) => [d.code, d.file, d.message])).toEqual([
      ['W_SELECT', 'CLAUDE.md', 'Two headings.'],
    ]);
  });

  it('does not change the hash for a warning', () => {
    const warning = diag('W_SELECT', { subject: 'a', message: 'm' });
    const plain = run(decl([entry()]), () => found('x'));
    const warned = run(decl([entry()]), () => ({ parts: [{ content: 'x' }], warnings: [warning] }));
    expect(warned.current).toBe(plain.current);
  });

  it('keeps the warnings of a selector that raised, with its errors', () => {
    const result = run(decl([entry()]), () => {
      throw new Raised([
        diag('E_SELECT', { subject: 'a', message: 'e' }),
        diag('W_SELECT', { subject: 'a', message: 'w' }),
      ]);
    });
    expect(result.state).toBe('invalid');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E_SELECT', 'W_SELECT']);
  });

  it('does not depend on the select key order', () => {
    const one = run(decl([entry({ select: { kind: 'function', name: 'abc' } })]), () => found('x'));
    const two = run(decl([entry({ select: { name: 'abc', kind: 'function' } })]), () => found('x'));
    expect(one.current).toBe(two.current);
  });

  it('reports E_EMPTY_PATTERN for a missing path', () => {
    const result = run(decl([entry({ path: 'src/missing.ts' })]), () => found('x'));
    expect(result.diagnostics.map((d) => d.code)).toEqual(['E_EMPTY_PATTERN']);
    expect(result.diagnostics[0]!.subject).toBe('src/missing.ts');
  });

  it('reports E_EMPTY_PATTERN for the own file', () => {
    const result = run(decl([entry({ path: 'CLAUDE.md' })]), () => found('x'));
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
