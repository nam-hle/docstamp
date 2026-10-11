import { expect } from 'vitest';
import { scenario } from './harness/index.ts';

const options = { fixture: 'structured' };

const WRITTEN =
  'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n' +
  '      - path: package.json\n        select: scripts.build\n' +
  '      - path: ci.yml\n        select: jobs.test.steps.1.run\n';

const SHORTHAND =
  'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n' +
  '      - package.json:scripts.build\n' +
  '      - ci.yml:jobs.test.steps.1.run\n';

scenario(
  '§8.7 a shorthand and the Map it stands for have one Dependency Hash',
  options,
  async (repo) => {
    repo.write('docstamp.yaml', WRITTEN);
    repo.commit('initial');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    const written = repo.read('docstamp-lock.yaml');
    repo.write('docstamp.yaml', SHORTHAND);
    expect(await repo.run([])).toMatchObject({ exit: 0, stdout: '1 ok, 0 stale, 0 invalid\n' });
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    expect(repo.read('docstamp-lock.yaml')).toBe(written);
  },
);

scenario(
  '§8.7 a Value Path with "," "=" and ":" is the text after the first colon',
  options,
  async (repo) => {
    repo.write('package.json', '{"a,b=c:d":{"e":1}}\n');
    repo.write(
      'docstamp.yaml',
      'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n' +
        '      - \'package.json:["a,b=c:d"].e\'\n',
    );
    repo.commit('initial');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    repo.write('package.json', '{"a,b=c:d":{"e":2}}\n');
    const stale = await repo.run([]);
    expect(stale.exit).toBe(1);
    expect(stale.stdout).toContain('STALE    CLAUDE.md  (content-changed)');
  },
);

scenario('§8.7 a shorthand whose value is missing is E_SELECT_NOT_FOUND', options, async (repo) => {
  repo.write(
    'docstamp.yaml',
    'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - package.json:scripts.nope\n',
  );
  const result = await repo.run([], { expectExit: 2 });
  expect(result.stderr).toContain('E_SELECT_NOT_FOUND');
  expect(result.stderr).toContain('scripts.nope');
});

const refusedConfig = (dependency: string) =>
  `version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - "${dependency}"\n`;

scenario('§8.7 ParseShorthand a glob before the colon is E_CONFIG', options, async (repo) => {
  repo.write('docstamp.yaml', refusedConfig('src/*.ts:x'));
  const result = await repo.run([], { expectExit: 2 });
  expect(result.stderr).toContain('E_CONFIG');
  expect(result.stderr).toContain('literal file path');
});

scenario('§8.7 ParseShorthand an empty path is E_CONFIG', options, async (repo) => {
  repo.write('docstamp.yaml', refusedConfig(':x'));
  expect((await repo.run([], { expectExit: 2 })).stderr).toContain('E_CONFIG');
});

scenario('§8.7 ParseShorthand an empty selector is E_CONFIG', options, async (repo) => {
  repo.write('docstamp.yaml', refusedConfig('package.json:'));
  expect((await repo.run([], { expectExit: 2 })).stderr).toContain('E_CONFIG');
});

scenario(
  '§8.7 an escaped colon is a Pattern for a file whose name holds one',
  options,
  async (repo) => {
    repo.write('notes:2024.md', '# notes\n');
    repo.write(
      'docstamp.yaml',
      'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - notes\\:2024.md\n',
    );
    repo.commit('initial');
    await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
    repo.write('notes:2024.md', '# notes, edited\n');
    const stale = await repo.run([]);
    expect(stale.exit).toBe(1);
    expect(stale.stdout).toContain('STALE    CLAUDE.md  (content-changed)');
    expect(stale.stdout).toContain('depends   "notes\\\\:2024.md"');
  },
);

scenario(
  '§8.7 an unescaped colon in a file name names a path that is not there',
  options,
  async (repo) => {
    repo.write('notes:2024.md', '# notes\n');
    repo.write(
      'docstamp.yaml',
      'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - notes:2024.md\n',
    );
    const result = await repo.run([], { expectExit: 2 });
    expect(result.stderr).toContain('E_EMPTY_PATTERN');
    expect(result.stderr).toContain(
      'If "notes:2024.md" is a file name, write "\\:" for each ":" of it.',
    );
  },
);

scenario('§9.6.2 step 6 an inline block holds a shorthand', options, async (repo) => {
  repo.write(
    'GUIDE.md',
    '---\ndocstamp:\n  dependencies:\n    - package.json:scripts.build\n---\n\n# G\n',
  );
  repo.commit('initial');
  const check = await repo.run(['GUIDE.md'], { show: ['GUIDE.md'] });
  expect(check.exit).toBe(1);
  expect(check.stdout).toContain('depends   "package.json#\\"scripts.build\\""');
  await repo.run(['update', 'GUIDE.md'], { expectExit: 0 });
  repo.commit('review');
  expect((await repo.run(['GUIDE.md'])).exit).toBe(0);
});

scenario(
  '§9.6.2 step 6 a glob before the colon in an inline block is E_BLOCK',
  options,
  async (repo) => {
    repo.write('GUIDE.md', '---\ndocstamp:\n  dependencies:\n    - "src/*.ts:x"\n---\n\n# G\n');
    const result = await repo.run(['GUIDE.md'], { expectExit: 2 });
    expect(result.stderr).toContain('E_BLOCK');
  },
);

scenario('§12.3 step 1.4 a shorthand is not a pattern of the own list', options, async (repo) => {
  repo.write('src/a.ts', 'a\n');
  repo.write(
    'docstamp.yaml',
    'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - src/**\n      - package.json:scripts.build\n',
  );
  repo.commit('initial');
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  repo.commit('review');
  repo.append('src/a.ts', '// edit\n');
  const stale = await repo.run([]);
  expect(stale.exit).toBe(1);
  expect(stale.stdout).not.toContain('edited');
});

scenario('§12.3 step 1.4 a shorthand edited after the review is an edit', options, async (repo) => {
  const config = (selector: string) =>
    `version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - src/**\n      - package.json:${selector}\n`;
  repo.write('src/a.ts', 'a\n');
  repo.write('docstamp.yaml', config('scripts.build'));
  repo.commit('initial');
  await repo.run(['update', 'CLAUDE.md'], { expectExit: 0 });
  repo.commit('review');
  repo.write('docstamp.yaml', config('scripts.test'));
  const stale = await repo.run([]);
  expect(stale.exit).toBe(1);
  expect(stale.stdout).toContain('edited');
  expect(stale.stdout).toContain('docstamp.yaml');
});
