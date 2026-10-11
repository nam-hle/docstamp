export interface Io {
  stdout(s: string): void;
  stderr(s: string): void;
  isTty: boolean;
  env: NodeJS.ProcessEnv;
}
