// SPEC §9.5
export interface DocstampConfig {
  version: 2;
  gitignore?: boolean;
  ignore?: string[];
  files: Record<string, { dependencies: [string, ...string[]] }>;
}

export const defineConfig = (config: DocstampConfig): DocstampConfig => config;
