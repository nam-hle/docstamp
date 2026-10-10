import { parse, type ParserPlugin } from '@babel/parser';

type Program = ReturnType<typeof parse>['program'];
export type Statement = Program['body'][number];

export interface Parsed {
  readonly source: string;
  readonly statements: readonly Statement[];
}

const TYPESCRIPT = new Set(['.ts', '.mts', '.cts', '.tsx']);
const WITHOUT_JSX = new Set(['.ts', '.mts', '.cts']);

// SPEC §5
export function parseFile(path: string, text: string): Parsed {
  const source = text.replaceAll('\r\n', '\n');
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  const plugins: ParserPlugin[] = ['decorators'];
  if (!WITHOUT_JSX.has(extension)) plugins.push('jsx');
  if (TYPESCRIPT.has(extension)) plugins.push('typescript');
  const { program } = parse(source, {
    sourceType: 'unambiguous',
    errorRecovery: false,
    plugins,
  });
  return { source, statements: program.body };
}
