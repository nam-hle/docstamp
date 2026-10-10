import { statSync, utimesSync } from 'node:fs';
import { expect } from 'vitest';
import { scenario } from '../harness/index.ts';

const fixture = 'docs-site';
const ROOT_ENTRIES = [
  'CLAUDE.md',
  'README.md',
  'docs',
  'docstamp-lock.yaml',
  'docstamp.yaml',
  'src',
];

scenario('§11.3 an unchanged lock is left untouched', { fixture }, async (repo) => {
  await repo.run(['update', '--all'], { expectExit: 0 });
  const lockPath = repo.path('docstamp-lock.yaml');
  const before = repo.read('docstamp-lock.yaml');
  const old = new Date('2001-01-01T00:00:00Z');
  utimesSync(lockPath, old, old);
  const inode = statSync(lockPath).ino;

  const again = await repo.run(['update', '--all']);
  expect(again.exit).toBe(0);
  expect(again.stdout).toBe(
    'unchanged  CLAUDE.md\nunchanged  README.md\nunchanged  docs/guide.md\n',
  );
  expect(repo.read('docstamp-lock.yaml')).toBe(before);
  expect(statSync(lockPath).mtimeMs).toBe(old.getTime());
  expect(statSync(lockPath).ino).toBe(inode);

  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  expect(statSync(lockPath).mtimeMs).toBe(old.getTime());
});

scenario(
  '§11.3 a changed lock is replaced atomically, leaving no temp files',
  { fixture },
  async (repo) => {
    await repo.run(['update', '--all'], { expectExit: 0 });
    const old = new Date('2001-01-01T00:00:00Z');
    utimesSync(repo.path('docstamp-lock.yaml'), old, old);
    repo.append('src/util.ts', '// changed\n');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    expect(statSync(repo.path('docstamp-lock.yaml')).mtimeMs).toBeGreaterThan(old.getTime());
    expect(repo.list()).toEqual(ROOT_ENTRIES);
  },
);
