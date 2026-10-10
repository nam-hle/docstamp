import { Raised, diag } from '../core/diagnostics.ts';
import type { Declaration } from '../core/types.ts';

const NO_CONFIG_MESSAGE =
  'There is no configuration file, and presets are defined only there: add docstamp.yaml ' +
  'with a "presets" mapping, or remove the name from "use".';

// SPEC §8.6: the used Presets are the own `use`, or else the default Presets
export function expandPresets(
  declaration: Declaration,
  presets: ReadonlyMap<string, readonly string[]>,
  defaults: readonly string[],
  present: boolean,
): Declaration {
  const use = declaration.use ?? defaults;
  if (use.length === 0) return declaration;
  const patterns = [...declaration.dependencies];
  const origins: Array<string | null> = patterns.map(() => null);
  const problems = [];
  for (const name of use) {
    const preset = presets.get(name);
    if (preset === undefined) {
      const message = present ? undefined : NO_CONFIG_MESSAGE;
      problems.push(
        diag('E_UNKNOWN_PRESET', {
          file: declaration.file,
          subject: name,
          ...(message === undefined ? {} : { message }),
        }),
      );
      continue;
    }
    patterns.push(...preset);
    origins.push(...preset.map(() => name));
  }
  if (problems.length > 0) throw new Raised(problems);
  return { ...declaration, dependencies: patterns, origins };
}
