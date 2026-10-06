// SPEC §9.5
export interface DocstampConfig {
  version: 1;
  gitignore?: boolean;
  ignore?: string[];
  dependents: Record<string, { covers: [string, ...string[]] }>;
}

export const defineConfig = (config: DocstampConfig): DocstampConfig => config;
