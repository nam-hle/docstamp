import type { Json } from '../core/types.ts';

// SPEC §8.7
export interface ExtractInput {
  readonly path: string;
  readonly text: string;
  readonly select: Json;
}

// SPEC §8.7: the first and last line of a part, 1-based
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

// SPEC §8.7: one piece of a file. `content` is hashed; `focus` and `lines` are advisory
export interface Part {
  readonly content: string;
  readonly focus?: string;
  readonly lines?: LineRange;
}

// SPEC §8.7: an error makes the file invalid, a warning is only printed
export interface PluginDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

export interface ExtractResult {
  readonly parts?: readonly Part[];
  readonly diagnostics?: readonly PluginDiagnostic[];
}

export interface DocstampPlugin {
  readonly name: string;
  readonly apiVersion: 1;
  readonly files: readonly string[];
  extract(input: ExtractInput): ExtractResult;
}
