import { writeFileSync } from 'node:fs';
import { renderSchema } from '../src/config/schema.ts';
import { renderFrontmatterSchema } from '../src/inline/schema.ts';

writeFileSync(new URL('../schema.json', import.meta.url), renderSchema());
writeFileSync(new URL('../schema-frontmatter.json', import.meta.url), renderFrontmatterSchema());
