import { describe, expect, it } from 'vitest';

import { MARKER, renderComment, type Report } from '../../action/render.ts';

const base: Report = { version: 2, exitCode: 0, files: [], diagnostics: [] };

const stale = (overrides: Partial<Report['files'][number]> = {}): Report['files'][number] => ({
  file: 'CLAUDE.md',
  state: 'stale',
  reasons: ['content-changed'],
  dependencies: ['src/**'],
  changes: [{ status: 'modified', path: 'src/cli/run.ts', via: ['src/**'] }],
  diagnostics: [],
  ...overrides,
});

describe('action comment renderer', () => {
  it('starts with the marker', () => {
    expect(renderComment(base).startsWith(`${MARKER}\n`)).toBe(true);
  });

  it('says all clear on exit 0', () => {
    expect(renderComment({ ...base, summary: { ok: 3, stale: 0, invalid: 0 } })).toContain(
      'All 3 files are up to date',
    );
  });

  it('lists a stale file, its changes and the update command', () => {
    const body = renderComment({
      ...base,
      exitCode: 1,
      summary: { ok: 1, stale: 1, invalid: 0 },
      files: [stale()],
    });
    expect(body).toContain('1 file needs review');
    expect(body).toContain('`CLAUDE.md`');
    expect(body).toContain('modified `src/cli/run.ts` (via `src/**`)');
    expect(body).toContain('docstamp update CLAUDE.md');
    expect(body).toContain('never `--all`');
  });

  it('lists the patterns when changes are unknown', () => {
    const body = renderComment({
      ...base,
      exitCode: 1,
      summary: { ok: 0, stale: 1, invalid: 0 },
      files: [stale({ changes: null, dependencies: ['src/**', '!src/**/*.test.ts'] })],
    });
    expect(body).toContain('Git history is not available');
    expect(body).toContain('`src/**`');
    expect(body).toContain('`!src/**/*.test.ts`');
  });

  it('shows an invalid file with its diagnostics and the check command', () => {
    const body = renderComment({
      ...base,
      exitCode: 2,
      summary: { ok: 0, stale: 0, invalid: 1 },
      files: [
        {
          file: 'README.md',
          state: 'invalid',
          reasons: [],
          dependencies: [],
          changes: null,
          diagnostics: [
            {
              code: 'E_EMPTY_PATTERN',
              severity: 'error',
              file: 'README.md',
              subject: 'src/gone',
              message: 'The pattern matches no file.',
            },
          ],
        },
      ],
    });
    expect(body).toContain('E_EMPTY_PATTERN');
    expect(body).toContain('The pattern matches no file.');
    expect(body).toContain('docstamp check README.md');
    expect(body).not.toContain('docstamp update README.md');
  });

  it('shows global diagnostics when nothing was evaluated', () => {
    const body = renderComment({
      ...base,
      exitCode: 2,
      diagnostics: [
        {
          code: 'E_CONFIG',
          severity: 'error',
          file: null,
          subject: null,
          message: 'The configuration is not valid.',
        },
      ],
    });
    expect(body).toContain('E_CONFIG');
    expect(body).toContain('The configuration is not valid.');
    expect(body).not.toContain('up to date');
  });

  it('lists a paired rename once', () => {
    const body = renderComment({
      ...base,
      exitCode: 1,
      summary: { ok: 0, stale: 1, invalid: 0 },
      files: [
        stale({
          changes: [
            { status: 'added', path: 'src/b.ts', via: ['src/**'] },
            { status: 'deleted', path: 'src/a.ts', via: ['src/**'], pair: 'src/b.ts' },
          ],
        }),
      ],
    });
    expect(body).toContain('renamed `src/a.ts` -> `src/b.ts`');
    expect(body).not.toContain('added `src/b.ts`');
    expect(body).not.toContain('deleted `src/a.ts`');
  });

  it('does not claim missing git history for an unrecorded file', () => {
    const body = renderComment({
      ...base,
      exitCode: 1,
      summary: { ok: 0, stale: 1, invalid: 0 },
      files: [stale({ changes: null, reasons: ['unrecorded'] })],
    });
    expect(body).not.toContain('Git history is not available');
    expect(body).toContain('No lock entry yet');
    expect(body).toContain('`src/**`');
  });

  it('says the dependency list was edited and lists the selection changes', () => {
    const body = renderComment({
      ...base,
      exitCode: 1,
      summary: { ok: 0, stale: 1, invalid: 0 },
      files: [
        stale({
          changes: [],
          dependenciesEdited: true,
          selection: [{ status: 'added', path: 'src/new.ts' }],
        }),
      ],
    });
    expect(body).toContain('dependency list was edited');
    expect(body).toContain('added `src/new.ts` (selection)');
  });

  it('keeps the update command and the footer when the changes are capped', () => {
    const changes = Array.from({ length: 5000 }, (_, index) => ({
      status: 'modified',
      path: `src/generated/file-${index}.ts`,
      via: ['src/**'],
    }));
    const body = renderComment({
      ...base,
      exitCode: 1,
      summary: { ok: 0, stale: 2, invalid: 0 },
      files: [stale({ changes }), stale({ file: 'README.md' })],
    });
    expect(body).toContain('and 4950 more');
    expect(body).toContain('docstamp update CLAUDE.md');
    expect(body).toContain('docstamp update README.md');
    expect(body).toContain('never `--all`');
  });

  it('stays under the comment size limit and counts what it cut', () => {
    const changes = Array.from({ length: 5000 }, (_, index) => ({
      status: 'modified',
      path: `src/generated/file-${index}.ts`,
      via: ['src/**'],
    }));
    const body = renderComment({
      ...base,
      exitCode: 1,
      summary: { ok: 0, stale: 1, invalid: 0 },
      files: [stale({ changes })],
    });
    expect(body.length).toBeLessThan(65_000);
    expect(body).toMatch(/and \d+ more/);
  });
});
