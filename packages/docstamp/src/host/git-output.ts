import type { LogEntry, RawChange } from './git.ts';

const nulFields = (output: string): string[] => {
  const fields = output.split('\0');
  fields.pop();
  return fields.map((f) => f.normalize('NFC'));
};

// SPEC §12.3 step 2
export function parseNameList(output: string): string[] {
  return nulFields(output);
}

// SPEC §12.3 step 2
export function parseNameStatus(output: string): RawChange[] | null {
  if (output !== '' && !output.endsWith('\0')) return null;
  const fields = nulFields(output);
  if (fields.length % 2 !== 0) return null;
  const changes: RawChange[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    changes.push({ status: fields[i] as string, path: fields[i + 1] as string });
  }
  return changes;
}

const TREE_ENTRY = /^(100644|100755) blob ([0-9a-f]+)\t(.*)$/su;

// SPEC §12.3 step 8: path to object name, regular files only
export function parseTree(output: string): Map<string, string> {
  const objects = new Map<string, string>();
  for (const field of nulFields(output)) {
    const match = TREE_ENTRY.exec(field);
    if (match) objects.set(match[3]!, match[2]!);
  }
  return objects;
}

const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const isHeader = (token: string): boolean =>
  token.startsWith('\u0001') && COMMIT_ID.test(token.slice(1));

// SPEC §12.4 step 5: `\u0001<id> NUL <seconds> NUL` then the paths, each ended by NUL
export function parseLog(output: string): LogEntry[] | null {
  const tokens = output.split('\0');
  if (tokens.pop() !== '') return null;
  const commits: LogEntry[] = [];
  let index = 0;
  while (index < tokens.length) {
    const seconds = tokens[index + 1];
    if (!isHeader(tokens[index]!) || seconds === undefined || !/^[0-9]+$/u.test(seconds)) {
      return null;
    }
    index += 2;
    const paths: string[] = [];
    while (index < tokens.length && !isHeader(tokens[index]!)) {
      const path = (
        paths.length === 0 ? tokens[index]!.replace(/^\n/u, '') : tokens[index]!
      ).normalize('NFC');
      if (path !== '') paths.push(path);
      index += 1;
    }
    commits.push({ seconds: Number(seconds), paths });
  }
  return commits;
}
