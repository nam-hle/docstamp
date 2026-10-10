import type { Statement } from './parse.ts';
import type { Kind } from './selector.ts';

export interface Declaration {
  readonly kind: Kind;
  readonly name: string;
  readonly statement: Statement;
  readonly index: number;
  readonly signature: boolean;
}

export interface Group {
  readonly kind: Kind;
  readonly name: string;
  readonly declarations: readonly Declaration[];
}

type Declared = NonNullable<Extract<Statement, { declaration?: unknown }>['declaration']>;
type ModuleId = Extract<Statement, { type: 'TSModuleDeclaration' }>['id'];

// SPEC §6.1: an export wraps the declaration it names
export const unwrap = (statement: Statement): Statement | Declared =>
  (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
  statement.declaration
    ? statement.declaration
    : statement;

const moduleName = (id: ModuleId): string => (id.type === 'Identifier' ? id.name : id.value);

const found = (
  kind: Kind,
  name: string,
  statement: Statement,
  index: number,
  signature = false,
): Declaration => ({ kind, name, statement, index, signature });

// SPEC §6.1
export function declarations(statements: readonly Statement[]): Declaration[] {
  return statements.flatMap((statement, index): Declaration[] => {
    const node = unwrap(statement);
    switch (node.type) {
      case 'FunctionDeclaration':
        return [found('function', node.id?.name ?? 'default', statement, index)];
      case 'TSDeclareFunction':
        return [found('function', node.id?.name ?? 'default', statement, index, true)];
      case 'ClassDeclaration':
        return [found('class', node.id?.name ?? 'default', statement, index)];
      case 'TSInterfaceDeclaration':
        return [found('interface', node.id.name, statement, index)];
      case 'TSTypeAliasDeclaration':
        return [found('type', node.id.name, statement, index)];
      case 'TSEnumDeclaration':
        return [found('enum', node.id.name, statement, index)];
      case 'TSModuleDeclaration':
        return [found('namespace', moduleName(node.id), statement, index)];
      case 'VariableDeclaration':
        return node.declarations.flatMap((declarator) =>
          declarator.id.type === 'Identifier'
            ? [found('variable', declarator.id.name, statement, index)]
            : [],
        );
      default:
        return [];
    }
  });
}

// SPEC §6.2: a run of adjacent same-name functions, all signatures but the last
export function groups(all: readonly Declaration[]): Group[] {
  const result: Declaration[][] = [];
  for (const declaration of all) {
    const open = result.at(-1);
    const previous = open?.at(-1);
    const joins =
      open !== undefined &&
      previous !== undefined &&
      declaration.kind === 'function' &&
      previous.kind === 'function' &&
      previous.signature &&
      previous.name === declaration.name &&
      previous.index + 1 === declaration.index;
    if (joins) open.push(declaration);
    else result.push([declaration]);
  }
  return result.map((declarations) => ({
    kind: declarations[0]!.kind,
    name: declarations[0]!.name,
    declarations,
  }));
}
