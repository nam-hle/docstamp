const NAMED: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
};

function needsUnicodeEscape(cp: number): boolean {
  return (
    cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029 || cp === 0xfeff
  );
}

// SPEC §3.4
export function quote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const named = NAMED[ch];
    const cp = ch.codePointAt(0) ?? 0;
    if (named !== undefined) out += named;
    else if (needsUnicodeEscape(cp)) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

// SPEC §3.4
export function needsQuoting(s: string): boolean {
  return quote(s) !== `"${s}"`;
}

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/u;

// SPEC §14.3.4
export function shellQuote(s: string): string {
  return SHELL_SAFE.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
}
