import type { Json } from '../core/types.ts';

// SPEC §8.7
export interface ExtractInput {
  readonly path: string;
  readonly text: string;
  readonly select: Json;
}

export interface ExtractResult {
  readonly hashes: readonly string[];
}

export interface DocstampPlugin {
  readonly name: string;
  readonly apiVersion: 1;
  readonly files: readonly string[];
  extract(input: ExtractInput): ExtractResult;
}
