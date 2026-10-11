import { describe, expect, it } from 'vitest';
import type { Json } from '../../src/core/types.ts';
import { runValidateSelect } from '../../src/plugin/plugins.ts';
import { checkSelect, readSchema } from '../../src/plugin/schema.ts';
import type { DocstampPlugin, JsonSchema } from '../../src/plugin/types.ts';

const check = (schema: JsonSchema, value: Json) => checkSelect(schema, value);

describe('§8.7 Select Schema keywords', () => {
  it.each([
    [{ type: 'string' }, 'a', true],
    [{ type: 'string' }, 1, false],
    [{ type: 'integer' }, 2, true],
    [{ type: 'integer' }, 2.5, false],
    [{ type: 'number' }, 2.5, true],
    [{ type: ['string', 'null'] }, null, true],
    [{ type: 'object' }, [], false],
    [{ type: 'array' }, [], true],
    [{ type: 'boolean' }, false, true],
    [{ enum: ['a', 2, { b: 1 }] }, { b: 1 }, true],
    [{ enum: ['a'] }, 'b', false],
    [{ const: [1, 2] }, [1, 2], true],
    [{ const: null }, 0, false],
    [{ minLength: 2 }, 'a', false],
    [{ maxLength: 2 }, '😀😀', true],
    [{ minimum: 1 }, 0, false],
    [{ maximum: 1 }, 1, true],
    [{ minItems: 1 }, [], false],
    [{ maxItems: 1 }, [1, 2], false],
    [{ minLength: 5 }, 1, true],
    [{ items: { type: 'integer' } }, [1, 'a'], false],
    [{ required: ['a'] }, {}, false],
    [{ required: ['a'] }, { a: 1 }, true],
    [{ properties: { a: { type: 'string' } } }, { a: 1 }, false],
    [{ properties: { a: { type: 'string' } } }, { b: 1 }, true],
    [{ properties: {}, additionalProperties: false }, { b: 1 }, false],
    [{ additionalProperties: true }, { b: 1 }, true],
    [{ anyOf: [{ type: 'string' }, { type: 'integer' }] }, 1, true],
    [{ anyOf: [{ type: 'string' }] }, 1, false],
    [{ oneOf: [{ type: 'string' }, { minLength: 1 }] }, 'a', false],
    [{ oneOf: [{ type: 'string' }, { type: 'integer' }] }, 'a', true],
    [{ oneOf: [{ type: 'string' }, { type: 'integer' }] }, null, false],
    [{ description: 'ignored' }, 1, true],
  ] as [JsonSchema, Json, boolean][])('%j and %j gives %s', (schema, value, passes) => {
    expect(check(schema, value) === null).toBe(passes);
  });
});

describe('§8.7 CheckSelect names the first failure by JSON Pointer', () => {
  const schema: JsonSchema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      kind: { enum: ['function', 'class'] },
      tags: { type: 'array', items: { type: 'string' } },
      'a/b': { type: 'integer' },
    },
    additionalProperties: false,
  };

  it('is null for a value that passes', () => {
    expect(check(schema, { name: 'x', kind: 'class', tags: ['t'] })).toBeNull();
  });

  it('names the whole value with an empty pointer', () => {
    expect(check(schema, 'x')).toEqual({ pointer: '', expected: 'object, not string' });
  });

  it('checks required before properties before additionalProperties', () => {
    expect(check(schema, { kind: 'x', zed: 1 })?.pointer).toBe('/name');
    expect(check(schema, { name: 'n', kind: 'x', zed: 1 })?.pointer).toBe('/kind');
    expect(check(schema, { name: 'n', zed: 1 })?.pointer).toBe('/zed');
  });

  it('checks the members in path order and extends the pointer', () => {
    expect(check(schema, { name: '', kind: 'x' })?.pointer).toBe('/kind');
    expect(check(schema, { name: 'n', tags: ['a', 1] })).toEqual({
      pointer: '/tags/1',
      expected: 'string, not number',
    });
    expect(check(schema, { name: 'n', 'a/b': 'x' })?.pointer).toBe('/a~1b');
  });

  it('says what was expected', () => {
    expect(check(schema, { name: 'n', kind: 'x' })?.expected).toBe(
      'one of "function", "class", not "x"',
    );
    expect(check({ maximum: 6 }, 7)?.expected).toBe('at most 6, not 7');
  });

  it('does not look inside the alternatives', () => {
    expect(check({ oneOf: [{ type: 'string' }, { type: 'integer' }] }, [])).toEqual({
      pointer: '',
      expected: 'a value that matches exactly one of the alternatives, not 0',
    });
  });
});

describe('§8.7 a Select Schema that is not valid', () => {
  it.each([
    [{ pattern: 'x' }, 'pattern'],
    [{ $ref: '#' }, '$ref'],
    [{ type: [] }, 'type'],
    [{ type: ['string', 'string'] }, 'type'],
    [{ enum: [] }, 'enum'],
    [{ required: ['a', 'a'] }, 'required'],
    [{ additionalProperties: {} }, 'additionalProperties'],
    [{ items: [{}] }, 'items'],
    [{ maxItems: 1.5 }, 'maxItems'],
    [{ minimum: 'a' }, 'minimum'],
    [{ properties: { a: { exclusiveMinimum: 1 } } }, 'exclusiveMinimum'],
    [{ anyOf: [1] }, 'anyOf'],
    [{ description: 1 }, 'description'],
    [true, 'Map'],
    [{ const: Number.NaN }, 'Map'],
  ])('%j names %s', (schema, text) => {
    const read = readSchema(schema, 'meta.schema');
    expect(read).toHaveProperty('problem');
    expect((read as { problem: string }).problem).toContain(text);
  });
});

describe('§8.7 ValidateSelect checks meta.schema first', () => {
  const plugin = (validateSelect?: DocstampPlugin['validateSelect']): DocstampPlugin => ({
    name: 'p',
    apiVersion: 1,
    files: ['**/*.md'],
    extract: () => ({}),
    meta: { schema: { type: 'object', properties: { level: { type: 'integer', maximum: 6 } } } },
    ...(validateSelect === undefined ? {} : { validateSelect }),
  });
  const entry = (select: Json) => ({ path: 'a.md', select });

  it('is E_SELECT naming the plugin, the pointer and the expectation', () => {
    const [found, ...rest] = runValidateSelect(plugin(), 'D.md', entry({ level: 7 }));
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      code: 'E_SELECT',
      file: 'D.md',
      subject: 'a.md#{"level":7}',
      message: 'Plugin "p" expects /level of "a.md" to be at most 6, not 7.',
    });
  });

  it('does not call validateSelect for a value that fails', () => {
    const calls: Json[] = [];
    runValidateSelect(
      plugin((select) => (calls.push(select), {})),
      'D.md',
      entry('x'),
    );
    expect(calls).toEqual([]);
  });

  it('calls validateSelect for a value that passes', () => {
    const found = runValidateSelect(
      plugin(() => ({ diagnostics: [{ severity: 'error', message: 'No.' }] })),
      'D.md',
      entry({ level: 2 }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toBe('No.');
  });
});
