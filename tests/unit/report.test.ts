import { describe, expect, it } from 'vitest';
import { checkText, diagnosticsText, listText, updateText } from '../../src/report/text.ts';
import { jsonText, listJsonText } from '../../src/report/json.ts';
import { diag } from '../../src/core/diagnostics.ts';
import type { Result } from '../../src/core/types.ts';

const res = (dependent: string, state: Result['state'], extra: Partial<Result> = {}): Result => ({
  dependent,
  state,
  dependencies: ['src/**'],
  reasons: state === 'stale' ? ['content-changed'] : [],
  resolved: state === 'invalid' ? [] : ['src/a.ts'],
  current: '',
  diagnostics: [],
  ...extra,
});

describe('§14.3 check text', () => {
  it('lists only non-ok, summary, next line', () => {
    expect(checkText([res('a.md', 'ok'), res('my doc.md', 'stale')])).toBe(
      'STALE    "my doc.md"  (content-changed)\n  depends   src/**\n' +
        '1 ok, 1 stale, 0 invalid\n' +
        'next: review each stale file against its dependencies, then run: ' +
        'docstamp update "my doc.md"\n',
    );
  });
  it('prints no block for ok and no file lines', () => {
    expect(checkText([res('a.md', 'ok')])).toBe('1 ok, 0 stale, 0 invalid\n');
    expect(checkText([res('a.md', 'stale')])).not.toContain('  resolved ');
  });
  it('known changes replace the depends lines', () => {
    const changes = [
      { status: 'modified', path: 'src/a.ts' },
      { status: 'added', path: 'src/my b.ts' },
      { status: 'deleted', path: 'src/c.ts' },
    ] as const;
    expect(checkText([res('a.md', 'stale', { changes })])).toContain(
      'STALE    a.md  (content-changed)\n' +
        '  modified  src/a.ts\n  added     "src/my b.ts"\n  deleted   src/c.ts\n0 ok',
    );
  });
  it('unknown or empty changes print depends lines', () => {
    const dependencies = 'STALE    a.md  (content-changed)\n  depends   src/**\n';
    expect(checkText([res('a.md', 'stale', { changes: null })])).toContain(dependencies);
    expect(checkText([res('a.md', 'stale', { changes: [] })])).toContain(dependencies);
  });
  it('invalid prints a bare line and counts', () => {
    expect(checkText([res('a.md', 'invalid')])).toBe('INVALID  a.md\n0 ok, 0 stale, 1 invalid\n');
  });
  it('next line carries --root', () => {
    expect(checkText([res('a.md', 'stale')], 'sub')).toContain('docstamp update a.md --root sub\n');
  });
  it('summary is always present', () => {
    expect(checkText([])).toBe('0 ok, 0 stale, 0 invalid\n');
  });
});

describe('§14.3 diagnostics text', () => {
  it('formats with optional parts', () => {
    expect(
      diagnosticsText([diag('E_PATTERN', { dependent: 'a.md', subject: '/x', message: 'm.' })]),
    ).toBe('error: E_PATTERN: a.md: /x: m.\n');
  });
  it('omits empty parts', () => {
    expect(diagnosticsText([diag('E_USAGE', { subject: '--x', message: 'm.' })])).toBe(
      'error: E_USAGE: --x: m.\n',
    );
  });
});

describe('§14.4 update text', () => {
  it('written then removed', () => {
    expect(updateText(['b', 'a'], ['z'])).toBe('written  a\nwritten  b\nremoved  z\n');
  });
});

describe('§14.6 list-dependencies text', () => {
  it('one block per Result: depends lines, then file lines', () => {
    const two = res('a.md', 'ok', {
      dependencies: ['src/**', '!src/b.ts'],
      resolved: ['src/a.ts', 'x'],
    });
    expect(listText([two, res('my doc.md', 'stale', { resolved: ['my file'] })])).toBe(
      'a.md\n  depends   src/**\n  depends   !src/b.ts\n  resolved  src/a.ts\n  resolved  x\n' +
        '"my doc.md"\n  depends   src/**\n  resolved  "my file"\n',
    );
  });
  it('an invalid Result prints its first line only, and there is no summary', () => {
    expect(listText([res('a.md', 'invalid')])).toBe('a.md\n');
    expect(listText([])).toBe('');
  });
});

describe('§14.5 JSON', () => {
  it('member order, quoting, final LF', () => {
    const out = jsonText({
      mode: 'check',
      exitCode: 1,
      selected: [res('a .md', 'stale')],
      diagnostics: [],
    });
    expect(out.endsWith('}\n')).toBe(true);
    expect(out).toContain('"file": "a\\u2028.md"');
    const doc = JSON.parse(out);
    expect(Object.keys(doc)).toEqual([
      'version',
      'mode',
      'exitCode',
      'summary',
      'files',
      'diagnostics',
    ]);
    expect(Object.keys(doc.files[0])).toEqual([
      'file',
      'state',
      'reasons',
      'dependencies',
      'changes',
      'diagnostics',
    ]);
  });
  it('changes: list when known, null otherwise', () => {
    const changes = [{ status: 'added', path: 'src/b.ts' }] as const;
    const doc = JSON.parse(
      jsonText({
        mode: 'check',
        exitCode: 1,
        selected: [
          res('a.md', 'stale', { changes }),
          res('b.md', 'stale', { changes: null }),
          res('c.md', 'ok'),
        ],
        diagnostics: [],
      }),
    );
    expect(doc.files[0].changes).toEqual([{ status: 'added', path: 'src/b.ts' }]);
    expect(doc.files[1].changes).toBeNull();
    expect(doc.files[2].changes).toBeNull();
  });
  it('update adds written and removed', () => {
    const doc = JSON.parse(
      jsonText({
        mode: 'update',
        exitCode: 0,
        selected: [res('a.md', 'ok')],
        diagnostics: [],
        written: new Set(['a.md']),
        removed: ['z'],
      }),
    );
    expect(doc.mode).toBe('update');
    expect(doc.files[0].written).toBe(true);
    expect(Object.keys(doc).at(-1)).toBe('removed');
  });
  it('matches JSON.stringify for ASCII documents', () => {
    const out = jsonText({
      mode: 'check',
      exitCode: 2,
      selected: [
        res('a.md', 'stale'),
        res('b.md', 'invalid', { diagnostics: [diag('E_EMPTY_COVERS')] }),
      ],
      diagnostics: [diag('W_ORPHAN', { subject: 'z.md' })],
    });
    expect(out).toBe(`${JSON.stringify(JSON.parse(out), null, 2)}\n`);
  });
  it('empty selection renders empty containers', () => {
    const doc = JSON.parse(jsonText({ mode: 'check', exitCode: 2, selected: [], diagnostics: [] }));
    expect(doc.summary).toEqual({ ok: 0, stale: 0, invalid: 0 });
    expect(doc.files).toEqual([]);
  });
  it('null for empty dependent/subject', () => {
    const doc = JSON.parse(
      jsonText({ mode: 'check', exitCode: 2, selected: [], diagnostics: [diag('E_ROOT')] }),
    );
    expect(doc.diagnostics[0].file).toBeNull();
    expect(doc.diagnostics[0].subject).toBeNull();
  });
  it('list-dependencies has no summary, state, reasons or changes', () => {
    const out = listJsonText({
      exitCode: 2,
      selected: [
        res('a.md', 'ok', { resolved: ['src/a.ts'] }),
        res('b.md', 'invalid', { diagnostics: [diag('E_EMPTY_COVERS')] }),
      ],
      diagnostics: [],
    });
    expect(out).toBe(`${JSON.stringify(JSON.parse(out), null, 2)}\n`);
    const doc = JSON.parse(out);
    expect(Object.keys(doc)).toEqual(['version', 'mode', 'exitCode', 'files', 'diagnostics']);
    expect(doc.mode).toBe('list-dependencies');
    expect(Object.keys(doc.files[0])).toEqual([
      'file',
      'dependencies',
      'resolvedFiles',
      'diagnostics',
    ]);
    expect(doc.files[0].resolvedFiles).toEqual(['src/a.ts']);
    expect(doc.files[1].resolvedFiles).toEqual([]);
    expect(doc.files[1].diagnostics[0].code).toBe('E_EMPTY_COVERS');
  });
});
