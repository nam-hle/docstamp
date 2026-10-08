import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { E2E_DIR, REPO_DIR, hermeticEnv } from './harness/repo.ts';

describe('§9.5 the packed tarball works from node_modules', () => {
  let tmp = '';
  let project = '';
  const packaged = () => join(tmp, 'node_modules', 'docstamp');
  const docstamp = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [join('..', 'node_modules', 'docstamp', 'dist', 'index.js'), ...args],
      {
        cwd: project,
        encoding: 'utf8',
        env: hermeticEnv(join(tmp, 'home')),
      },
    );

  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'docstamp-pack-')));
    mkdirSync(join(tmp, 'home'));
    const env = {
      ...hermeticEnv(join(tmp, 'home')),
      npm_config_cache: join(tmp, 'npm-cache'),
      npm_config_update_notifier: 'false',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    };
    const pack = spawnSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', tmp],
      { cwd: REPO_DIR, encoding: 'utf8', env, shell: process.platform === 'win32' },
    );
    if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr}`);
    const [{ filename }] = JSON.parse(pack.stdout) as [{ filename: string }];

    const extract = join(tmp, 'extract');
    mkdirSync(extract);
    const tar = spawnSync('tar', ['-xzf', join(tmp, filename), '-C', extract], {
      encoding: 'utf8',
    });
    if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
    mkdirSync(join(tmp, 'node_modules'));
    renameSync(join(extract, 'package'), packaged());
    symlinkSync(
      realpathSync(join(REPO_DIR, 'node_modules', 'yaml')),
      join(tmp, 'node_modules', 'yaml'),
    );

    project = join(tmp, 'project');
    cpSync(join(E2E_DIR, 'fixtures', 'ts-config'), project, { recursive: true });
    // `npm pack` through a shell takes longer than vitest's 10 s default on Windows.
  }, 60_000);

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ships the built files and nothing else', () => {
    for (const file of [
      'dist/index.js',
      'dist/lib.js',
      'dist/lib.d.ts',
      'schema.json',
      'schema-frontmatter.json',
      'package.json',
    ]) {
      expect(existsSync(join(packaged(), file)), file).toBe(true);
    }
    const top = readdirSync(packaged());
    for (const leaked of ['src', 'tests', 'docs', 'scripts', 'node_modules']) {
      expect(top).not.toContain(leaked);
    }
  });

  it('runs the installed bin on a docstamp.config.ts that imports docstamp', () => {
    const first = docstamp();
    expect({ status: first.status, stderr: first.stderr }).toEqual({ status: 1, stderr: '' });
    expect(first.stdout).toContain('STALE    CLAUDE.md  (unrecorded)');

    const update = docstamp('update', '--all');
    expect(update).toMatchObject({ status: 0, stdout: 'written  CLAUDE.md\n', stderr: '' });

    expect(docstamp()).toMatchObject({
      status: 0,
      stdout: '1 ok, 0 stale, 0 invalid\n',
      stderr: '',
    });
  });

  it('prints the version of the package it was packed from', () => {
    const result = docstamp('--version');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/u);
  });
});
