import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../../src');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : [join(dir, entry.name)],
  );

const importing = (module: RegExp): string[] =>
  sources(SRC)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => module.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file).replaceAll('\\', '/'))
    .sort();

describe('the host boundary', () => {
  it('only src/host/node-fs.ts imports the file system', () => {
    expect(importing(/from '(node:)?fs(\/promises)?'/u)).toEqual(['host/node-fs.ts']);
  });
  it('only src/host/node-git.ts starts a process', () => {
    expect(importing(/from '(node:)?child_process'/u)).toEqual(['host/node-git.ts']);
  });
  it('only src/host/node-git.ts reads the clock', () => {
    expect(importing(/Date\.now\(|new Date\(\)/u)).toEqual(['host/node-git.ts']);
  });
});
