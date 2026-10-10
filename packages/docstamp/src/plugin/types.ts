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

export interface ExtractResult {
  readonly hashes: readonly string[];
  // SPEC §8.7: advisory, one per hash, never part of a Hash
  readonly focus?: readonly string[];
  readonly lines?: readonly LineRange[];
}

export interface DocstampPlugin {
  readonly name: string;
  readonly apiVersion: 1;
  readonly files: readonly string[];
  extract(input: ExtractInput): ExtractResult;
}
