import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderSchema } from '../../src/config/schema.ts';

describe('§9.3 schema.json', () => {
  it('equals the schema generated from code (run pnpm schema)', () => {
    const committed = readFileSync(new URL('../../schema.json', import.meta.url), 'utf8');
    expect(committed).toBe(renderSchema());
  });
  it('names exactly the keys of §9.3', () => {
    const schema = JSON.parse(renderSchema()) as {
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual([
      'version',
      'gitignore',
      'ignore',
      'include',
      'presets',
      'files',
    ]);
  });
});
