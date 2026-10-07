// SPEC §9.5
export interface DocstampConfig {
  version: 2;
  gitignore?: boolean;
  ignore?: string[];
  presets?: Record<string, [string, ...string[]]>;
  files: Record<string, { dependencies: [string, ...string[]]; use?: [string, ...string[]] }>;
}

export const defineConfig = (config: DocstampConfig): DocstampConfig => config;
