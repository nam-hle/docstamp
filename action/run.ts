import { appendFileSync, readFileSync } from 'node:fs';

import { MARKER, renderComment, type Report } from './render.ts';

export interface Env {
  GITHUB_TOKEN?: string;
  GITHUB_EVENT_NAME?: string;
  GITHUB_EVENT_PATH?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_STEP_SUMMARY?: string;
  GITHUB_API_URL?: string;
  DOCSTAMP_REPORT: string;
  DOCSTAMP_COMMENT: string;
}

interface Api {
  fetch: typeof fetch;
  readFile: (path: string) => string;
  appendFile: (path: string, text: string) => void;
  warn: (message: string) => void;
}

interface PullRequest {
  number: number;
  headRepository: string;
}

interface Comment {
  id: number;
  body: string;
}

const PAGE_SIZE = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readPullRequest = (event: unknown): PullRequest | undefined => {
  if (!isRecord(event) || !isRecord(event['pull_request'])) return undefined;
  const { number, head } = event['pull_request'];
  if (typeof number !== 'number' || !isRecord(head) || !isRecord(head['repo'])) return undefined;
  const fullName = head['repo']['full_name'];
  return typeof fullName === 'string' ? { number, headRepository: fullName } : undefined;
};

const call = async (api: Api, env: Env, method: string, url: string, body?: unknown) => {
  const response = await api.fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN ?? ''}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${url} failed with ${response.status}`);
  return response.json() as Promise<unknown>;
};

const findComment = async (
  api: Api,
  env: Env,
  base: string,
  number: number,
): Promise<Comment | undefined> => {
  for (let page = 1; ; page++) {
    const url = `${base}/issues/${number}/comments?per_page=${PAGE_SIZE}&page=${page}`;
    const comments = (await call(api, env, 'GET', url)) as Comment[];
    const found = comments.find((comment) => comment.body.includes(MARKER));
    if (found !== undefined) return found;
    if (comments.length < PAGE_SIZE) return undefined;
  }
};

export const run = async (env: Env, api: Api): Promise<void> => {
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  let report: Report;
  try {
    report = JSON.parse(api.readFile(env.DOCSTAMP_REPORT)) as Report;
  } catch {
    if (summaryPath) api.appendFile(summaryPath, 'docstamp: the report is not valid JSON.\n');
    return;
  }

  const body = renderComment(report);
  if (summaryPath) api.appendFile(summaryPath, body);

  if (env.DOCSTAMP_COMMENT !== 'true' || env.GITHUB_EVENT_NAME !== 'pull_request') return;
  const pullRequest = readPullRequest(JSON.parse(api.readFile(env.GITHUB_EVENT_PATH ?? '')));
  if (pullRequest === undefined || pullRequest.headRepository !== env.GITHUB_REPOSITORY) return;

  const base = `${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}`;
  try {
    const existing = await findComment(api, env, base, pullRequest.number);
    if (existing !== undefined) {
      await call(api, env, 'PATCH', `${base}/issues/comments/${existing.id}`, { body });
    } else if (report.exitCode !== 0) {
      await call(api, env, 'POST', `${base}/issues/${pullRequest.number}/comments`, { body });
    }
  } catch (error) {
    api.warn(`docstamp: could not post the comment: ${(error as Error).message}`);
  }
};

if (import.meta.main) {
  await run(process.env as unknown as Env, {
    fetch,
    readFile: (path) => readFileSync(path, 'utf8'),
    appendFile: appendFileSync,
    warn: (message) => console.log(`::warning::${message}`),
  });
}
