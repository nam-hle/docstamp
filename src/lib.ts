// SPEC §9.5
export interface DocstampConfig {
  version: 2;
  gitignore?: boolean;
  ignore?: string[];
  presets?: Record<string, [string, ...string[]]>;
  'default-presets'?: [string, ...string[]];
  files: Record<string, { dependencies: [string, ...string[]]; use?: string[] }>;
}

export const defineConfig = (config: DocstampConfig): DocstampConfig => config;
