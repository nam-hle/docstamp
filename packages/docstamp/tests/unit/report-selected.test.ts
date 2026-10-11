import { describe, expect, it } from 'vitest';

import type { Result } from '../../src/core/types.ts';
import { jsonText, listJsonText } from '../../src/report/json.ts';
import { checkText, listText } from '../../src/report/text.ts';

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
