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
  dependenciesEdited?: boolean;
  selection?: { status: string; path: string }[];
  fragments?: {
    path: string;
    select: unknown;
    status: string;
    focus?: string[];
    lines?: { start: number; end: number }[];
  }[];
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
const MAX_CHANGES = 50;
const code = (text: string): string => `\`${text}\``;
const SAFE = /^[A-Za-z0-9_./:@%+=,-]+$/u;
const quoted = (text: string): string =>
  SAFE.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;

// the command that names a file the way the report does: from the repository top
const command = (verb: string, file: string, root: string): string => {
  const dir = root.replace(/^(\.\/)+/u, '').replace(/\/+$/u, '');
  if (dir === '' || dir === '.') return `docstamp ${verb} ${quoted(file)}`;
  return `docstamp ${verb} ${quoted(`${dir}/${file}`)} --root ${quoted(dir)}`;
};

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

const capped = (lines: string[]): string[] =>
  lines.length <= MAX_CHANGES
    ? lines
    : [...lines.slice(0, MAX_CHANGES), `- ... and ${lines.length - MAX_CHANGES} more`];

const patternLines = (file: FileReport, intro: string): string[] => [
  intro,
  ...file.dependencies.map((pattern) => `- ${code(pattern)}`),
];

const renderStale = (file: FileReport, root: string): string[] => {
  const edited = file.dependenciesEdited === true ? ['- its dependency list was edited'] : [];
  const selection = (file.selection ?? []).map(
    (entry) => `- ${entry.status} ${code(entry.path)} (selection)`,
  );
  const fragments = (file.fragments ?? []).map((entry) => {
    const subject = code(`${entry.path}#${JSON.stringify(entry.select)}`);
    const parts = Array.from(
      { length: Math.max(entry.focus?.length ?? 0, entry.lines?.length ?? 0) },
      (_, index) => {
        const range = entry.lines?.[index];
        const lines = range === undefined ? '' : `lines ${range.start}-${range.end}`;
        const focus = entry.focus?.[index];
        if (focus === undefined) return lines;
        return lines === '' ? focus : `${focus} (${lines})`;
      },
    );
    return `- fragment ${subject} (${entry.status})${parts.length === 0 ? '' : `: ${parts.join('; ')}`}`;
  });
  const unknown = file.reasons.includes('unrecorded')
    ? 'No lock entry yet, so the file was never reviewed. Review it against these dependencies:'
    : 'Git history is not available, so the changed files are unknown. Diff these dependencies:';
  const body =
    file.changes === null
      ? [...edited, ...selection, ...patternLines(file, unknown)]
      : [...edited, ...selection, ...capped(changeLines(file.changes)), ...fragments];
  const next = `After review: ${code(command('update', file.file, root))}`;
  return [`#### ${code(file.file)} (stale)`, '', ...body, '', next];
};

const renderInvalid = (file: FileReport, root: string): string[] => [
  `#### ${code(file.file)} (invalid)`,
  '',
  ...file.diagnostics.map(renderDiagnostic),
  '',
  `After the fix: ${code(command('check', file.file, root))}`,
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

export const renderComment = (report: Report, root = '.'): string => {
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
  const silent = stale.length === 0 && invalid.length === 0 && globalErrors.length === 0;
  const unexplained = silent
    ? [`docstamp exited with code ${report.exitCode} and reported no error; see the job log.`, '']
    : [];

  const lines = [
    MARKER,
    `### docstamp: ${heading.join(', ')}`,
    '',
    ...(globalErrors.length > 0 ? [...globalErrors.map(renderDiagnostic), ''] : []),
    ...unexplained,
    ...stale.flatMap((file) => [...renderStale(file, root), '']),
    ...invalid.flatMap((file) => [...renderInvalid(file, root), '']),
  ];
  const footer =
    stale.length === 0
      ? ''
      : [
          '',
          'Review each stale file against its dependencies, then run `docstamp update <file>`.',
          'Run update only after the review, never `--all` just to pass.',
        ].join('\n');
  return `${fit(lines)}${footer}\n`;
};
