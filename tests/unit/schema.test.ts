import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderSchema } from '../../src/config/schema.ts';
import { BLOCK_KEYS } from '../../src/inline/keys.ts';
import { renderFrontmatterSchema } from '../../src/inline/schema.ts';

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
      'default-presets',
      'files',
    ]);
  });
  it('rejects an empty pattern and a lone "!" wherever a pattern is expected (§8.1)', () => {
    const schema = JSON.parse(renderSchema()) as {
      properties: {
        include: { items: unknown };
        presets: { patternProperties: Record<string, { items: unknown }> };
        files: { additionalProperties: { properties: { dependencies: { items: unknown } } } };
      };
    };
    const pattern = { type: 'string', minLength: 1, not: { const: '!' } };
    const { include, presets, files } = schema.properties;
    expect(include.items).toEqual(pattern);
    expect(Object.values(presets.patternProperties)[0]!.items).toEqual(pattern);
    expect(files.additionalProperties.properties.dependencies.items).toEqual(pattern);
  });
});

describe('§5.6 schema-frontmatter.json', () => {
  interface Block {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, { type: string; minItems?: number; pattern?: string }>;
  }
  const block = (): Block =>
    JSON.parse(renderFrontmatterSchema()).properties.docstamp as unknown as Block;
  const hashPattern = () => new RegExp(block().properties['hash']!.pattern!, 'u');

  it('equals the schema generated from code (run pnpm schema)', () => {
    const committed = readFileSync(
      new URL('../../schema-frontmatter.json', import.meta.url),
      'utf8',
    );
    expect(committed).toBe(renderFrontmatterSchema());
  });
  it('allows the keys the parser allows, and no other, in the docstamp block', () => {
    expect(block().additionalProperties).toBe(false);
    expect(Object.keys(block().properties)).toEqual([...BLOCK_KEYS]);
  });
  it('requires dependencies, a non-empty list; use is a list (empty opts out of defaults); hash is 64 hex', () => {
    expect(block().required).toEqual(['dependencies']);
    expect(block().properties['dependencies']).toMatchObject({ type: 'array', minItems: 1 });
    expect(block().properties['use']).toMatchObject({ type: 'array', uniqueItems: true });
    expect(hashPattern().test('a'.repeat(64))).toBe(true);
    expect(hashPattern().test('A'.repeat(64))).toBe(false);
    expect(hashPattern().test('a'.repeat(63))).toBe(false);
  });
  it('rejects an empty pattern and a lone "!" in dependencies (§8.1)', () => {
    expect(block().properties['dependencies']).toMatchObject({
      items: { type: 'string', minLength: 1, not: { const: '!' } },
    });
  });
  it('leaves the other frontmatter keys free', () => {
    const schema = JSON.parse(renderFrontmatterSchema()) as Record<string, unknown>;
    expect(schema['additionalProperties']).toBeUndefined();
    expect(schema['required']).toBeUndefined();
  });
});
