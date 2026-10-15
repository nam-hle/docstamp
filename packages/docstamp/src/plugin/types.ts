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
  readonly code?: string;
}

export interface ExtractResult {
  readonly parts?: readonly Part[];
  readonly diagnostics?: readonly PluginDiagnostic[];
}

// SPEC §8.7 ValidateSelect: only `diagnostics`, and only errors
export interface ValidateSelectResult {
  readonly diagnostics?: readonly PluginDiagnostic[];
}

// SPEC §8.7 ParseSelect: a `select`, or the errors that say why the text is not one
export interface ParseSelectResult {
  readonly select?: Json;
  readonly diagnostics?: readonly PluginDiagnostic[];
}

type SchemaType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'null';

// SPEC §8.7 Select Schema: the subset of JSON Schema that docstamp checks a `select` against
export interface JsonSchema {
  readonly type?: SchemaType | readonly SchemaType[];
  readonly enum?: readonly Json[];
  readonly const?: Json;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: JsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly oneOf?: readonly JsonSchema[];
  readonly anyOf?: readonly JsonSchema[];
  readonly description?: string;
}

// SPEC §8.7 Mentions: the doc a plugin reads, and the paths it says the doc mentions
export interface MentionsInput {
  readonly path: string;
  readonly text: string;
}

export interface MentionsResult {
  readonly links?: readonly string[];
  readonly words?: readonly string[];
}

export interface PluginMeta {
  readonly schema?: JsonSchema;
}

export interface DocstampPlugin {
  readonly name: string;
  readonly apiVersion: 1;
  readonly files: readonly string[];
  readonly meta?: PluginMeta;
  extract(input: ExtractInput): ExtractResult;
  validateSelect?(select: Json): ValidateSelectResult;
  parseSelect?(raw: string): ParseSelectResult;
  mentions?(input: MentionsInput): MentionsResult;
}
