import type { Diagnostic, Result } from '../core/types.ts';
import { jsonText } from '../report/json.ts';
import { diagnosticsText, type Chunk } from '../report/text.ts';
import type { Io } from './io.ts';
import type { Undeclared } from './undeclared.ts';

export const hasError = (ds: readonly Diagnostic[]) => ds.some((d) => d.severity === 'error');

export interface Output {
  json: boolean;
  mode: 'check' | 'update';
  evaluated: boolean;
  onlyStale?: boolean;
  exitCode: number;
  selected: Result[];
  global: Diagnostic[];
  text: string;
  chunks?: Chunk[];
  written?: Set<string>;
  removed?: string[];
  undeclared?: readonly Undeclared[];
}

export function emit(io: Io, o: Output): number {
  if (o.json) {
    io.stdout(
      jsonText({
        mode: o.mode,
        evaluated: o.evaluated,
        onlyStale: o.onlyStale === true,
        exitCode: o.exitCode,
        selected: o.selected,
        diagnostics: o.global,
        ...(o.written === undefined ? {} : { written: o.written }),
        ...(o.removed === undefined ? {} : { removed: o.removed }),
        ...(o.undeclared === undefined ? {} : { undeclared: o.undeclared }),
      }),
    );
  } else {
    const chunks = o.chunks ?? [
      { stream: 'stdout' as const, text: o.text },
      {
        stream: 'stderr' as const,
        text: diagnosticsText([...o.global, ...o.selected.flatMap((r) => r.diagnostics)]),
      },
    ];
    for (const { stream, text } of chunks) io[stream](text);
  }
  return o.exitCode;
}
