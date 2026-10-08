import { readConfig } from '../config/read-config.ts';
import { Raised, diag } from '../core/diagnostics.ts';
import { comparePaths } from '../core/order.ts';
import type { Declaration, Diagnostic } from '../core/types.ts';
import { expandPresets } from '../engine/presets.ts';
import { readInline } from '../inline/read-inline.ts';
import { computeUniverse, type Universe } from '../universe/walk.ts';

export interface Workspace {
  universe: Universe;
  declarations: Declaration[];
  attached: Diagnostic[];
  presets: ReadonlyMap<string, readonly string[]>;
  defaultPresets: readonly string[];
}

// SPEC §12.2 steps 1 to 5: configured and inline Declarations over one Universe
export function loadWorkspace(root: string): Workspace {
  const { config, attached, present } = readConfig(root);
  const universe = computeUniverse(root, config);
  const inline = readInline(root, universe, config.include, config.defaultPresets.length > 0);
  universe.marked = inline.marked;
  if (!present && inline.marked.size === 0) throw new Raised([diag('E_CONFIG_MISSING')]);

  const configured = new Set(config.declarations.map((d) => d.file));
  const duplicates = new Set(
    inline.declarations.map((d) => d.file).filter((f) => configured.has(f)),
  );
  const merged = [
    ...config.declarations,
    ...inline.declarations.filter((d) => !duplicates.has(d.file)),
  ].sort((a, b) => comparePaths(a.file, b.file));
  const unknownPresets: Diagnostic[] = [];
  const declarations = merged.map((d) => {
    try {
      return expandPresets(d, config.presets, config.defaultPresets, present);
    } catch (e) {
      if (!(e instanceof Raised)) throw e;
      unknownPresets.push(...e.diagnostics);
      return d;
    }
  });
  return {
    universe,
    presets: config.presets,
    defaultPresets: config.defaultPresets,
    declarations,
    attached: [
      ...attached,
      ...unknownPresets,
      ...inline.attached.filter((d) => !duplicates.has(d.file)),
      ...[...duplicates].map((file) => diag('E_DUPLICATE_DECLARATION', { file })),
    ],
  };
}
