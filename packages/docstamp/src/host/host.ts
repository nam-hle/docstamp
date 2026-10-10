import type { FileSystem } from './fs.ts';
import type { Git } from './git.ts';

// SPEC §2: the one read of the clock, for `stats --since` and the window of `suggest`
export interface Clock {
  // milliseconds since the epoch
  now(): number;
}

// What a run needs from the machine; the rest of src/ touches nothing else
export interface Host {
  readonly fs: FileSystem;
  // git for the work tree at `root`
  readonly git: (root: string) => Git;
  readonly clock: Clock;
}
