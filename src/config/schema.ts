import { PRESET_NAME } from './value.ts';

// SPEC §9.3
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
    include: { type: 'array', minItems: 1, items: { type: 'string' }, default: ['**/*.md'] },
    presets: {
      type: 'object',
      additionalProperties: false,
      patternProperties: {
        [PRESET_NAME.source]: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
    },
    files: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['dependencies'],
        properties: {
          dependencies: { type: 'array', minItems: 1, items: { type: 'string' } },
          use: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export const renderSchema = (): string => `${JSON.stringify(configSchema, null, 2)}\n`;
