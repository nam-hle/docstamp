import { normalizeMentions } from '../engine/mentions.ts';
import { readMentions } from '../plugin/plugins.ts';
import type { DocstampPlugin } from '../plugin/types.ts';

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

// SPEC §8.7 Mentions: the candidates a Plugin read from `doc`, or null when none claims it
export function docMentions(
  plugins: readonly DocstampPlugin[],
  doc: string,
  text: string,
): string[] | null {
  const read = readMentions(plugins, doc, text);
  return read === null ? null : normalizeMentions(read.links, read.words, parentOf(doc));
}
