export const MARKER = '<!-- docstamp -->';

interface Diagnostic {
  code: string;
  severity: string;
  file: string | null;
  subject: string | null;
  message: string;
}

interface Change {
  status: string;
  path: string;
  via: string[];
  pair?: string;
  whitespaceOnly?: boolean;
}

interface FileReport {
  file: string;
  state: 'ok' | 'stale' | 'invalid';
  reasons: string[];
  dependencies: string[];
  changes: Change[] | null;
  diagnostics: Diagnostic[];
}

export interface Report {
  version: number;
  exitCode: number;
  summary?: { ok: number; stale: number; invalid: number };
  files: FileReport[];
  diagnostics: Diagnostic[];
}

const LIMIT = 60_000;
const code = (text: string): string => `\`${text}\``;
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const renderDiagnostic = (diagnostic: Diagnostic): string => {
  const subject = diagnostic.subject === null ? '' : ` ${code(diagnostic.subject)}`;
  return `- ${code(diagnostic.code)}${subject}: ${diagnostic.message}`;
};

const changeLines = (changes: Change[]): string[] => {
  const pairedAdditions = new Set(
    changes.flatMap((change) => (change.pair === undefined ? [] : [change.pair])),
  );
  return changes.flatMap((change) => {
    if (change.status === 'added' && pairedAdditions.has(change.path)) return [];
    if (change.pair !== undefined) {
      return [`- renamed ${code(change.path)} -> ${code(change.pair)}`];
    }
    const via = change.via.map(code).join(', ');
    return [`- ${change.status} ${code(change.path)} (via ${via})`];
  });
};

const renderStale = (file: FileReport): string[] => {
  const body =
    file.changes === null
      ? [
          'Git history is not available, so the changed files are unknown. Diff these dependencies:',
          ...file.dependencies.map((pattern) => `- ${code(pattern)}`),
        ]
      : changeLines(file.changes);
  const next = `After review: ${code(`docstamp update ${file.file}`)}`;
  return [`#### ${code(file.file)} (stale)`, '', ...body, '', next];
};

const renderInvalid = (file: FileReport): string[] => [
  `#### ${code(file.file)} (invalid)`,
  '',
  ...file.diagnostics.map(renderDiagnostic),
  '',
  `After the fix: ${code(`docstamp check ${file.file}`)}`,
];

const fit = (lines: string[]): string => {
  const kept: string[] = [];
  let size = 0;
  for (const [index, line] of lines.entries()) {
    if (size + line.length + 1 > LIMIT) {
      kept.push('', `... and ${lines.length - index} more lines, see the job log.`);
      break;
    }
    kept.push(line);
    size += line.length + 1;
  }
  return kept.join('\n');
};

export const renderComment = (report: Report): string => {
  const stale = report.files.filter((file) => file.state === 'stale');
  const invalid = report.files.filter((file) => file.state === 'invalid');
  const globalErrors = report.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

  if (report.exitCode === 0) {
    const total = report.summary === undefined ? report.files.length : report.summary.ok;
    return `${MARKER}\n### docstamp\n\nAll ${plural(total, 'file')} are up to date.\n`;
  }

  const heading: string[] = [];
  if (stale.length > 0) {
    heading.push(`${plural(stale.length, 'file')} ${stale.length === 1 ? 'needs' : 'need'} review`);
  }
  if (invalid.length > 0) heading.push(`${plural(invalid.length, 'file')} invalid`);
  if (heading.length === 0) heading.push('the check failed');

  const lines = [
    MARKER,
    `### docstamp: ${heading.join(', ')}`,
    '',
    ...(globalErrors.length > 0 ? [...globalErrors.map(renderDiagnostic), ''] : []),
    ...stale.flatMap((file) => [...renderStale(file), '']),
    ...invalid.flatMap((file) => [...renderInvalid(file), '']),
  ];
  if (stale.length > 0) {
    lines.push(
      'Review each stale file against its dependencies, then run `docstamp update <file>`.',
      'Run update only after the review, never `--all` just to pass.',
    );
  }
  return `${fit(lines)}\n`;
};
