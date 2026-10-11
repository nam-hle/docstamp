import { describe, expect, it } from 'vitest';
import type { Declaration, Result } from '../../src/core/types.ts';
import { planUpdate } from '../../src/engine/update-plan.ts';

const result = (file: string, current: string): Result => ({
  file,
  dependencies: [],
  state: 'stale',
  reasons: ['content-changed'],
  resolved: [],
  current,
  diagnostics: [],
});

const declared = (file: string, inline?: { recorded: string | null }): Declaration => ({
  file,
  dependencies: [],
  ...(inline ? { inline } : {}),
});

const lockOf = (entries: Record<string, string>) => ({ entries: new Map(Object.entries(entries)) });

describe('§13.5 planUpdate', () => {
  it('records the current hash of a selected file and keeps the others', () => {
    const plan = planUpdate(
      [result('a.md', 'new')],
      [declared('a.md'), declared('b.md')],
      lockOf({ 'a.md': 'old', 'b.md': 'kept' }),
    );
    expect([...plan.entries]).toEqual([
      ['a.md', 'new'],
      ['b.md', 'kept'],
    ]);
    expect(plan.written).toEqual(['a.md']);
    expect(plan.unchanged).toEqual([]);
    expect(plan.hasLockedFiles).toBe(true);
  });

  it('reports a file whose recorded hash already matches as unchanged', () => {
    const plan = planUpdate([result('a.md', 'h')], [declared('a.md')], lockOf({ 'a.md': 'h' }));
    expect(plan.written).toEqual([]);
    expect(plan.unchanged).toEqual(['a.md']);
  });

  it('removes lock entries of files no longer declared, in path order', () => {
    const plan = planUpdate(
      [result('a.md', 'h')],
      [declared('a.md')],
      lockOf({ 'z.md': '1', 'a.md': 'h', 'm.md': '2' }),
    );
    expect(plan.removed).toEqual(['m.md', 'z.md']);
    expect([...plan.entries.keys()]).toEqual(['a.md']);
  });

  it('keeps an inline doc out of the lock and stamps it when its hash differs', () => {
    const plan = planUpdate(
      [result('i.md', 'new'), result('j.md', 'same')],
      [declared('i.md', { recorded: 'old' }), declared('j.md', { recorded: 'same' })],
      lockOf({}),
    );
    expect(plan.entries.size).toBe(0);
    expect(plan.written).toEqual(['i.md']);
    expect(plan.unchanged).toEqual(['j.md']);
    expect([...plan.stamps]).toEqual([['i.md', 'new']]);
    expect(plan.hasLockedFiles).toBe(false);
  });

  it('treats an inline doc with no recorded hash as written', () => {
    const plan = planUpdate(
      [result('i.md', 'new')],
      [declared('i.md', { recorded: null })],
      lockOf({}),
    );
    expect([...plan.stamps]).toEqual([['i.md', 'new']]);
  });

  it('does not change the lock it is given', () => {
    const lock = lockOf({ 'a.md': 'old' });
    planUpdate([result('a.md', 'new')], [declared('a.md')], lock);
    expect([...lock.entries]).toEqual([['a.md', 'old']]);
  });
});
