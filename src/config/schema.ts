import { PATTERN_SCHEMA, PRESET_NAME } from './value.ts';

// SPEC §9.3
const USE = { type: 'array', uniqueItems: true, items: { type: 'string' } } as const;

// SPEC §9.3 step 8.3: an empty `use` only where `default-presets` is present
const configSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'docstamp configuration',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'files'],
  properties: {
    version: { const: 2 },
    gitignore: { type: 'boolean', default: true },
    ignore: { type: 'array', items: { type: 'string' }, default: [] },
    include: { type: 'array', minItems: 1, items: PATTERN_SCHEMA, default: ['**/*.md'] },
    presets: {
      type: 'object',
      additionalProperties: false,
      patternProperties: {
        [PRESET_NAME.source]: { type: 'array', minItems: 1, items: PATTERN_SCHEMA },
      },
    },
    'default-presets': { ...USE, minItems: 1 },
    files: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['dependencies'],
        properties: {
          dependencies: { type: 'array', minItems: 1, items: PATTERN_SCHEMA },
          use: USE,
        },
      },
    },
  },
  anyOf: [
    { required: ['default-presets'] },
    { properties: { files: { additionalProperties: { properties: { use: { minItems: 1 } } } } } },
  ],
} as const;

export const renderSchema = (): string => `${JSON.stringify(configSchema, null, 2)}\n`;
