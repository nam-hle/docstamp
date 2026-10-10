import { expect } from 'vitest';
import { scenario, type Repo } from './harness/index.ts';

const fixture = 'docs-site';

const MODES: [string, string[]][] = [
  ['check', []],
  ['check json', ['--json']],
  ['list-dependencies', ['list-dependencies']],
  ['list-dependencies json', ['list-dependencies', '--json']],
  ['list-dependents', ['list-dependents', 'src/cli/run.ts', 'README.md']],
  ['list-dependents json', ['list-dependents', '--json', 'src/cli/run.ts', 'README.md']],
];

async function everything(repo: Repo) {
  const outputs: Record<string, [number, string, string]> = {};
  for (const [name, args] of MODES) {
    const r = await repo.run(args, { snapshot: false });
    outputs[name] = [r.exit, r.stdout, r.stderr];
  }
  const update = await repo.run(['update', '--all', '--json'], { snapshot: false });
  outputs['update json'] = [update.exit, update.stdout, update.stderr];
  outputs['lock'] = [0, repo.read('docstamp-lock.yaml'), ''];
  return outputs;
}

scenario('§2 two runs on the same tree are byte-identical', { fixture }, async (repo) => {
  const first = await everything(repo);
  repo.remove('docstamp-lock.yaml');
  const second = await everything(repo);
  expect(second).toEqual(first);
  await repo.run([], { label: 'check, the baseline for the comparison' });
});

scenario(
  '§14.1 text mode splits streams, JSON mode keeps stderr empty',
  { fixture },
  async (repo) => {
    repo.write(
      'docstamp.yaml',
      repo.read('docstamp.yaml') + '  GONE.md:\n    dependencies: [src/**]\n',
    );
    await repo.run(['update', 'README.md'], { expectExit: 0 });
    const commands: string[][] = [[], ['list-dependencies']];
    for (const args of commands) {
      const text = await repo.run(args, { snapshot: false });
      expect(text.stdout, args.join(' ')).not.toMatch(/E_[A-Z_]+/u);
      expect(text.stderr, args.join(' ')).toMatch(/^error: E_FILE_MISSING: GONE\.md: /mu);
      const json = await repo.run([...args, '--json'], { snapshot: false });
      expect(json.stderr, args.join(' ')).toBe('');
      expect(JSON.parse(json.stdout).exitCode, args.join(' ')).toBe(json.exit);
    }
  },
);

scenario('§14.1 output carries no color, BOM or CR', { fixture }, async (repo) => {
  const result = await repo.run([]);
  const all = result.stdout + result.stderr;
  expect(all).not.toContain('\u001b');
  expect(all).not.toContain('\r');
  expect(all.charCodeAt(0)).not.toBe(0xfeff);
  expect(result.stdout.endsWith('\n')).toBe(true);
});

scenario(
  '§14.5 every JSON document carries version 2, mode, exitCode and diagnostics',
  { fixture },
  async (repo) => {
    await repo.run(['update', '--all'], { expectExit: 0 });
    repo.append('src/util.ts', '// edit\n');
    const modes: [string[], string][] = [
      [['--json'], 'check'],
      [['update', '--json', 'CLAUDE.md'], 'update'],
      [['list-dependencies', '--json'], 'list-dependencies'],
      [['list-dependents', '--json', 'src/util.ts'], 'list-dependents'],
    ];
    for (const [args, mode] of modes) {
      const doc = (await repo.run(args, { snapshot: false })).json();
      expect(doc.version, mode).toBe(2);
      expect(doc.mode, mode).toBe(mode);
      expect(typeof doc.exitCode, mode).toBe('number');
      expect(Array.isArray(doc.diagnostics), mode).toBe(true);
      expect(Array.isArray(doc.files), mode).toBe(true);
      expect('summary' in doc, mode).toBe(mode === 'check' || mode === 'update');
    }
    const diagnostic = (
      await repo.run(['--json', 'missing.md'], { label: 'a diagnostic as JSON' })
    ).json().diagnostics[0];
    expect(Object.keys(diagnostic)).toEqual(['code', 'severity', 'file', 'subject', 'message']);
    expect(diagnostic).toMatchObject({
      code: 'E_UNKNOWN_FILE',
      severity: 'error',
      file: null,
      subject: 'missing.md',
    });
  },
);
