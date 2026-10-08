import { describe, expect, it } from 'vitest';
import {
  changeLines,
  checkChunks,
  reviewLine,
  checkText,
  diagnosticsText,
  listText,
  updateText,
} from '../../src/report/text.ts';
import { jsonText, listJsonText } from '../../src/report/json.ts';
import { suggestJsonText, suggestText, type SuggestEntry } from '../../src/report/suggest.ts';
import { diag } from '../../src/core/diagnostics.ts';
import type { Change, Result } from '../../src/core/types.ts';

const res = (file: string, state: Result['state'], extra: Partial<Result> = {}): Result => ({
  file,
  state,
  dependencies: ['src/**'],
  reasons: state === 'stale' ? ['content-changed'] : [],
  resolved: state === 'invalid' ? [] : ['src/a.ts'],
  current: '',
  diagnostics: [],
  ...extra,
});

const change = (status: Change['status'], path: string, extra: Partial<Change> = {}): Change => ({
  status,
  path,
  via: ['src/**'],
  whitespaceOnly: false,
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
      change('modified', 'src/a.ts'),
      change('deleted', 'src/c.ts'),
      change('added', 'src/my b.ts'),
    ];
    expect(checkText([res('a.md', 'stale', { changes })])).toContain(
      'STALE    a.md  (content-changed)\n' +
        '  modified  src/a.ts\n  deleted   src/c.ts\n  added     "src/my b.ts"\n0 ok',
    );
  });
  it('from 5 Changes a summary line counts each status that occurs, in a fixed order', () => {
    const changes = [...many('deleted', 'src/old/', 4), change('added', 'src/z.ts')];
    expect(checkText([res('a.md', 'stale', { changes })])).toContain(
      'STALE    a.md  (content-changed)\n  changed   1 added, 4 deleted\n  deleted   src/old/f00',
    );
    expect(checkText([res('a.md', 'stale', { changes: changes.slice(1) })])).not.toContain(
      'changed ',
    );
  });
  it('an edited own list is its own line, before the summary line', () => {
    const changes = [change('modified', 'src/a.ts')];
    const edited = res('a.md', 'stale', { changes, edited: 'docstamp.yaml', base: 'c0ffee' });
    expect(checkText([edited])).toContain(
      'STALE    a.md  (content-changed)\n  edited    docstamp.yaml  (dependency list)\n' +
        '  modified  src/a.ts\n' +
        '  review: git diff -M c0ffee -- src/a.ts docstamp.yaml\n0 ok',
    );
  });
  it('an edited own list with no Change prints the edited line and its review line only', () => {
    const edited = res('a.md', 'stale', { changes: [], edited: 'a.md', base: 'c0ffee' });
    expect(checkText([edited])).toContain(
      'STALE    a.md  (content-changed)\n  edited    a.md  (dependency list)\n' +
        '  review: git diff -M c0ffee -- a.md\n0 ok',
    );
  });
  it('unknown or empty changes print depends lines', () => {
    const dependencies = 'STALE    a.md  (content-changed)\n  depends   src/**\n';
    expect(checkText([res('a.md', 'stale', { changes: null })])).toContain(dependencies);
    expect(checkText([res('a.md', 'stale', { changes: [] })])).toContain(dependencies);
  });
  it('invalid prints a bare line and counts', () => {
    expect(checkText([res('a.md', 'invalid')])).toBe(
      'INVALID  a.md\n0 ok, 0 stale, 1 invalid\n' +
        'next: fix the configuration of each invalid file, then run: docstamp check a.md\n',
    );
  });
  it('next line carries --root', () => {
    expect(checkText([res('a.md', 'stale')], { root: 'sub' })).toContain(
      'docstamp update a.md --root sub\n',
    );
  });
  it('summary is always present', () => {
    expect(checkText([])).toBe('0 ok, 0 stale, 0 invalid\n');
  });
  it('--quiet drops the summary only when nothing is stale or invalid', () => {
    const quiet = { quiet: true };
    expect(checkText([res('a.md', 'ok')], quiet)).toBe('');
    expect(checkText([], quiet)).toBe('');
    expect(checkText([res('a.md', 'ok'), res('b.md', 'stale')], quiet)).toBe(
      checkText([res('a.md', 'ok'), res('b.md', 'stale')]),
    );
    expect(checkText([res('a.md', 'invalid')], quiet)).toBe(checkText([res('a.md', 'invalid')]));
  });
});

const many = (status: Change['status'], dir: string, count: number): Change[] =>
  Array.from({ length: count }, (_, i) =>
    change(status, `${dir}f${String(i).padStart(2, '0')}.ts`),
  );
  it('the invalid next line names the docstamp block for inline files (§14.3.3)', () => {
    const both = [res('a.md', 'invalid'), res('b.md', 'invalid')];
    expect(checkText(both, { inline: new Set(['a.md', 'b.md']) })).toContain(
      'next: fix the docstamp block of each invalid file, then run: docstamp check a.md b.md\n',
    );
    expect(checkText(both, { inline: new Set(['a.md']) })).toContain(
      'next: fix the configuration or docstamp block of each invalid file, then run:',
    );
    expect(checkText(both, { inline: new Set(['c.md']) })).toContain(
      'next: fix the configuration of each invalid file, then run:',
    );
  });

describe('§14.3.1 change lines', () => {
  it('a run of 5 or more added or deleted files in one directory is one group line', () => {
    expect(
      changeLines([...many('deleted', 'src/old/', 13), ...many('added', 'src/new/', 13)]),
    ).toEqual(['  added     src/new/  (13 files)\n', '  deleted   src/old/  (13 files)\n']);
  });
  it('the threshold is 5: 4 files stay as lines, 5 collapse', () => {
    expect(changeLines(many('deleted', 'src/a/', 4))).toHaveLength(4);
    expect(changeLines(many('deleted', 'src/a/', 5))).toEqual(['  deleted   src/a/  (5 files)\n']);
  });
  it('modified files are never grouped', () => {
    expect(changeLines(many('modified', 'src/a/', 6))).toHaveLength(6);
  });
  it('a run counts the files directly in the directory, never those of a subdirectory', () => {
    const changes = [
      ...many('added', 'src/a/', 5),
      ...many('added', 'src/a/b/', 3),
      change('added', 'src/a/z.ts'),
    ];
    const lines = changeLines(changes.sort((x, y) => (x.path < y.path ? -1 : 1)));
    expect(lines).toEqual([
      '  added     src/a/  (6 files)\n',
      '  added     src/a/b/f00.ts\n',
      '  added     src/a/b/f01.ts\n',
      '  added     src/a/b/f02.ts\n',
    ]);
  });
  it('files of the root directory and of different statuses are not mixed', () => {
    expect(changeLines(many('added', '', 6))).toHaveLength(6);
    const mixed = [...many('added', 'src/a/', 3), ...many('deleted', 'src/a/', 3)];
    expect(changeLines(mixed.sort((x, y) => (x.path < y.path ? -1 : 1)))).toHaveLength(6);
  });
  it('lines are in path order, a group line at its directory, added before deleted on a tie', () => {
    const changes = [
      change('modified', 'a.ts'),
      ...many('added', 'src/', 5),
      ...many('deleted', 'src/', 5),
      change('deleted', 'src.ts'),
      change('added', 'z.ts'),
    ];
    expect(changeLines(changes)).toEqual([
      '  modified  a.ts\n',
      '  deleted   src.ts\n',
      '  added     src/  (5 files)\n',
      '  deleted   src/  (5 files)\n',
      '  added     z.ts\n',
    ]);
  });
  it('a directory with a space or parenthesis is quoted', () => {
    expect(changeLines(many('added', 'my dir/', 5))).toEqual([
      '  added     "my dir/"  (5 files)\n',
    ]);
  });
  it('is part of the block of a stale file', () => {
    const changes = [...many('deleted', 'src/old/', 5), change('modified', 'src/m.ts')];
    expect(checkText([res('a.md', 'stale', { changes })])).toContain(
      'STALE    a.md  (content-changed)\n  changed   1 modified, 5 deleted\n' +
        '  modified  src/m.ts\n  deleted   src/old/  (5 files)\n0 ok',
    );
  });
});

describe('§14.3.1 renamed lines', () => {
  const moved = (from: string, to: string, count: number): Change[] =>
    Array.from({ length: count }, (_, i) => {
      const name = `f${String(i).padStart(2, '0')}.ts`;
      return [
        change('deleted', `${from}${name}`, { pair: `${to}${name}` }),
        change('added', `${to}${name}`, { pair: `${from}${name}` }),
      ];
    }).flat();
  const sorted = (changes: Change[]) => changes.sort((x, y) => (x.path < y.path ? -1 : 1));
  it('a pair is one line at its deleted path', () => {
    const changes = sorted([
      change('deleted', 'src/a.ts', { pair: 'lib/b.ts' }),
      change('added', 'lib/b.ts', { pair: 'src/a.ts' }),
      change('added', 'lib/c.ts'),
    ]);
    expect(changeLines(changes)).toEqual([
      '  added     lib/c.ts\n',
      '  renamed   src/a.ts -> lib/b.ts\n',
    ]);
  });
  it('5 or more files moved between two directories under the same names are one line', () => {
    expect(changeLines(sorted(moved('src/old/', 'src/new/', 13)))).toEqual([
      '  renamed   src/old/ -> src/new/  (13 files)\n',
    ]);
    expect(changeLines(sorted(moved('src/old/', 'src/new/', 4)))).toHaveLength(4);
  });
  it('a renamed file inside one directory, or under another name, is never grouped', () => {
    const renamedInPlace = Array.from({ length: 5 }, (_, i) => [
      change('deleted', `src/a${i}.ts`, { pair: `src/b${i}.ts` }),
      change('added', `src/b${i}.ts`, { pair: `src/a${i}.ts` }),
    ]).flat();
    expect(changeLines(sorted(renamedInPlace))).toHaveLength(5);
  });
  it('the summary line counts a pair once, as renamed', () => {
    const changes = sorted([...moved('src/old/', 'src/new/', 5), change('added', 'src/x.ts')]);
    expect(checkText([res('a.md', 'stale', { changes })])).toContain(
      '  changed   1 added, 5 renamed\n  renamed   src/old/ -> src/new/  (5 files)\n' +
        '  added     src/x.ts\n',
    );
  });
});

describe('§14.3.1 whitespace marker', () => {
  it('follows the path of a change line, and never a group line', () => {
    const changes = [
      change('modified', 'src/a.ts', { whitespaceOnly: true }),
      change('modified', 'src/b.ts'),
      change('modified', 'src/my c.ts', { whitespaceOnly: true }),
    ];
    expect(changeLines(changes)).toEqual([
      '  modified  src/a.ts (whitespace only)\n',
      '  modified  src/b.ts\n',
      '  modified  "src/my c.ts" (whitespace only)\n',
    ]);
  });
});

describe('§14.3.4 review line', () => {
  const stale = (changes: Change[], dependencies = ['src/**']) =>
    res('a.md', 'stale', { changes, dependencies, base: 'c0ffee' });
  it('names the base commit and every changed path, in path order', () => {
    const changes = [change('modified', 'src/a.ts'), change('deleted', 'src/b.ts')];
    expect(reviewLine(stale(changes))).toBe('  review: git diff -M c0ffee -- src/a.ts src/b.ts\n');
  });
  it('quotes for the shell, and reads a path with a wildcard or a colon literally', () => {
    const changes = [
      change('modified', "src/it's.ts"),
      change('modified', 'src/my file.ts'),
      change('modified', 'src/[id].ts'),
      change('added', ':odd.ts'),
    ];
    expect(reviewLine(stale(changes))).toBe(
      "  review: git diff -M c0ffee -- 'src/it'\\''s.ts' 'src/my file.ts' " +
        "':(literal)src/[id].ts' ':(literal):odd.ts'\n",
    );
  });
  it('--root becomes git -C', () => {
    const changes = [change('modified', 'src/a.ts')];
    expect(reviewLine(stale(changes), 'my dir')).toBe(
      "  review: git -C 'my dir' diff -M c0ffee -- src/a.ts\n",
    );
  });
  it('up to 10 paths are listed, from 11 the patterns become pathspecs', () => {
    const ten = Array.from({ length: 10 }, (_, i) => change('modified', `src/f${i}.ts`));
    expect(reviewLine(stale(ten))).toContain(' -- src/f0.ts src/f1.ts ');
    const eleven = [...ten, change('modified', 'src/f10.ts')];
    expect(reviewLine(stale(eleven, ['src/**', 'lib', '!src/**/*.test.ts', 'a.ts', 'x/*']))).toBe(
      "  review: git diff -M c0ffee -- ':(glob)src/**' ':(glob)lib' " +
        "':(exclude,glob)src/**/*.test.ts' ':(exclude,glob)src/**/*.test.ts/**' " +
        "':(glob)a.ts' ':(glob)x/*' ':(glob)x/*/**'\n",
    );
  });
  it('from 11 paths, a pattern with an alternation leaves no review line', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => change('modified', `src/f${i}.ts`));
    expect(reviewLine(stale(eleven, ['src/**/*.{ts,js}']))).toBe('');
    expect(checkText([stale(eleven, ['src/**/*.{ts,js}'])])).not.toContain('review:');
  });
  it('names the carrier of an edited own list once, outside the path cap', () => {
    const ten = Array.from({ length: 10 }, (_, i) => change('modified', `src/f${i}.ts`));
    expect(reviewLine({ ...stale(ten), edited: 'docstamp.yaml' })).toMatch(
      / src\/f9\.ts docstamp\.yaml\n$/u,
    );
    const listed = [change('modified', 'docstamp.yaml')];
    expect(reviewLine({ ...stale(listed), edited: 'docstamp.yaml' })).toBe(
      '  review: git diff -M c0ffee -- docstamp.yaml\n',
    );
  });
  it('no line without a known base or changes', () => {
    expect(reviewLine(res('a.md', 'stale', { changes: [change('added', 'x')] }))).toBe('');
    expect(reviewLine(res('a.md', 'stale', { base: 'c0ffee', changes: null }))).toBe('');
    expect(checkText([res('a.md', 'stale')])).not.toContain('review:');
  });
  it('is the last line of the block of its file', () => {
    const changes = [change('modified', 'src/a.ts', { whitespaceOnly: true })];
    expect(checkText([stale(changes)])).toContain(
      'STALE    a.md  (content-changed)\n  modified  src/a.ts (whitespace only)\n' +
        '  review: git diff -M c0ffee -- src/a.ts\n0 ok',
    );
  });
  it('an untracked line follows for the untracked paths of the first form', () => {
    const changes = [
      change('added', 'src/my b.ts', { untracked: true }),
      change('added', 'src/new/a.ts', { pair: 'src/old/a.ts', untracked: true }),
      change('deleted', 'src/old/a.ts', { pair: 'src/new/a.ts' }),
    ];
    expect(reviewLine(stale(changes), 'r')).toBe(
      "  review: git -C r diff -M c0ffee -- 'src/my b.ts' src/new/a.ts src/old/a.ts\n" +
        "  untracked: git -C r add -N -- 'src/my b.ts' src/new/a.ts\n",
    );
    const many = Array.from({ length: 11 }, (_, i) =>
      change('added', `src/f${i}.ts`, { untracked: true }),
    );
  });
});

describe('§14.3.3 next lines', () => {
  const stales = Array.from({ length: 12 }, (_, i) =>
    res(`d${String(i).padStart(2, '0')}.md`, 'stale'),
  );
  it('lists at most 10 files, then says how many more', () => {
    const out = checkText(stales);
    expect(out).toContain(
      'docstamp update d00.md d01.md d02.md d03.md d04.md d05.md d06.md d07.md d08.md d09.md\n  and 2 more\n',
    );
    expect(out).not.toContain('d10.md d11.md');
    expect(out.endsWith('  and 2 more\n')).toBe(true);
  });
  it('exactly 10 files have no continuation line', () => {
    expect(checkText(stales.slice(0, 10))).not.toContain(' more');
  });
  it('invalid files get their own line with another instruction, after the stale one', () => {
    const out = checkText([res('a.md', 'invalid'), res('b.md', 'stale'), res('c.md', 'invalid')], {
      root: 'sub',
    });
    expect(out).toBe(
      'INVALID  a.md\n' +
        'STALE    b.md  (content-changed)\n  depends   src/**\n' +
        'INVALID  c.md\n' +
        '0 ok, 1 stale, 2 invalid\n' +
        'next: review each stale file against its dependencies, then run: ' +
        'docstamp update b.md --root sub\n' +
        'next: fix the configuration of each invalid file, then run: ' +
        'docstamp check a.md c.md --root sub\n',
    );
  });
  it('--root follows each list, and the cap applies to the invalid line too', () => {
    const invalid = Array.from({ length: 11 }, (_, i) =>
    expect(reviewLine(stale(many))).not.toContain('untracked:');
      res(`i${String(i).padStart(2, '0')}.md`, 'invalid'),
    );
    const out = checkText(invalid, { root: 'sub' });
    expect(out).toContain('then run: docstamp check i00.md i01.md');
    expect(out).toContain('i09.md --root sub\n  and 1 more\n');
  });
  it('a file is written relative to the current directory when it is not the root', () => {
    const out = checkText([res('docs/b.md', 'stale'), res('a.md', 'invalid')], {
      root: 'repo',
      rootFromCwd: 'repo',
    });
    expect(out).toContain('then run: docstamp update repo/docs/b.md --root repo\n');
    expect(out).toContain('then run: docstamp check repo/a.md --root repo\n');
    const up = checkText([res('docs/b.md', 'stale')], { rootFromCwd: '../..' });
    expect(up).toContain('then run: docstamp update ../../docs/b.md\n');
  });
  it('an update refused by an invalid file prints no next line', () => {
    expect(checkText([res('a.md', 'invalid')], { next: false })).toBe(
      'INVALID  a.md\n0 ok, 0 stale, 1 invalid\n',
    );
  });
});

describe('§14.3.2 order of output', () => {
  const warning = diag('W_EMPTY_EXCLUSION', { file: 'ok.md', subject: '!x', message: 'w.' });
  const error = diag('E_EMPTY_PATTERN', { file: 'inv.md', subject: 'p', message: 'e.' });
  const orphan = diag('W_ORPHAN', { subject: 'gone.md', message: 'o.' });
  const selected = [
    res('inv.md', 'invalid', { diagnostics: [error] }),
    res('ok.md', 'ok', { diagnostics: [warning] }),
    res('stale.md', 'stale'),
  ];
  const chunks = checkChunks(selected, [orphan]);
  it('global diagnostics, then each file block followed by its own diagnostics, then the summary', () => {
    expect(chunks.map((c) => [c.stream, c.text.split('\n')[0]])).toEqual([
      ['stderr', 'warning: W_ORPHAN: gone.md: o.'],
      ['stdout', 'INVALID  inv.md'],
      ['stderr', 'error: E_EMPTY_PATTERN: inv.md: p: e.'],
      ['stderr', 'warning: W_EMPTY_EXCLUSION: ok.md: !x: w.'],
      ['stdout', 'STALE    stale.md  (content-changed)'],
      ['stdout', '1 ok, 1 stale, 1 invalid'],
      [
        'stdout',
        'next: review each stale file against its dependencies, then run: docstamp update stale.md',
      ],
      [
        'stdout',
        'next: fix the configuration of each invalid file, then run: docstamp check inv.md',
      ],
    ]);
  });
  it('each stream alone holds what it held before: global first, then the files in path order', () => {
    const stderr = chunks
      .filter((c) => c.stream === 'stderr')
      .map((c) => c.text)
      .join('');
    expect(stderr).toBe(diagnosticsText([orphan, error, warning]));
  });
});

describe('§14.3 diagnostics text', () => {
  it('formats with optional parts', () => {
    expect(
      diagnosticsText([diag('E_PATTERN', { file: 'a.md', subject: '/x', message: 'm.' })]),
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
    expect(updateText(['b'], ['a'], ['z'])).toBe('unchanged  a\nwritten  b\nremoved  z\n');
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
  it('marks a pattern that comes from a preset with its name', () => {
    const doc = res('a.md', 'ok', {
      dependencies: ['src', '!**/*.test.*', 'a b'],
      origins: [null, 'tests', 'two-words'],
      resolved: ['src/a.ts'],
    });
    expect(listText([doc])).toBe(
      'a.md\n  depends   src\n  depends   !**/*.test.* (preset tests)\n' +
        '  depends   "a b" (preset two-words)\n  resolved  src/a.ts\n',
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
    const changes = [change('added', 'src/b.ts')];
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
    expect(doc.files[0].changes).toEqual([{ status: 'added', path: 'src/b.ts', via: ['src/**'] }]);
    expect(doc.files[1].changes).toBeNull();
    expect(doc.files[2].changes).toBeNull();
  });
  it('dependenciesEdited follows changes only when the own list was edited', () => {
    const doc = JSON.parse(
      jsonText({
        mode: 'check',
        exitCode: 1,
        selected: [
          res('a.md', 'stale', { changes: [], edited: 'a.md', base: 'c0ffee' }),
          res('b.md', 'stale', { changes: null }),
        ],
        diagnostics: [],
      }),
    );
    expect(Object.keys(doc.files[0])).toEqual([
      'file',
      'state',
      'reasons',
      'dependencies',
      'changes',
      'dependenciesEdited',
      'diagnostics',
    ]);
    expect(doc.files[0]).toMatchObject({ reasons: ['content-changed'], dependenciesEdited: true });
    expect(doc.files[1]).not.toHaveProperty('dependenciesEdited');
  });
  it('a change has via, and whitespaceOnly only when true, in this order', () => {
    const changes = [
      change('modified', 'src/a.ts', { via: ['src', 'src/*.ts'], whitespaceOnly: true }),
      change('modified', 'src/b.ts'),
    ];
    const out = jsonText({
      mode: 'check',
      exitCode: 1,
      selected: [res('a.md', 'stale', { changes })],
      diagnostics: [],
    });
    const doc = JSON.parse(out);
    expect(Object.keys(doc.files[0].changes[0])).toEqual([
      'status',
      'path',
      'via',
      'whitespaceOnly',
    ]);
    expect(doc.files[0].changes[0]).toMatchObject({
      via: ['src', 'src/*.ts'],
      whitespaceOnly: true,
    });
    expect(Object.keys(doc.files[0].changes[1])).toEqual(['status', 'path', 'via']);
    expect(out).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
  it('both Changes of a pair stay listed, each with the other as its pair', () => {
    const changes = [
      change('added', 'lib/a.ts', { pair: 'src/a.ts' }),
      change('deleted', 'src/a.ts', { pair: 'lib/a.ts' }),
    ];
    const doc = JSON.parse(
      jsonText({
        mode: 'check',
        exitCode: 1,
        selected: [res('a.md', 'stale', { changes })],
        diagnostics: [],
      }),
    );
    expect(doc.files[0].changes).toEqual([
      { status: 'added', path: 'lib/a.ts', via: ['src/**'], pair: 'src/a.ts' },
      { status: 'deleted', path: 'src/a.ts', via: ['src/**'], pair: 'lib/a.ts' },
    ]);
  });
  it('onlyStale omits the ok files and still counts them', () => {
    const doc = JSON.parse(
      jsonText({
        mode: 'check',
        exitCode: 2,
        onlyStale: true,
        selected: [
          res('a.md', 'ok'),
          res('b.md', 'stale'),
          res('c.md', 'invalid'),
          res('d.md', 'ok'),
        ],
        diagnostics: [],
      }),
    );
    expect(doc.files.map((f: { file: string }) => f.file)).toEqual(['b.md', 'c.md']);
    expect(doc.summary).toEqual({ ok: 2, stale: 1, invalid: 1 });
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
        res('b.md', 'invalid', { diagnostics: [diag('E_EMPTY_DEPENDENCIES')] }),
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
  it('null for empty file/subject', () => {
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
        res('b.md', 'invalid', { diagnostics: [diag('E_EMPTY_DEPENDENCIES')] }),
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
    expect(doc.files[1].diagnostics[0].code).toBe('E_EMPTY_DEPENDENCIES');
  });
  it('list-dependencies gives the use and one origin per pattern', () => {
    const out = listJsonText({
      exitCode: 0,
      selected: [
        res('a.md', 'ok', {
          dependencies: ['src', '!x'],
          use: ['tests'],
          origins: [null, 'tests'],
        }),
      ],
      diagnostics: [],
    });
    const [file] = JSON.parse(out).files;
    expect([file.use, file.origins]).toEqual([['tests'], [null, 'tests']]);
  });
});

describe('§14.9 suggest text', () => {
  const entry = (file: string, rows: SuggestEntry['suggestions'], ignored: string[] = []) => ({
    file,
    suggestions: rows,
    ignored,
  });
  it('a header row and one row per Suggestion, rates with four decimals, n/a, blank for an exclusion', () => {
    expect(
      suggestText(
        [
          entry(
            'README.md',
            [
              { pattern: 'src/cli', resolvedCount: 12, staleRate: 1234 },
              { pattern: '!src/cli/**/*.test.*', resolvedCount: 3, staleRate: null },
              { pattern: 'docs', resolvedCount: 140, staleRate: null },
              { pattern: 'x.md', resolvedCount: 1, staleRate: 10000 },
            ],
            ['dist/out.js'],
          ),
        ],
        false,
      ),
    ).toBe(
      'suggest README.md\n' +
        '  pattern               files   stale\n' +
        '  src/cli                  12  0.1234\n' +
        '  !src/cli/**/*.test.*     -3\n' +
        '  docs                    140     n/a\n' +
        '  x.md                      1  1.0000\n' +
        '  ignored  dist/out.js\n',
    );
  });
  it('says so when nothing was found, and quotes a file with a space', () => {
    expect(suggestText([entry('my doc.md', [])], false)).toBe(
      'suggest "my doc.md"\n  no paths found\n',
    );
  });
  it('--write adds one line per file after the blocks', () => {
    const rows = [{ pattern: 'src', resolvedCount: 2, staleRate: null }];
    expect(
      suggestText(
        [
          { ...entry('a.md', rows), written: true },
          { ...entry('b.md', []), written: false },
        ],
        true,
      ),
    ).toBe(
      'suggest a.md\n  pattern  files  stale\n  src          2    n/a\n' +
        'suggest b.md\n  no paths found\n' +
        'written  a.md\nunchanged  b.md\n',
    );
  });
});

describe('§14.5 suggest JSON', () => {
  it('has the documented members in order, and written only with --write', () => {
    const files = [
      {
        file: 'a.md',
        suggestions: [
          { pattern: 'src', resolvedCount: 2, staleRate: 1234 },
          { pattern: '!src/**/*.test.*', resolvedCount: 1, staleRate: null },
        ],
        ignored: ['dist'],
        written: true,
      },
    ];
    const plain = JSON.parse(
      suggestJsonText({ exitCode: 0, write: false, files, diagnostics: [] }),
    );
    expect(Object.keys(plain)).toEqual(['version', 'mode', 'exitCode', 'files', 'diagnostics']);
    expect(plain).toMatchObject({ version: 2, mode: 'suggest', exitCode: 0 });
    expect(plain.files[0]).toEqual({
      file: 'a.md',
      suggestions: [
        { pattern: 'src', resolvedCount: 2, staleRate: 0.1234 },
        { pattern: '!src/**/*.test.*', resolvedCount: 1, staleRate: null },
      ],
      ignored: ['dist'],
      diagnostics: [],
    });
    const written = JSON.parse(
      suggestJsonText({ exitCode: 0, write: true, files, diagnostics: [] }),
    );
    expect(Object.keys(written.files[0])).toEqual([
      'file',
      'suggestions',
      'ignored',
      'diagnostics',
      'written',
    ]);
    expect(written.files[0].written).toBe(true);
  });
  it('a raised run has no files and the diagnostics', () => {
    const doc = JSON.parse(
      suggestJsonText({
        exitCode: 2,
        write: false,
        files: [],
        diagnostics: [diag('E_USAGE', { subject: 'x' })],
      }),
    );
    expect(doc.files).toEqual([]);
    expect(doc.diagnostics[0]).toMatchObject({ code: 'E_USAGE', subject: 'x' });
  });
});
