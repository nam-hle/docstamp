export type Code =
  | 'E_USAGE'
  | 'E_ROOT'
  | 'E_CONFIG_MISSING'
  | 'E_CONFIG_AMBIGUOUS'
  | 'E_CONFIG'
  | 'E_CONFIG_VERSION'
  | 'E_UNKNOWN_KEY'
  | 'E_PATTERN'
  | 'E_UNKNOWN_PRESET'
  | 'E_BLOCK'
  | 'E_DUPLICATE_DECLARATION'
  | 'E_FILE_MISSING'
  | 'E_EMPTY_PATTERN'
  | 'E_EMPTY_DEPENDENCIES'
  | 'E_UNREADABLE'
  | 'E_PATH_ENCODING'
  | 'E_PATH_COLLISION'
  | 'E_LOCK'
  | 'E_LOCK_VERSION'
  | 'E_UNKNOWN_FILE'
  | 'E_HISTORY'
  | 'W_ORPHAN'
  | 'W_EMPTY_EXCLUSION'
  | 'W_DUPLICATE_PATTERN'
  | 'W_SHADOWED_EXCLUSION'
  | 'W_UNKNOWN_PATH';

export interface Diagnostic {
  readonly code: Code;
  readonly severity: 'error' | 'warning';
  readonly file: string;
  readonly subject: string;
  readonly message: string;
}

// SPEC §5.1: `inline` is set for an inline Declaration, with its recorded Hash or null.
// SPEC §8.6: `use` names Presets; once expanded, `dependencies` holds the effective patterns.
export interface Declaration {
  readonly file: string;
  readonly dependencies: readonly string[];
  readonly use?: readonly string[];
  readonly origins?: readonly (string | null)[];
  readonly inline?: { readonly recorded: string | null };
}

// SPEC §5.2
export interface Config {
  readonly ignore: readonly string[];
  readonly useGitignore: boolean;
  readonly include: readonly string[];
  readonly presets: ReadonlyMap<string, readonly string[]>;
  readonly defaultPresets: readonly string[];
  readonly declarations: readonly Declaration[];
}

export interface Lock {
  readonly entries: ReadonlyMap<string, string>;
}

type State = 'ok' | 'stale' | 'invalid';
export type Reason = 'unrecorded' | 'content-changed';

export interface Change {
  readonly status: 'modified' | 'added' | 'deleted';
  readonly path: string;
  readonly via: readonly string[];
  readonly whitespaceOnly: boolean;
  readonly pair?: string;
  // SPEC §12.3 step 2: an added path git does not track; text only (§14.3.4)
  readonly untracked?: boolean;
}

// SPEC §5.4
export interface SelectionChange {
  readonly status: 'added' | 'removed';
  readonly path: string;
}

export interface Result {
  readonly file: string;
  readonly dependencies: readonly string[];
  readonly use?: readonly string[];
  readonly origins?: readonly (string | null)[];
  readonly state: State;
  readonly reasons: readonly Reason[];
  readonly resolved: readonly string[];
  readonly current: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly changes?: readonly Change[] | null;
  readonly base?: string;
  readonly edited?: string;
  readonly selection?: readonly SelectionChange[];
}

// SPEC §13.8: `dependents`, `cycle` and `repeated` are set only by --transitive
export interface ReverseDependent {
  readonly file: string;
  readonly via: readonly string[];
  readonly dependents?: readonly ReverseDependent[];
  readonly cycle?: boolean;
  readonly repeated?: boolean;
}

export interface ReverseEntry {
  readonly file: string;
  readonly dependents: readonly ReverseDependent[];
  readonly diagnostics: readonly Diagnostic[];
}
