import { posix } from 'node:path';

export const REPOSITORY = 'https://github.com/nam-hle/docstamp';

// The anchors GitHub gives a heading, which every link in the repository already uses.
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/gu, '')
    .trim()
    .replace(/\s/gu, '-');
}

export interface LinkContext {
  // repo path of the file the text comes from, e.g. packages/docstamp/docs/spec/13-command-line.md
  from: string;
  // repo path of a published file -> its route on the site, e.g. /spec/command-line
  routes: ReadonlyMap<string, string>;
  isDirectory: (repoPath: string) => boolean;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu;

function target(href: string, { from, routes, isDirectory }: LinkContext): string {
  if (EXTERNAL.test(href)) return href;
  const [pathAndQuery = '', anchor] = href.split('#', 2);
  const [path = ''] = pathAndQuery.split('?', 1);
  const resolved = posix.normalize(posix.join(posix.dirname(from), path));
  if (resolved.startsWith('..')) return href;
  const suffix = anchor === undefined ? '' : `#${anchor}`;
  const route = routes.get(resolved);
  if (route !== undefined) return `${route}${suffix}`;
  const kind = isDirectory(resolved) ? 'tree' : 'blob';
  return `${REPOSITORY}/${kind}/main/${resolved}${suffix}`;
}

const INLINE = /(\]\()([^)\s]+)((?:\s+"[^"]*")?\))/gu;
const DEFINITION = /^(\s{0,3}\[[^\]]+\]:\s*)(\S+)/u;

// Links that point at another repository file become a route of the site, or a GitHub URL for a
// file the site does not publish. Fenced code is left alone.
export function rewriteLinks(text: string, context: LinkContext): string {
  let fence: string | null = null;
  return text
    .split('\n')
    .map((line) => {
      const marker = /^\s*(```+|~~~+)/u.exec(line)?.[1];
      if (marker !== undefined) {
        if (fence === null) fence = marker[0]!;
        else if (marker.startsWith(fence)) fence = null;
        return line;
      }
      if (fence !== null) return line;
      const definition = DEFINITION.exec(line);
      if (definition !== null) {
        return line.replace(DEFINITION, (_, lead: string, href: string) => {
          return `${lead}${target(href, context)}`;
        });
      }
      return line.replace(INLINE, (_, open: string, href: string, close: string) => {
        return `${open}${target(href, context)}${close}`;
      });
    })
    .join('\n');
}
