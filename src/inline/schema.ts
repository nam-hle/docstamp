import { PATTERN_SCHEMA, PRESET_NAME } from '../config/value.ts';
import { BLOCK_KEYS, HASH } from './keys.ts';

const properties = {
  dependencies: { type: 'array', minItems: 1, items: PATTERN_SCHEMA },
  use: {
    type: 'array',
    minItems: 1,
    uniqueItems: true,
    items: { type: 'string', pattern: PRESET_NAME.source },
  },
  hash: { type: 'string', pattern: HASH.source },
} satisfies Record<(typeof BLOCK_KEYS)[number], object>;

// SPEC §5.6, §9.6.2: the frontmatter of a file with an inline block; other keys are free
const frontmatterSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'docstamp inline block (Markdown frontmatter)',
  type: 'object',
  properties: {
    docstamp: {
      type: 'object',
      additionalProperties: false,
      required: ['dependencies'],
      properties,
    },
  },
} as const;

export const renderFrontmatterSchema = (): string =>
  `${JSON.stringify(frontmatterSchema, null, 2)}\n`;
