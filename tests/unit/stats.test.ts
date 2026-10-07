import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/args.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import { exceeds, ratio, statistics, type CommitRecord } from '../../src/engine/stats.ts';
import { parseLog, parseSince } from '../../src/history/replay.ts';
import { statsJsonText } from '../../src/report/json.ts';
import { statsText } from '../../src/report/text.ts';

const ID = 'a'.repeat(40);
const commit = (day: string, ...paths: string[]): CommitRecord => ({ day, paths });
const input = (file: string, ...resolved: string[]) => ({
  file,
  patterns: 1,
  resolved,
  diagnostics: [],
});

describe('§12.4 ParseSince', () => {
  it('accepts a count and a unit, with an optional ago', () => {
    for (const value of ['90.days', '90 days', '1.day', '2.weeks.ago', '3 months ago', '1.year']) {
      expect(parseSince(value)).toBe(value);
    }
    expect(parseSince('30.seconds')).toBe('30.seconds');
    expect(parseSince('5.hours')).toBe('5.hours');
    expect(parseSince('7.minutes')).toBe('7.minutes');
  });
  it('a date alone is midnight UTC, not the time of day of the run', () => {
    expect(parseSince('2024-01-31')).toBe('2024-01-31T00:00:00Z');
  });
  it('accepts a date with a time and an optional zone', () => {
    for (const value of [
      '2024-01-01T10:00',
      '2024-01-01 10:00:30',
      '2024-01-01T10:00:00Z',
      '2024-01-01T10:00:00+02:00',
      '2024-01-01T10:00:00-0200',
    ]) {
      expect(parseSince(value)).toBe(value);
    }
  });
  it('refuses what is not in the grammar', () => {
    for (const value of [
      '',
      'garbage',
      '90days',
      'yesterday',
      '90.fortnights',
      '.days',
      'days',
      '2024-1-1',
      '2024-02-30',
      '2023-02-29',
      '2024-13-01',
      '2024-01-01T24:00',
      '2024-01-01T10:60',
      '2024-01-01T10:00:60',
      '2024-01-01T10',
      '2024-01-01Z',
      '1 day  ago',
    ]) {
      expect(parseSince(value), value).toBeNull();
    }
  });
  it('a leap day is a date', () => {
    expect(parseSince('2024-02-29')).toBe('2024-02-29T00:00:00Z');
  });
});

describe('§12.4 Replay: git log output', () => {
  it('reads commits with their UTC day and their paths', () => {
    const output =
      `\u0001${ID}\x00${Date.UTC(2026, 0, 2, 23, 59, 59) / 1000}\x00\nsrc/a.ts\x00docs/b.md\x00` +
      `\u0001${'b'.repeat(64)}\x00${Date.UTC(2026, 0, 3) / 1000}\x00\nREADME.md\x00`;
    expect(parseLog(output)).toEqual([
      { day: '2026-01-02', paths: ['src/a.ts', 'docs/b.md'] },
      { day: '2026-01-03', paths: ['README.md'] },
    ]);
  });
  it('a commit with no paths is still a commit', () => {
    expect(parseLog(`\u0001${ID}\x00100\x00\u0001${'c'.repeat(40)}\x00200\x00`)).toEqual([
      { day: '1970-01-01', paths: [] },
      { day: '1970-01-01', paths: [] },
    ]);
    expect(parseLog(`\u0001${ID}\x00100\x00`)).toEqual([{ day: '1970-01-01', paths: [] }]);
  });
  it('no output is no commits', () => {
    expect(parseLog('')).toEqual([]);
  });
  it('converts paths to NFC', () => {
    expect(parseLog(`\u0001${ID}\x00100\x00\ne\u0301.ts\x00`)).toEqual([
      { day: '1970-01-01', paths: ['\u00e9.ts'] },
    ]);
  });
  it('a malformed log is refused', () => {
    expect(parseLog('garbage')).toBeNull();
    expect(parseLog(`\u0001${ID}\x00100`)).toBeNull();
    expect(parseLog(`\u0001${ID}\x00not-a-number\x00`)).toBeNull();
    expect(parseLog(`\u0001short\x00100\x00`)).toBeNull();
  });
});

describe('§12.5 Ratio', () => {
  it('is 0 for an empty denominator', () => {
    expect(ratio(0, 0)).toBe(0);
    expect(ratio(5, 0)).toBe(0);
  });
  it('is exact for 0, 1 and simple fractions, in ten-thousandths', () => {
    expect(ratio(0, 7)).toBe(0);
    expect(ratio(7, 7)).toBe(10000);
    expect(ratio(1, 2)).toBe(5000);
    expect(ratio(1, 4)).toBe(2500);
  });
  it('rounds half up to 4 decimals', () => {
    expect(ratio(1, 3)).toBe(3333);
    expect(ratio(2, 3)).toBe(6667);
    expect(ratio(1, 16)).toBe(625);
    expect(ratio(1, 32)).toBe(313);
    expect(ratio(1, 20000)).toBe(1);
    expect(ratio(1, 20001)).toBe(0);
    expect(ratio(129, 326)).toBe(3957);
  });
});

describe('§13.9 the gate compares exact decimals', () => {
  it('is strictly greater', () => {
    expect(exceeds(2000, '0.2')).toBe(false);
    expect(exceeds(2001, '0.2')).toBe(true);
    expect(exceeds(2001, '0.20')).toBe(true);
    expect(exceeds(2001, '0.2001')).toBe(false);
    expect(exceeds(2001, '0.20009')).toBe(true);
  });
  it('0 admits only a zero ratio, 1 admits all', () => {
    expect(exceeds(0, '0')).toBe(false);
    expect(exceeds(1, '0')).toBe(true);
    expect(exceeds(10000, '1')).toBe(false);
    expect(exceeds(10000, '1.00')).toBe(false);
  });
});

describe('§12.5 Statistics', () => {
  const window = [
    commit('2026-01-03', 'src/a.ts'),
    commit('2026-01-02', 'src/a.ts', 'src/b.ts'),
    commit('2026-01-02', 'docs/x.md'),
    commit('2026-01-01', 'src/b.ts'),
    commit('2026-01-01'),
  ];

  it('counts firing commits, distinct days and the share of the window', () => {
    const { files, firingNothing } = statistics(
      [input('A.md', 'src/a.ts'), input('B.md', 'src/a.ts', 'src/b.ts')],
      window,
      200,
    );
    expect(files).toEqual([
      expect.objectContaining({ file: 'B.md', commits: 3, days: 3, ratio: 6000, resolvedCount: 2 }),
      expect.objectContaining({ file: 'A.md', commits: 2, days: 2, ratio: 4000, resolvedCount: 1 }),
    ]);
    expect(firingNothing).toBe(2);
  });
  it('a commit that touches several dependencies of one file fires it once', () => {
    const { files } = statistics([input('B.md', 'src/a.ts', 'src/b.ts')], window, 200);
    expect(files[0]?.commits).toBe(3);
  });
  it('a commit fires every file that depends on a path it touched', () => {
    const { files, firingNothing } = statistics(
      [input('A.md', 'src/a.ts'), input('Z.md', 'src/a.ts')],
      window,
      200,
    );
    expect(files.map((f) => [f.file, f.commits])).toEqual([
      ['A.md', 2],
      ['Z.md', 2],
    ]);
    expect(firingNothing).toBe(3);
  });
  it('sorts by the rounded ratio descending, then by path order', () => {
    const { files } = statistics(
      [
        input('b.md', 'src/b.ts'),
        input('a.md', 'src/a.ts'),
        input('Z.md', 'docs/x.md'),
        input('c.md', 'none.ts'),
      ],
      window,
      200,
    );
    expect(files.map((f) => f.file)).toEqual(['a.md', 'b.md', 'Z.md', 'c.md']);
  });
  it('path order is UTF-16 code unit order, not locale order', () => {
    const { files } = statistics(
      [input('b.md', 'x'), input('B.md', 'x'), input('a.md', 'x')],
      [],
      1,
    );
    expect(files.map((f) => f.file)).toEqual(['B.md', 'a.md', 'b.md']);
  });
  it('an empty window has every ratio 0 and nothing to fire', () => {
    const { files, firingNothing } = statistics([input('A.md', 'src/a.ts')], [], 200);
    expect(files).toEqual([
      expect.objectContaining({ commits: 0, days: 0, ratio: 0, sweepCommits: 0, sweepShare: 0 }),
    ]);
    expect(firingNothing).toBe(0);
  });
  it('a sweep is a firing commit with more distinct paths than the threshold', () => {
    const wide = commit('2026-01-02', 'src/a.ts', 'x1', 'x2', 'x3');
    const narrow = commit('2026-01-03', 'src/a.ts');
    const nothing = commit('2026-01-04', 'x1', 'x2', 'x3', 'x4', 'x5');
    const run = (threshold: number) =>
      statistics([input('A.md', 'src/a.ts')], [wide, narrow, nothing], threshold).files[0]!;
    expect(run(3)).toMatchObject({ commits: 2, sweepCommits: 1, sweepShare: 5000 });
    expect(run(4)).toMatchObject({ commits: 2, sweepCommits: 0, sweepShare: 0 });
    expect(run(0)).toMatchObject({ sweepCommits: 2, sweepShare: 10000 });
  });
  it('duplicate paths in one commit count once towards a sweep', () => {
    const doubled = commit('2026-01-02', 'src/a.ts', 'src/a.ts', 'src/a.ts');
    expect(statistics([input('A.md', 'src/a.ts')], [doubled], 1).files[0]?.sweepCommits).toBe(0);
  });
  it('a rename touches both paths, the old and the new', () => {
    const renamed = [commit('2026-01-02', 'old/name.ts', 'new/name.ts')];
    const { files } = statistics(
      [input('Old.md', 'old/name.ts'), input('New.md', 'new/name.ts')],
      renamed,
      200,
    );
    expect(files.map((f) => [f.file, f.commits])).toEqual([
      ['New.md', 1],
      ['Old.md', 1],
    ]);
  });
  it('days are distinct calendar days of the firing commits only', () => {
    const { files } = statistics(
      [input('A.md', 'src/a.ts')],
      [
        commit('2026-01-02', 'src/a.ts'),
        commit('2026-01-02', 'src/a.ts'),
        commit('2026-01-05', 'other'),
        commit('2026-01-06', 'src/a.ts'),
      ],
      200,
    );
    expect(files[0]).toMatchObject({ commits: 3, days: 2 });
  });
});

describe('§14.5 and §14.8 stats output', () => {
  const stats = statistics(
    [input('CLAUDE.md', 'src/a.ts'), input('a b.md', 'src/b.ts')],
    [commit('2026-01-02', 'src/a.ts'), commit('2026-01-03', 'src/a.ts'), commit('2026-01-04', 'x')],
    200,
  );
  const window = { since: '90.days', kind: 'date', commits: 3, firingNothing: 1 } as const;

  it('writes a table with right-aligned numbers and four decimals', () => {
    expect(statsText(stats.files, window)).toBe(
      'file       patterns  files  commits  days   ratio   sweep\n' +
        'CLAUDE.md         1      1        2     2  0.6667  0.0000\n' +
        '"a b.md"          1      1        0     0  0.0000  0.0000\n' +
        'window: 3 commits since 90.days (date), 1 fire nothing\n',
    );
  });
  it('names the files over the gate, only when there are some', () => {
    const text = statsText(stats.files, window, { given: '0.5', exceeding: ['CLAUDE.md'] });
    expect(text.endsWith('over --max-fire-ratio 0.5: CLAUDE.md\n')).toBe(true);
    expect(statsText(stats.files, window, { given: '0.9', exceeding: [] })).not.toContain('over');
  });
  it('with no file only the window line is written', () => {
    expect(statsText([], window)).toBe('window: 3 commits since 90.days (date), 1 fire nothing\n');
  });
  it('writes ratios as JSON numbers', () => {
    const json = JSON.parse(
      statsJsonText({
        exitCode: 1,
        window,
        sweepThreshold: 200,
        maxFireRatio: '0.50',
        exceeding: ['CLAUDE.md'],
        files: stats.files,
        diagnostics: [],
      }),
    );
    expect(Object.keys(json)).toEqual([
      'version',
      'mode',
      'exitCode',
      'window',
      'sweepThreshold',
      'maxFireRatio',
      'exceeding',
      'files',
      'diagnostics',
    ]);
    expect(json.maxFireRatio).toBe(0.5);
    expect(json.files[0]).toEqual({
      file: 'CLAUDE.md',
      patterns: 1,
      resolvedCount: 1,
      commits: 2,
      days: 2,
      ratio: 0.6667,
      sweepCommits: 0,
      sweepShare: 0,
      diagnostics: [],
    });
  });
  it('a run that raised has no window and no files', () => {
    const json = JSON.parse(
      statsJsonText({
        exitCode: 2,
        window: null,
        sweepThreshold: 200,
        maxFireRatio: undefined,
        exceeding: [],
        files: [],
        diagnostics: [],
      }),
    );
    expect(json).toMatchObject({ window: null, maxFireRatio: null, exceeding: [], files: [] });
  });
});

describe('§13.2 stats options', () => {
  const failure = (argv: string[]) => {
    try {
      parseArgs(argv);
    } catch (e) {
      return (e as Raised).diagnostics[0];
    }
    return undefined;
  };

  it('has defaults', () => {
    expect(parseArgs(['stats'])).toEqual({
      mode: 'stats',
      json: false,
      paths: [],
      since: '90.days',
      sweepThreshold: 200,
    });
  });
  it('takes each option as a separate argument or with =', () => {
    expect(
      parseArgs([
        'stats',
        '--since',
        'v1',
        '--sweep-threshold=5',
        '--max-fire-ratio',
        '0.2',
        'a.md',
      ]),
    ).toEqual({
      mode: 'stats',
      json: false,
      paths: ['a.md'],
      since: 'v1',
      sweepThreshold: 5,
      maxFireRatio: '0.2',
    });
    expect(parseArgs(['stats', '--since=2024-01-01', '--json'])).toMatchObject({
      since: '2024-01-01',
      json: true,
    });
  });
  it('a value that is an option is a missing value', () => {
    for (const argv of [
      ['stats', '--since'],
      ['stats', '--since', '--json'],
      ['stats', '--since='],
      ['stats', '--sweep-threshold', '--root'],
      ['stats', '--max-fire-ratio', '--'],
    ]) {
      expect(failure(argv)?.code, argv.join(' ')).toBe('E_USAGE');
    }
  });
  it('refuses an option given twice, and the options on any other command', () => {
    expect(failure(['stats', '--since', 'a', '--since', 'b'])?.subject).toBe('--since');
    expect(failure(['check', '--since', 'a'])?.subject).toBe('--since');
    expect(failure(['--sweep-threshold', '1'])?.subject).toBe('--sweep-threshold');
    expect(failure(['list-dependencies', '--max-fire-ratio=1'])?.subject).toBe('--max-fire-ratio');
    expect(failure(['update', '--all', '--since=x'])?.subject).toBe('--since');
  });
  it('refuses a --since that starts with a dash', () => {
    expect(failure(['stats', '--since=-x'])?.subject).toBe('--since');
  });
  it('accepts only whole numbers of decimal digits as a threshold', () => {
    for (const value of ['0', '200', '9007199254740991']) {
      expect(parseArgs(['stats', `--sweep-threshold=${value}`])).toMatchObject({
        sweepThreshold: Number(value),
      });
    }
    for (const value of ['-1', '+1', '1.5', '01', '1e3', 'x', '9007199254740992', ' 1']) {
      expect(failure(['stats', `--sweep-threshold=${value}`])?.subject, value).toBe(
        '--sweep-threshold',
      );
    }
  });
  it('accepts only a decimal ratio from 0 to 1', () => {
    for (const value of ['0', '1', '0.5', '0.05', '0.123456789', '1.0', '1.00']) {
      expect(parseArgs(['stats', `--max-fire-ratio=${value}`])).toMatchObject({
        maxFireRatio: value,
      });
    }
    for (const value of [
      '1.5',
      '2',
      '-0.1',
      '.5',
      '0.',
      '1.',
      '1.01',
      '00.5',
      '5e-1',
      'half',
      '50%',
    ]) {
      expect(failure(['stats', `--max-fire-ratio=${value}`])?.subject, value).toBe(
        '--max-fire-ratio',
      );
    }
  });
  it('a file named stats is reached after --', () => {
    expect(parseArgs(['--', 'stats'])).toMatchObject({ mode: 'check', paths: ['stats'] });
  });
});
