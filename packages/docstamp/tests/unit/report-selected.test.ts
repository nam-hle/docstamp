import { describe, expect, it } from 'vitest';

import { diag } from '../../src/core/diagnostics.ts';
import type { Result } from '../../src/core/types.ts';
import type { FileStats } from '../../src/engine/stats.ts';
import {
  jsonText,
  listJsonText,
  reverseJsonText,
  statsJsonText,
  type StatsWindow,
} from '../../src/report/json.ts';
import {
  checkText,
  diagnosticsText,
  listText,
  reverseText,
  statsText,
} from '../../src/report/text.ts';

const withSelected: Result = {
  file: 'CLAUDE.md',
  dependencies: ['src/**'],
  selected: [{ path: 'docs/guide.md', select: { name: 'abc', kind: 'function' } }],
  state: 'stale',
  reasons: ['content-changed'],
  resolved: ['src/a.ts'],
  current: 'h',
  diagnostics: [],
  changes: [],
};

const without: Result = { ...withSelected, selected: undefined };
const empty: Result = { ...withSelected, selected: [] };

const SELECTED_LINE =
  '  depends   "docs/guide.md#{\\"kind\\":\\"function\\",\\"name\\":\\"abc\\"}"\n';

describe('§14.3, §14.5, §14.6 selected dependencies in the output', () => {
  it('check text shows a depends line after the pattern lines', () => {
    expect(checkText([withSelected])).toContain(`  depends   src/**\n${SELECTED_LINE}`);
  });

  it('list-dependencies text shows the same line before resolved', () => {
    expect(listText([withSelected])).toContain(`  depends   src/**\n${SELECTED_LINE}  resolved`);
  });

  it('check JSON has selected after dependencies and before changes', () => {
    const text = jsonText({
      mode: 'check',
      exitCode: 1,
      selected: [withSelected],
      diagnostics: [],
    });
    expect(text).toContain(
      [
        '      "selected": [',
        '        {',
        '          "path": "docs/guide.md",',
        '          "select": {',
        '            "kind": "function",',
        '            "name": "abc"',
        '          }',
        '        }',
        '      ],',
        '      "changes"',
      ].join('\n'),
    );
    expect(text.indexOf('"dependencies"')).toBeLessThan(text.indexOf('"selected"'));
  });

  it('list-dependencies JSON has selected between dependencies and resolvedFiles', () => {
    const text = listJsonText({ exitCode: 0, selected: [withSelected], diagnostics: [] });
    expect(text.indexOf('"dependencies"')).toBeLessThan(text.indexOf('"selected"'));
    expect(text.indexOf('"selected"')).toBeLessThan(text.indexOf('"resolvedFiles"'));
  });

  it('a result without selected entries has no selected member', () => {
    for (const result of [without, empty]) {
      const check = jsonText({ mode: 'check', exitCode: 1, selected: [result], diagnostics: [] });
      const list = listJsonText({ exitCode: 0, selected: [result], diagnostics: [] });
      expect(check).not.toContain('"selected"');
      expect(list).not.toContain('"selected"');
      expect(listText([result])).not.toContain('#');
    }
  });
});

describe('§14.2, §14.5 a selected dependency written as a Shorthand', () => {
  const written = 'docs/guide.md:name=abc,kind=function';
  const canonical = 'docs/guide.md#{"kind":"function","name":"abc"}';
  const select = { name: 'abc', kind: 'function' };
  const shorthand: Result = {
    ...withSelected,
    selected: [{ path: 'docs/guide.md', select, written }],
    changes: [],
    fragments: [{ path: 'docs/guide.md', select, written, status: 'changed' }],
  };

  it('is printed as written on depends and fragment lines', () => {
    expect(listText([shorthand])).toContain(`  depends   ${written}\n`);
    const text = checkText([shorthand]);
    expect(text).toContain(`  fragment  ${written}  (changed)\n`);
    expect(text).not.toContain('#');
  });

  it('is quoted by the rule of §14.2 when it holds a space', () => {
    const spaced = { path: 'docs/guide.md', select: 'a b', written: 'docs/guide.md:a b' };
    expect(listText([{ ...shorthand, selected: [spaced] }])).toContain(
      '  depends   "docs/guide.md:a b"\n',
    );
  });

  it('keeps the canonical form in JSON and adds written after select', () => {
    const text = jsonText({ mode: 'check', exitCode: 1, selected: [shorthand], diagnostics: [] });
    const member =
      '"select": {\n            "kind": "function",\n            "name": "abc"\n          },';
    expect(text).toContain(`${member}\n          "written": "${written}"`);
    expect(text).toContain('"status": "changed"');
    expect(text.indexOf('"written"')).toBeLessThan(text.indexOf('"status": "changed"'));
    expect(text).not.toContain(canonical);
  });

  it('has no written member when the dependency was written as a Map', () => {
    const map = { ...shorthand, selected: [{ path: 'docs/guide.md', select }], fragments: [] };
    expect(
      jsonText({ mode: 'check', exitCode: 1, selected: [map], diagnostics: [] }),
    ).not.toContain('"written"');
  });

  it('names the written form in a Diagnostic line, keeping the canonical subject in JSON', () => {
    const diagnostic = {
      ...diag('E_SELECT_NOT_FOUND', { file: 'CLAUDE.md', subject: canonical }),
      written,
    };
    expect(diagnosticsText([diagnostic])).toContain(`E_SELECT_NOT_FOUND: CLAUDE.md: ${written}: `);
    const text = jsonText({ mode: 'check', exitCode: 2, selected: [], diagnostics: [diagnostic] });
    expect(text).toContain(`"written": "${written}"`);
    expect(text).toContain(
      '"subject": "docs/guide.md#{\\"kind\\":\\"function\\",\\"name\\":\\"abc\\"}"',
    );
  });

  it('is printed as written in a via of list-dependents, and canonical in its JSON', () => {
    const dependent = {
      file: 'CLAUDE.md',
      via: [canonical],
      written: new Map([[canonical, written]]),
    };
    const entries = [{ file: 'docs/guide.md', dependents: [dependent], diagnostics: [] }];
    expect(reverseText(entries)).toContain(`CLAUDE.md   via ${written}\n`);
    const text = reverseJsonText({ exitCode: 0, entries, diagnostics: [] });
    expect(text).toContain('docs/guide.md#{\\"kind\\":\\"function\\",\\"name\\":\\"abc\\"}');
    expect(text).not.toContain('"written"');
  });

  describe('in the stats breakdown', () => {
    const stats: FileStats = {
      file: 'CLAUDE.md',
      patterns: 1,
      resolvedCount: 1,
      staleCommits: 1,
      days: 1,
      sweepCommits: 0,
      staleRate: 5000,
      sweepShare: 0,
      diagnostics: [],
      dependencies: [{ dependency: canonical, written, preset: null, commits: 1, only: 1 }],
    };
    const window: StatsWindow = { kind: 'days', value: '30d', commits: 2, untouched: 1 };

    it('prints the written form in the table', () => {
      const text = statsText([stats], window);
      expect(text).toContain(`${written}  `);
      expect(text).not.toContain('#');
    });

    it('adds written after dependency in JSON', () => {
      const text = statsJsonText({ exitCode: 0, window, files: [stats], diagnostics: [] });
      expect(text).toContain(
        `"dependency": "docs/guide.md#{\\"kind\\":\\"function\\",\\"name\\":\\"abc\\"}",`,
      );
      expect(text).toMatch(/"dependency": [^\n]+\n\s+"written": "[^\n]+",\n\s+"commits": 1/u);
    });
  });
});
