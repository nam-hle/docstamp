import { unwrap, type Group } from './declarations.ts';
import type { Statement } from './parse.ts';

interface Range {
  readonly start: number;
  readonly end: number;
}

interface Positioned {
  readonly start?: number | null;
  readonly end?: number | null;
}

const range = (node: Positioned): Range => ({
  start: node.start!,
  end: node.end!,
});

// The `{` of a static block: the first one after `static`, past any comment
function braceStart(source: string, from: number): number {
  let at = from;
  while (at < source.length && source[at] !== '{') {
    if (source.startsWith('/*', at)) at = source.indexOf('*/', at + 2) + 1;
    else if (source.startsWith('//', at)) at = source.indexOf('\n', at);
    at += 1;
  }
  return at;
}

// SPEC §7.2: the bodies of functions
function elisions(source: string, statement: Statement): Range[] {
  const node = unwrap(statement);
  switch (node.type) {
    case 'FunctionDeclaration':
      return [range(node.body)];
    case 'ClassDeclaration':
      return node.body.body.flatMap((member): Range[] => {
        if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
          return [range(member.body)];
        }
        if (member.type === 'StaticBlock') {
          return [{ start: braceStart(source, member.start!), end: member.end! }];
        }
        return [];
      });
    case 'VariableDeclaration':
      return node.declarations.flatMap((declarator): Range[] =>
        declarator.init?.type === 'ArrowFunctionExpression' ||
        declarator.init?.type === 'FunctionExpression'
          ? [range(declarator.init.body)]
          : [],
      );
    default:
      return [];
  }
}

function statementShape(source: string, statement: Statement): string {
  const { start, end } = range(statement);
  let shape = '';
  let from = start;
  for (const cut of elisions(source, statement).sort((a, b) => a.start - b.start)) {
    shape += source.slice(from, cut.start);
    from = cut.end;
  }
  return shape + source.slice(from, end);
}

const statementsOf = (group: Group): Statement[] => [
  ...new Set(group.declarations.map((declaration) => declaration.statement)),
];

// SPEC §7.1
export function sourceOf(source: string, group: Group): string {
  const statements = statementsOf(group);
  return source.slice(statements[0]!.start!, statements.at(-1)!.end!);
}

// SPEC §7.2
export function shapeOf(source: string, group: Group): string {
  return statementsOf(group)
    .map((statement) => statementShape(source, statement))
    .join('\n');
}
