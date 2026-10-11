import type { Json } from './core/types.ts';
import type { DocstampPlugin } from './plugin/types.ts';

export type { Json } from './core/types.ts';
export type {
  DocstampPlugin,
  ExtractInput,
  ExtractResult,
  LineRange,
  Part,
  PluginDiagnostic,
} from './plugin/types.ts';

// SPEC §8.7
export interface SelectedDependency {
  path: string;
  select: Json;
}

type Dependency = string | SelectedDependency;

// SPEC §9.5
export interface DocstampConfig {
  version: 2;
  gitignore?: boolean;
  ignore?: string[];
  presets?: Record<string, [string, ...string[]]>;
  'default-presets'?: [string, ...string[]];
  plugins?: DocstampPlugin[];
  files: Record<string, { dependencies: [Dependency, ...Dependency[]]; use?: string[] }>;
}

export const defineConfig = (config: DocstampConfig): DocstampConfig => config;

export const definePlugin = (plugin: DocstampPlugin): DocstampPlugin => plugin;
