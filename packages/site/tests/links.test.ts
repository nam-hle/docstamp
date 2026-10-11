import { describe, expect, it } from 'vitest';
import { REPOSITORY, rewriteLinks, slug, type LinkContext } from '../scripts/links.ts';

const context: LinkContext = {
  from: 'packages/docstamp/docs/spec/13-command-line.md',
  routes: new Map([
    ['packages/docstamp/docs/spec/08-patterns.md', '/spec/patterns'],
    ['docs/PRINCIPLES.md', '/project/principles'],
  ]),
  isDirectory: (path) => path === 'packages/docstamp/src',
};

const rewrite = (text: string, over: Partial<LinkContext> = {}) =>
  rewriteLinks(text, { ...context, ...over });

describe('slug', () => {
  it('gives the anchors GitHub gives, the ones the specification links use', () => {
    expect(slug('13.4 Path Resolution')).toBe('134-path-resolution');
    expect(slug('9.6.4 Stamping')).toBe('964-stamping');
    expect(slug('8 Patterns')).toBe('8-patterns');
    expect(slug('13.8 list-dependents')).toBe('138-list-dependents');
  });
});

describe('rewriteLinks', () => {
  it('points a link to a published file at its route and keeps the anchor', () => {
    expect(rewrite('see [§8.5](08-patterns.md#85-resolution)')).toBe(
      'see [§8.5](/spec/patterns#85-resolution)',
    );
  });

  it('resolves the link against the file it comes from', () => {
    const from = 'packages/docstamp/docs/SPEC.md';
    expect(rewrite('[p](spec/08-patterns.md)', { from })).toBe('[p](/spec/patterns)');
    expect(rewrite('[p](PRINCIPLES.md)', { from: 'docs/VISION.md' })).toBe(
      '[p](/project/principles)',
    );
  });

  it('sends a file the site does not publish to GitHub, a directory to its tree', () => {
    expect(rewrite('[c](../../../../CHANGELOG.md)')).toBe(
      `[c](${REPOSITORY}/blob/main/CHANGELOG.md)`,
    );
    expect(rewrite('[s](../../src)')).toBe(`[s](${REPOSITORY}/tree/main/packages/docstamp/src)`);
  });

  it('leaves external links, anchors and mail links alone', () => {
    const text = '[a](https://example.com/x.md) [b](#top) [c](mailto:x@y.z) [d](//cdn/x)';
    expect(rewrite(text)).toBe(text);
  });

  it('keeps a title after the link', () => {
    expect(rewrite('[p](08-patterns.md "Patterns")')).toBe('[p](/spec/patterns "Patterns")');
  });

  it('rewrites a reference definition', () => {
    expect(rewrite('[p]: 08-patterns.md#8-patterns')).toBe('[p]: /spec/patterns#8-patterns');
  });

  it('does not touch fenced code', () => {
    const text = '```md\n[p](08-patterns.md)\n```\n[p](08-patterns.md)';
    expect(rewrite(text)).toBe('```md\n[p](08-patterns.md)\n```\n[p](/spec/patterns)');
  });

  it('keeps a link that leaves the repository as it is', () => {
    expect(rewrite('[x](../../../../../outside.md)')).toBe('[x](../../../../../outside.md)');
  });
});
