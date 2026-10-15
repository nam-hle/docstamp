import { describe, expect, it, vi } from 'vitest';

vi.mock('@asciidoctor/core', () => ({
  default: () => {
    throw new Error('parser failure at /private/path/secret.adoc');
  },
}));

describe('§6 Extract step 2', () => {
  it('reports a parser failure as an error that holds no text of the parser', async () => {
    const { default: plugin } = await import('../../src/index.ts');
    const result = plugin.extract({ path: 'guide.adoc', text: '== A\n', select: 'A' });
    expect(result.parts).toBeUndefined();
    expect(result.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'parse-failed',
        message: 'The file could not be parsed as AsciiDoc.',
      },
    ]);
  });
});
