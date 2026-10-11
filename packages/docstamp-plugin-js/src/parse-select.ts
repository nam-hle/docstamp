import type { Json, ParseSelectResult } from 'docstamp';

interface Item {
  readonly key: string | undefined;
  readonly text: string;
}

const KEYS = ['name', 'kind', 'part'];
const HINT = 'A literal "=", "," or "\\" in a value is written "\\=", "\\," or "\\\\".';

const refuse = (message: string): ParseSelectResult => ({
  diagnostics: [{ severity: 'error', code: 'invalid-selector', message: `${message} ${HINT}` }],
});

// SPEC §4.1 steps 1 and 2: items split at "," and keys at "=", outside an escape, in one pass
function scan(raw: string): Item[] {
  const items: Item[] = [];
  let key: string | undefined;
  let text = '';
  for (let at = 0; at < raw.length; at += 1) {
    const character = raw[at]!;
    const next = raw[at + 1];
    if (character === '\\' && (next === ',' || next === '=' || next === '\\')) {
      text += next;
      at += 1;
    } else if (character === ',') {
      items.push({ key, text });
      key = undefined;
      text = '';
    } else if (character === '=' && key === undefined) {
      key = text;
      text = '';
    } else {
      text += character;
    }
  }
  items.push({ key, text });
  return items;
}

// SPEC §4.1
export function parseSelect(raw: string): ParseSelectResult {
  const items = scan(raw);
  const [only] = items;
  if (items.length === 1 && only!.key === undefined) {
    return only!.text === '' ? refuse('The selector is empty.') : { select: only!.text };
  }
  const select: Record<string, Json> = {};
  for (const { key, text } of items) {
    if (key === undefined) {
      return refuse('An item of the selector is not key=value, and a bare name stands alone.');
    }
    if (!KEYS.includes(key)) return refuse(`A key of the selector is one of ${KEYS.join(', ')}.`);
    if (Object.hasOwn(select, key)) return refuse(`The key ${key} is written twice.`);
    select[key] = text;
  }
  return { select };
}
