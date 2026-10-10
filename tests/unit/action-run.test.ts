import { describe, expect, it } from 'vitest';

import { type Env, run } from '../../action/run.ts';
import { MARKER } from '../../action/render.ts';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

interface Scenario {
  report: unknown;
  event?: unknown;
  env?: Partial<Env>;
  pages?: unknown[][];
  status?: number;
}

const sameRepoEvent = { pull_request: { number: 7, head: { repo: { full_name: 'o/r' } } } };
const forkEvent = { pull_request: { number: 7, head: { repo: { full_name: 'fork/r' } } } };

const staleReport = {
  version: 2,
  exitCode: 1,
  summary: { ok: 0, stale: 1, invalid: 0 },
  files: [
    {
      file: 'CLAUDE.md',
      state: 'stale',
      reasons: ['content-changed'],
      dependencies: ['src/**'],
      changes: [{ status: 'modified', path: 'src/a.ts', via: ['src/**'] }],
      diagnostics: [],
    },
  ],
  diagnostics: [],
};

const okReport = {
  version: 2,
  exitCode: 0,
  summary: { ok: 2, stale: 0, invalid: 0 },
  files: [],
  diagnostics: [],
};

const API = 'https://api.github.com/repos/o/r/issues';

const execute = async (scenario: Scenario) => {
  const calls: Call[] = [];
  const summary: string[] = [];
  const files = new Map<string, string>([
    [
      'report.json',
      typeof scenario.report === 'string' ? scenario.report : JSON.stringify(scenario.report),
    ],
    ['event.json', JSON.stringify(scenario.event ?? sameRepoEvent)],
  ]);
  const pages = [...(scenario.pages ?? [[]])];
  const fetchStub = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? 'GET',
      url,
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    const status = scenario.status ?? 200;
    const payload = (init.method ?? 'GET') === 'GET' ? (pages.shift() ?? []) : { id: 1 };
    return new Response(JSON.stringify(payload), { status });
  }) as typeof fetch;
  const env: Env = {
    GITHUB_TOKEN: 'secret',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: 'event.json',
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_STEP_SUMMARY: 'summary.md',
    DOCSTAMP_REPORT: 'report.json',
    DOCSTAMP_COMMENT: 'true',
    ...scenario.env,
  };
  const warnings: string[] = [];
  const api = {
    fetch: fetchStub,
    readFile: (path: string) => files.get(path) ?? '',
    appendFile: (_path: string, text: string) => void summary.push(text),
    warn: (message: string) => void warnings.push(message),
  };
  await run(env, api);
  return { calls, summary, warnings };
};

describe('action runner', () => {
  it('creates one comment on a stale same-repo pull request', async () => {
    const { calls, summary } = await execute({ report: staleReport });
    const writes = calls.filter((call) => call.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe('POST');
    expect(writes[0]?.url).toBe(`${API}/7/comments`);
    expect(writes[0]?.body).toContain(MARKER);
    expect(writes[0]?.headers.Authorization).toBe('Bearer secret');
    expect(summary.join('')).toContain('1 file needs review');
  });

  it('updates the existing marker comment instead of creating another', async () => {
    const { calls } = await execute({
      report: staleReport,
      pages: [
        [
          { id: 5, body: 'unrelated' },
          { id: 9, body: `${MARKER}\nold` },
        ],
      ],
    });
    const writes = calls.filter((call) => call.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe('PATCH');
    expect(writes[0]?.url).toBe(`${API}/comments/9`);
  });

  it('rewrites an existing comment to all clear on exit 0', async () => {
    const { calls } = await execute({
      report: okReport,
      pages: [[{ id: 9, body: `${MARKER}\nold` }]],
    });
    const writes = calls.filter((call) => call.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe('PATCH');
    expect(writes[0]?.body).toContain('up to date');
  });

  it('does nothing on exit 0 when no comment exists', async () => {
    const { calls } = await execute({ report: okReport });
    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  });

  it('finds the marker comment on the second page of comments', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 100, body: 'x' }));
    const { calls } = await execute({
      report: staleReport,
      pages: [fullPage, [{ id: 9, body: MARKER }]],
    });
    const writes = calls.filter((call) => call.method !== 'GET');
    expect(writes[0]?.method).toBe('PATCH');
    expect(writes[0]?.url).toBe(`${API}/comments/9`);
  });

  it('skips the comment for a fork pull request but still writes the summary', async () => {
    const { calls, summary } = await execute({ report: staleReport, event: forkEvent });
    expect(calls).toHaveLength(0);
    expect(summary.join('')).toContain('1 file needs review');
  });

  it('skips the comment when the event is not a pull_request', async () => {
    const { calls, summary } = await execute({
      report: staleReport,
      env: { GITHUB_EVENT_NAME: 'push' },
    });
    expect(calls).toHaveLength(0);
    expect(summary.join('')).toContain('needs review');
  });

  it('skips the comment when comment is false', async () => {
    const { calls } = await execute({ report: staleReport, env: { DOCSTAMP_COMMENT: 'false' } });
    expect(calls).toHaveLength(0);
  });

  it('warns with method, url and status on a non-2xx response and does not throw', async () => {
    const { warnings, summary } = await execute({ report: staleReport, status: 403 });
    expect(warnings).toEqual([
      `docstamp: could not post the comment: GET ${API}/7/comments?per_page=100&page=1 failed with 403`,
    ]);
    expect(summary.join('')).toContain('1 file needs review');
  });

  it('writes a one-line summary when the report is not JSON', async () => {
    const { calls, summary } = await execute({ report: 'not json' });
    expect(calls).toHaveLength(0);
    expect(summary.join('')).toContain('not valid JSON');
  });
});
