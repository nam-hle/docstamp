import { writeFileSync } from 'node:fs';
import { renderSchema } from '../src/config/schema.ts';

writeFileSync(new URL('../schema.json', import.meta.url), renderSchema());
