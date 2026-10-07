import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/args.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import { ratio, statistics, type CommitRecord } from '../../src/engine/stats.ts';
import { daysRange, parseLog } from '../../src/history/replay.ts';
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

describe('§12.4 Replay: the git range', () => {
  it('the last N days is a number of seconds, never a date for git to parse', () => {
    expect(daysRange(30, 3_000_000)).toEqual(['--max-age=408000', 'HEAD']);
    expect(daysRange(1, 100_000)).toEqual(['--max-age=13600', 'HEAD']);
    expect(daysRange(3650, 1_000_000_000)).toEqual(['--max-age=684640000', 'HEAD']);
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

describe('§12.5 Statistics', () => {
  const window = [
    commit('2026-01-03', 'src/a.ts'),
    commit('2026-01-02', 'src/a.ts', 'src/b.ts'),
    commit('2026-01-02', 'docs/x.md'),
    commit('2026-01-01', 'src/b.ts'),
    commit('2026-01-01'),
  ];

  it('counts stale commits, distinct days and the share of the window', () => {
    const { files, untouched } = statistics(
      [input('A.md', 'src/a.ts'), input('B.md', 'src/a.ts', 'src/b.ts')],
      window,
    );
    expect(files).toEqual([
      expect.objectContaining({
        file: 'B.md',
        staleCommits: 3,
        days: 3,
        staleRate: 6000,
        resolvedCount: 2,
      }),
      expect.objectContaining({
        file: 'A.md',
        staleCommits: 2,
        days: 2,
        staleRate: 4000,
        resolvedCount: 1,
      }),
    ]);
    expect(untouched).toBe(2);
  });
  it('a commit that touches several dependencies of one file counts once', () => {
    const { files } = statistics([input('B.md', 'src/a.ts', 'src/b.ts')], window);
    expect(files[0]?.staleCommits).toBe(3);
  });
  it('a commit makes stale every file that depends on a path it touched', () => {
    const { files, untouched } = statistics(
      [input('A.md', 'src/a.ts'), input('Z.md', 'src/a.ts')],
      window,
    );
    expect(files.map((f) => [f.file, f.staleCommits])).toEqual([
      ['A.md', 2],
      ['Z.md', 2],
    ]);
    expect(untouched).toBe(3);
  });
  it('sorts by the rounded rate descending, then by path order', () => {
    const { files } = statistics(
      [
        input('b.md', 'src/b.ts'),
        input('a.md', 'src/a.ts'),
        input('Z.md', 'docs/x.md'),
        input('c.md', 'none.ts'),
      ],
      window,
    );
    expect(files.map((f) => f.file)).toEqual(['a.md', 'b.md', 'Z.md', 'c.md']);
  });
  it('path order is UTF-16 code unit order, not locale order', () => {
    const { files } = statistics([input('b.md', 'x'), input('B.md', 'x'), input('a.md', 'x')], []);
    expect(files.map((f) => f.file)).toEqual(['B.md', 'a.md', 'b.md']);
  });
  it('an empty window has every rate 0 and nothing untouched', () => {
    const { files, untouched } = statistics([input('A.md', 'src/a.ts')], []);
    expect(files).toEqual([
      expect.objectContaining({
        staleCommits: 0,
        days: 0,
        staleRate: 0,
        sweepCommits: 0,
        sweepShare: 0,
      }),
    ]);
    expect(untouched).toBe(0);
  });
  it('a sweep is a stale commit with more than 200 distinct paths', () => {
    const many = (count: number) => Array.from({ length: count }, (_, i) => `x/${i}`);
    const at200 = commit('2026-01-02', 'src/a.ts', ...many(199));
    const at201 = commit('2026-01-03', 'src/a.ts', ...many(200));
    const wide = commit('2026-01-04', ...many(500));
    const { files } = statistics([input('A.md', 'src/a.ts')], [at200, at201, wide]);
    expect(files[0]).toMatchObject({ staleCommits: 2, sweepCommits: 1, sweepShare: 5000 });
  });
  it('duplicate paths in one commit count once towards a sweep', () => {
    const doubled = commit('2026-01-02', 'src/a.ts', ...Array(300).fill('src/a.ts'));
    expect(statistics([input('A.md', 'src/a.ts')], [doubled]).files[0]?.sweepCommits).toBe(0);
  });
  it('a rename touches both paths, the old and the new', () => {
    const renamed = [commit('2026-01-02', 'old/name.ts', 'new/name.ts')];
    const { files } = statistics(
      [input('Old.md', 'old/name.ts'), input('New.md', 'new/name.ts')],
      renamed,
    );
    expect(files.map((f) => [f.file, f.staleCommits])).toEqual([
      ['New.md', 1],
      ['Old.md', 1],
    ]);
  });
  it('days are distinct calendar days of the stale commits only', () => {
    const { files } = statistics(
      [input('A.md', 'src/a.ts')],
      [
        commit('2026-01-02', 'src/a.ts'),
        commit('2026-01-02', 'src/a.ts'),
        commit('2026-01-05', 'other'),
        commit('2026-01-06', 'src/a.ts'),
      ],
    );
    expect(files[0]).toMatchObject({ staleCommits: 3, days: 2 });
  });
});

describe('§14.5 and §14.8 stats output', () => {
  const stats = statistics(
    [input('CLAUDE.md', 'src/a.ts'), input('a b.md', 'src/b.ts')],
    [commit('2026-01-02', 'src/a.ts'), commit('2026-01-03', 'src/a.ts'), commit('2026-01-04', 'x')],
  );
  const days = { kind: 'days', value: '30d', commits: 3, untouched: 1 } as const;
  const revision = { kind: 'revision', value: 'v1.0', commits: 3, untouched: 1 } as const;

  it('writes a table with right-aligned numbers and four decimals', () => {
    expect(statsText(stats.files, days)).toBe(
      'file       patterns  files  commits  days   stale   sweep\n' +
        'CLAUDE.md         1      1        2     2  0.6667  0.0000\n' +
        '"a b.md"          1      1        0     0  0.0000  0.0000\n' +
        'window: 3 commits in the last 30 days, 1 make no file stale\n',
    );
  });
  it('names a revision window by its range', () => {
    expect(statsText([], revision)).toBe('window: 3 commits in v1.0..HEAD, 1 make no file stale\n');
  });
  it('with no file only the window line is written', () => {
    expect(statsText([], days)).toBe(
      'window: 3 commits in the last 30 days, 1 make no file stale\n',
    );
  });
  it('writes rates as JSON numbers', () => {
    const json = JSON.parse(
      statsJsonText({ exitCode: 0, window: days, files: stats.files, diagnostics: [] }),
    );
    expect(Object.keys(json)).toEqual([
      'version',
      'mode',
      'exitCode',
      'window',
      'files',
      'diagnostics',
    ]);
    expect(json.window).toEqual({ kind: 'days', value: '30d', commits: 3, untouched: 1 });
    expect(json.files[0]).toEqual({
      file: 'CLAUDE.md',
      patterns: 1,
      resolvedCount: 1,
      staleCommits: 2,
      days: 2,
      staleRate: 0.6667,
      sweepCommits: 0,
      sweepShare: 0,
      diagnostics: [],
    });
  });
  it('a run that raised has no window and no files', () => {
    const json = JSON.parse(
      statsJsonText({ exitCode: 2, window: null, files: [], diagnostics: [] }),
    );
    expect(json).toMatchObject({ exitCode: 2, window: null, files: [] });
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

  it('defaults to the last 30 days', () => {
    expect(parseArgs(['stats'])).toEqual({
      mode: 'stats',
      json: false,
      paths: [],
      window: { kind: 'days', days: 30, value: '30d' },
    });
  });
  it('takes --since <n>d or --from <rev>, separate or with =', () => {
    expect(parseArgs(['stats', '--since', '7d', 'a.md'])).toMatchObject({
      paths: ['a.md'],
      window: { kind: 'days', days: 7, value: '7d' },
    });
    expect(parseArgs(['stats', '--since=3650d', '--json'])).toMatchObject({
      json: true,
      window: { kind: 'days', days: 3650, value: '3650d' },
    });
    expect(parseArgs(['stats', '--from', 'v1.0'])).toMatchObject({
      window: { kind: 'from', value: 'v1.0' },
    });
    expect(parseArgs(['stats', '--from=HEAD~3'])).toMatchObject({
      window: { kind: 'from', value: 'HEAD~3' },
    });
  });
  it('accepts only a positive whole number of days written like 30d, up to 3650d', () => {
    for (const value of ['1d', '30d', '365d', '3650d']) {
      expect(parseArgs(['stats', `--since=${value}`]), value).toBeTruthy();
    }
    for (const value of [
      '30',
      '30.days',
      '30days',
      '2 weeks ago',
      '2026-01-01',
      '0d',
      '00d',
      '030d',
      '-5d',
      '+5d',
      '1.5d',
      '30D',
      ' 30d',
      '30d ',
      'd',
      '3651d',
      '10000d',
      '99999999999999999999d',
    ]) {
      const found = failure(['stats', `--since=${value}`]);
      expect(found?.code, value).toBe('E_USAGE');
      expect(found?.subject, value).toBe('--since');
      expect(found?.message, value).toContain('30d');
    }
  });
  it('--since and --from together are refused, naming both', () => {
    const found = failure(['stats', '--since', '7d', '--from', 'v1']);
    expect(found?.subject).toBe('--since');
    expect(found?.message).toContain('--from');
    expect(failure(['stats', '--from', 'v1', '--since', '7d'])?.message).toContain('--since');
  });
  it('a value that is an option is a missing value', () => {
    for (const argv of [
      ['stats', '--since'],
      ['stats', '--since', '--json'],
      ['stats', '--since='],
      ['stats', '--from'],
      ['stats', '--from', '--root'],
      ['stats', '--from='],
      ['stats', '--from=-x'],
    ]) {
      expect(failure(argv)?.code, argv.join(' ')).toBe('E_USAGE');
    }
  });
  it('refuses an option given twice, and the options on any other command', () => {
    expect(failure(['stats', '--since', '1d', '--since', '2d'])?.subject).toBe('--since');
    expect(failure(['check', '--since', '7d'])?.subject).toBe('--since');
    expect(failure(['--from', 'v1'])?.subject).toBe('--from');
    expect(failure(['list-dependencies', '--from=v1'])?.subject).toBe('--from');
    expect(failure(['update', '--all', '--since=7d'])?.subject).toBe('--since');
  });
  it('there is no gate and no threshold option', () => {
    for (const option of ['--max-fire-ratio=0.5', '--sweep-threshold=5', '--max-fire-ratio']) {
      const found = failure(['stats', option]);
      expect(found?.code, option).toBe('E_USAGE');
      expect(found?.message, option).toContain('Unknown option');
    }
  });
  it('a file named stats is reached after --', () => {
    expect(parseArgs(['--', 'stats'])).toMatchObject({ mode: 'check', paths: ['stats'] });
  });
});
