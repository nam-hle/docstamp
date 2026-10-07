import { expect } from 'vitest';
import { config, scenario } from '../harness/index.ts';

scenario(
  '§6 and §13.4 monorepo: root found by walking up, file arguments against cwd',
  { fixture: 'monorepo' },
  async (repo) => {
    const fromRoot = await repo.run([]);
    expect(fromRoot.stdout).toContain('0 ok, 3 stale, 0 invalid');

    const fromPackage = await repo.run([], { cwd: 'packages/a' });
    expect(fromPackage.stdout).toBe(fromRoot.stdout);

    const named = await repo.run(['README.md'], { cwd: 'packages/a' });
    expect(named.stdout).toContain('STALE    packages/a/README.md  (unrecorded)');
    expect(named.stdout).toContain('1 stale');

    const sibling = await repo.run(['../b/README.md'], { cwd: 'packages/a' });
    expect(sibling.stdout).toContain('packages/b/README.md');

    const fromRootStyle = await repo.run(['packages/a/README.md'], { cwd: 'packages/a' });
    expect(fromRootStyle.exit).toBe(2);
    expect(fromRootStyle.stderr).toContain('E_UNKNOWN_FILE: packages/a/README.md');

    const absolute = await repo.run([repo.path('ROOT.md')], { cwd: 'packages/a' });
    expect(absolute.stdout).toContain('STALE    ROOT.md');
  },
);

scenario(
  '§13.6 monorepo: update from a package directory',
  { fixture: 'monorepo' },
  async (repo) => {
    const update = await repo.run(['update', 'README.md', '../b/README.md'], { cwd: 'packages/a' });
    expect(update.stdout).toBe('written  packages/a/README.md\nwritten  packages/b/README.md\n');
    expect(repo.exists('packages/a/docstamp-lock.yaml')).toBe(false);
    await repo.snapFile('docstamp-lock.yaml');

    repo.append('packages/a/src/index.ts', '// changed\n');
    const check = await repo.run([], { cwd: 'packages/b' });
    expect(check.exit).toBe(1);
    expect(check.stdout).toContain('STALE    packages/a/README.md  (content-changed)');
    expect(check.stdout).toContain('STALE    packages/b/README.md  (content-changed)');
    expect(check.stdout).toContain('STALE    ROOT.md  (unrecorded)');
  },
);

scenario(
  '§13 monorepo: list-dependencies and list-dependents from a package',
  { fixture: 'monorepo' },
  async (repo) => {
    const deps = await repo.run(['list-dependencies', '../b/README.md'], { cwd: 'packages/a' });
    expect(deps.stdout).toBe(
      'packages/b/README.md\n  depends   packages/b/src/**\n  depends   packages/a/src/index.ts\n' +
        '  resolved  packages/a/src/index.ts\n  resolved  packages/b/src/index.ts\n',
    );

    const reverse = await repo.run(['list-dependents', 'src/index.ts'], { cwd: 'packages/a' });
    expect(reverse.stdout).toBe(
      'packages/a/src/index.ts\n  packages/a/README.md   via packages/a/src/**\n' +
        '  packages/b/README.md   via packages/a/src/index.ts\n',
    );

    const outside = await repo.run(['list-dependents', '../../../x'], { cwd: 'packages/a' });
    expect(outside.exit).toBe(2);
    expect(outside.stderr).toContain('E_USAGE');

    const wide = await repo.run(['list-dependents', 'package.json', '../b/package.json'], {
      cwd: 'packages/a',
    });
    expect(wide.stdout).toContain('  ROOT.md   via packages/*/package.json\n');
  },
);

scenario(
  '§6 --root overrides the upward search and resolves against cwd',
  { fixture: 'monorepo' },
  async (repo) => {
    const dotdot = await repo.run(['--root', '../..'], { cwd: 'packages/a' });
    expect(dotdot.stdout).toContain('0 ok, 3 stale');

    const equals = await repo.run(['--root=../..', 'ROOT.md'], { cwd: 'packages/a' });
    expect(equals.exit).toBe(2);
    expect(equals.stderr).toContain('E_UNKNOWN_FILE: ROOT.md');

    const withFile = await repo.run(['--root=../..', '../../ROOT.md'], { cwd: 'packages/a' });
    expect(withFile.stdout).toContain('1 stale');
    expect(withFile.stdout).toContain(
      'next: review each stale file against its dependencies, then run: docstamp update ROOT.md --root ../..\n',
    );

    const absolute = await repo.run(['--root', repo.root, 'update', 'ROOT.md'], {
      cwd: 'packages/a',
    });
    expect(absolute.exit).toBe(2);

    const noConfig = await repo.run(['--root', '.'], { cwd: 'packages/a' });
    expect(noConfig.exit).toBe(2);
    expect(noConfig.stderr).toContain('E_CONFIG_MISSING');

    const json = await repo.run(['update', '--all', '--json', '--root', repo.root], {
      cwd: 'packages/b',
    });
    expect(json.json().files.map((f: { file: string }) => f.file)).toEqual([
      'ROOT.md',
      'packages/a/README.md',
      'packages/b/README.md',
    ]);
    expect(repo.exists('docstamp-lock.yaml')).toBe(true);
  },
);

scenario(
  '§6 nested configuration: the nearest docstamp.yaml is the Root',
  { fixture: 'nested-config' },
  async (repo) => {
    const fromRoot = await repo.run(['--json']);
    expect(fromRoot.json().files.map((f: { file: string }) => f.file)).toEqual(['ROOT.md']);

    const fromSub = await repo.run(['--json'], { cwd: 'sub' });
    expect(fromSub.json().files.map((f: { file: string }) => f.file)).toEqual(['SUB.md']);

    const fromDeep = await repo.run(['update', '--all'], { cwd: 'sub/deep' });
    expect(fromDeep.stdout).toBe('written  SUB.md\n');
    expect(repo.exists('sub/docstamp-lock.yaml')).toBe(true);
    expect(repo.exists('docstamp-lock.yaml')).toBe(false);

    const shadowed = await repo.run(['ROOT.md'], { cwd: 'sub/deep' });
    expect(shadowed.exit).toBe(2);
    expect(shadowed.stderr).toContain('E_UNKNOWN_FILE: ROOT.md');

    const escape = await repo.run(['--root', '..', '--json'], { cwd: 'sub/deep' });
    expect(escape.json().files.map((f: { file: string }) => f.file)).toEqual(['SUB.md']);

    const upper = await repo.run(['--root', '../..', '../../ROOT.md'], { cwd: 'sub/deep' });
    expect(upper.stdout).toContain('ROOT.md  (unrecorded)');
    await repo.snapFile('sub/docstamp-lock.yaml');
  },
);

scenario(
  '§7.2 a nested configuration file is an ordinary file of the outer Universe',
  { fixture: 'nested-config' },
  async (repo) => {
    repo.write('docstamp.yaml', config({ 'ROOT.md': ['**'] }));
    const result = await repo.run(['list-dependencies', '--json']);
    const resolved: string[] = result.json().files[0].resolvedFiles;
    expect(resolved).toContain('sub/SUB.md');
    expect(resolved).toContain('sub/docstamp.yaml');
    expect(resolved).not.toContain('docstamp.yaml');
    expect(resolved).not.toContain('docstamp-lock.yaml');
  },
);
