import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { COMMANDS, PLUGINS, PROJECT, specParts } from '../scripts/pages.ts';
import { slug } from '../scripts/links.ts';

const manifest = fileURLToPath(new URL('../.manifest.json', import.meta.url));
const topics: string[] = existsSync(manifest)
  ? (JSON.parse(readFileSync(manifest, 'utf8')) as { topics: string[] }).topics
  : [];

const entry = ({ to, title }: { to: string; title: string }) => ({ text: title, link: to });

export default defineConfig({
  title: 'docstamp',
  description:
    'Stop docs from silently going stale: docstamp fails CI when code a doc depends on changed since the doc was last reviewed.',
  lang: 'en-US',
  base: '/docstamp/',
  srcDir: '.generated',
  cleanUrls: true,
  lastUpdated: false,
  // The links of the repository use GitHub's anchors, so the headings are given the same ones. No
  // raw HTML: the specification writes <file> and <m> in prose, which Vue would read as tags.
  markdown: { html: false, anchor: { slugify: slug } },
  themeConfig: {
    nav: [
      { text: 'Get started', link: '/get-started' },
      { text: 'Guides', link: '/guide/declare' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Specification', link: '/spec' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guides',
          items: [
            { text: 'Declare dependencies', link: '/guide/declare' },
            { text: 'Review a stale doc', link: '/guide/review' },
            { text: 'Run it in CI', link: '/guide/ci' },
            { text: 'Tune a dependency list', link: '/guide/tune' },
            { text: 'Depend on part of a file', link: '/guide/plugins' },
          ],
        },
      ],
      '/reference/': [
        { text: 'Reference', items: [{ text: 'Overview', link: '/reference/' }] },
        {
          text: 'Commands',
          items: COMMANDS.map((name) => ({
            text: `docstamp ${name}`,
            link: `/reference/commands/${name}`,
          })),
        },
        {
          text: 'Topics',
          items: topics.map((name) => ({ text: name, link: `/reference/topics/${name}` })),
        },
      ],
      '/spec': [
        {
          text: 'Specification',
          items: [{ text: 'Index', link: '/spec' }, ...specParts().map(entry)],
        },
      ],
      '/plugins/': [{ text: 'Plugins', items: PLUGINS.map(entry) }],
      '/project/': [{ text: 'Project', items: PROJECT.map(entry) }],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/nam-hle/docstamp' }],
    search: { provider: 'local' },
    footer: { message: 'Released under the MIT License.' },
  },
});
