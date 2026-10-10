import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { scenario } from '../harness/index.ts';

const packageVersion = (
  JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

scenario(
  '§13.1 version: every spelling prints the package version',
  { git: false },
  async (repo) => {
    for (const args of [
      ['version'],
      ['--version'],
      ['version', '--bogus'],
      ['--version', 'update'],
    ]) {
      const result = await repo.run(args, { snapshot: false });
      expect(result, args.join(' ')).toMatchObject({
        exit: 0,
        stdout: `${packageVersion}\n`,
        stderr: '',
      });
    }
    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+/u);
  },
);
