// SPEC §8.7 SplitDependency: the first ":" that no "\" escapes
export function splitDependency(text: string): { path: string; raw: string } | null {
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '\\') at += 1;
    else if (text[at] === ':') return { path: text.slice(0, at), raw: text.slice(at + 1) };
  }
  return null;
}
