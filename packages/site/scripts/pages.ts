import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SPEC_DIR = 'packages/docstamp/docs/spec';

export interface Page {
  // repo path of the file the page is copied from
  from: string;
  // route on the site, without a trailing slash or extension
  to: string;
  title: string;
}

// The files published as they are, apart from their links.
export const PROJECT: readonly Page[] = [
  { from: 'docs/PRINCIPLES.md', to: '/project/principles', title: 'Principles' },
  { from: 'docs/VISION.md', to: '/project/vision', title: 'Vision' },
  { from: 'CONTRIBUTING.md', to: '/project/contributing', title: 'Contributing' },
  { from: 'SECURITY.md', to: '/project/security', title: 'Security' },
  { from: 'CODE_OF_CONDUCT.md', to: '/project/code-of-conduct', title: 'Code of conduct' },
];

export const PLUGINS: readonly Page[] = [
  {
    from: 'packages/docstamp-plugin-markdown/README.md',
    to: '/plugins/markdown',
    title: 'Markdown plugin',
  },
  {
    from: 'packages/docstamp-plugin-markdown/SPEC.md',
    to: '/plugins/markdown-spec',
    title: 'Markdown plugin specification',
  },
  {
    from: 'packages/docstamp-plugin-js/README.md',
    to: '/plugins/js',
    title: 'JavaScript plugin',
  },
  {
    from: 'packages/docstamp-plugin-js/SPEC.md',
    to: '/plugins/js-spec',
    title: 'JavaScript plugin specification',
  },
  {
    from: 'packages/docstamp-plugin-asciidoc/README.md',
    to: '/plugins/asciidoc',
    title: 'AsciiDoc plugin',
  },
  {
    from: 'packages/docstamp-plugin-asciidoc/SPEC.md',
    to: '/plugins/asciidoc-spec',
    title: 'AsciiDoc plugin specification',
  },
];

export const SPEC_INDEX: Page = {
  from: 'packages/docstamp/docs/SPEC.md',
  to: '/spec',
  title: 'Specification',
};

// One page per file of the specification, in clause order: 13-command-line.md is /spec/command-line.
export function specParts(root: string = REPO_ROOT): Page[] {
  return readdirSync(`${root}/${SPEC_DIR}`)
    .filter((name) => /^\d+-.+\.md$/u.test(name))
    .sort()
    .map((name) => {
      const from = `${SPEC_DIR}/${name}`;
      const heading = /^## (.+)$/mu.exec(readFileSync(`${root}/${from}`, 'utf8'))?.[1] ?? name;
      return {
        from,
        to: `/spec/${name.replace(/^\d+-/u, '').replace(/\.md$/u, '')}`,
        title: heading,
      };
    });
}

// Every repository file the site publishes, to the route that shows it.
export function routes(root: string = REPO_ROOT): Map<string, string> {
  const pages = [SPEC_INDEX, ...specParts(root), ...PROJECT, ...PLUGINS];
  return new Map(pages.map((page) => [page.from, page.to]));
}

export const COMMANDS = [
  'check',
  'update',
  'list-dependencies',
  'list-dependents',
  'stats',
  'suggest',
] as const;

// The `spec` topic names the file; the site has the specification itself.
export const SKIPPED_TOPICS: readonly string[] = ['spec'];
