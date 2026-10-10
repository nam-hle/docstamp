import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSelected } from '../../src/config/selected.ts';
import { readConfig } from '../../src/config/read-config.ts';
import { loadScript } from '../../src/config/script.ts';
import type { Value } from '../../src/config/value.ts';
import { Raised } from '../../src/core/diagnostics.ts';
import { parseBlock } from '../../src/inline/block.ts';
import { scanFrontmatter } from '../../src/inline/frontmatter.ts';

const dirs: string[] = [];
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PLUGIN = "{ name:'p', apiVersion:1, files:['**/*.md'], extract(){ return {hashes:['h']} } }";

const diagnosticsOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof Raised) return error.diagnostics;
    throw error;
  }
  throw new Error('no Raised');
};

const entry = (...pairs: [string, Value][]) => new Map<string, Value>(pairs);

describe('§8.7 parseSelected', () => {
  it('defaults match to one and keeps all', () => {
    expect(parseSelected(entry(['path', 'a.md'], ['select', 'x']))).toEqual({
      path: 'a.md',
      select: 'x',
      match: 'one',
    });
    expect(parseSelected(entry(['path', 'a.md'], ['select', 'x'], ['match', 'all']))?.match).toBe(
      'all',
    );
  });

  it('turns a Map select into a plain object', () => {
    const parsed = parseSelected(entry(['path', 'a.md'], ['select', entry(['kind', 'fn'])]));
    expect(parsed?.select).toEqual({ kind: 'fn' });
  });

  it('rejects what is not an entry', () => {
    const bad: Value[] = [
      entry(['path', 'a.md'], ['select', 'x'], ['extra', 1]),
      entry(['path', 'a.md']),
      entry(['select', 'x']),
      entry(['path', 'a.md'], ['select', 'x'], ['match', 'many']),
      entry(['path', 'a/**'], ['select', 'x']),
      entry(['path', '!a.md'], ['select', 'x']),
      entry(['path', ''], ['select', 'x']),
      'a.md',
      ['a.md'],
    ];
    for (const value of bad) expect(parseSelected(value)).toBeNull();
  });
});

describe('§9.3 mixed dependencies (YAML)', () => {
  it('splits Patterns and Selected Dependencies', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'docstamp.yaml'),
      'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - src/**\n' +
        '      - { path: docs/guide.md, select: Install }\n',
    );
    const { config } = readConfig(dir);
    expect(config.declarations[0]?.dependencies).toEqual(['src/**']);
    expect(config.declarations[0]?.selected).toEqual([
      { path: 'docs/guide.md', select: 'Install', match: 'one' },
    ]);
  });

  it('rejects a Map with a bad key', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'docstamp.yaml'),
      'version: 2\nfiles:\n  CLAUDE.md:\n    dependencies:\n      - { path: a.md, select: x, zap: 1 }\n',
    );
    const [first] = diagnosticsOf(() => readConfig(dir));
    expect(first).toMatchObject({ code: 'E_CONFIG', file: 'CLAUDE.md', subject: 'dependencies' });
  });

  it('keeps the near-miss message of an entry without dependencies', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'docstamp.yaml'),
      'version: 2\nfiles:\n  CLAUDE.md:\n    dependancies: [a]\n',
    );
    const diagnostics = diagnosticsOf(() => readConfig(dir));
    expect(diagnostics[0]).toMatchObject({ code: 'E_CONFIG', file: 'CLAUDE.md' });
    expect(diagnostics[0]?.subject).toBe('');
    expect(diagnostics[0]?.message).toContain('did you mean "dependencies"');
  });
});

describe('§9.5 script plugins', () => {
  const writeScript = (dir: string, body: string) =>
    writeFileSync(join(dir, 'docstamp.config.mjs'), body);

  it('returns plugins apart from the plain value', () => {
    const dir = tmp();
    writeScript(
      dir,
      `export default { version: 2, plugins: [${PLUGIN}], files: { 'CLAUDE.md': ` +
        `{ dependencies: [{ path:'docs/guide.md', select:'Install' }] } } };`,
    );
    const { config, plugins } = readConfig(dir);
    expect(plugins).toHaveLength(1);
    expect(config.declarations[0]?.selected).toHaveLength(1);
    const loaded = loadScript(join(dir, 'docstamp.config.mjs'));
    expect((loaded.value as Map<string, Value>).has('plugins')).toBe(false);
    expect(Array.isArray(loaded.plugins)).toBe(true);
  });

  it('validates plugins', () => {
    const dir = tmp();
    writeScript(dir, 'export default { version: 2, plugins: [{}], files: {} };');
    expect(diagnosticsOf(() => readConfig(dir))[0]?.code).toBe('E_PLUGIN');
  });

  it('still rejects a function elsewhere', () => {
    const dir = tmp();
    writeScript(
      dir,
      "export default { version: 2, files: { 'a.md': { dependencies: ['x'], use: () => 1 } } };",
    );
    expect(diagnosticsOf(() => readConfig(dir))[0]?.code).toBe('E_CONFIG');
  });

  it('rejects a function in a nested plugins key', () => {
    const dir = tmp();
    writeScript(dir, "export default { version: 2, files: { 'a.md': { plugins: () => 1 } } };");
    expect(diagnosticsOf(() => readConfig(dir))[0]?.code).toBe('E_CONFIG');
  });

  it('turns a throwing getter on plugins into a Diagnostic', () => {
    const dir = tmp();
    writeScript(
      dir,
      'const exported = { version: 2, files: {} };\n' +
        "Object.defineProperty(exported, 'plugins', { get() { throw new Error('x'); }, enumerable: true });\n" +
        'export default exported;',
    );
    const [first] = diagnosticsOf(() => readConfig(dir));
    expect(first).toMatchObject({ code: 'E_CONFIG', subject: 'plugins' });
  });
});

describe('§9.5 plugins in YAML', () => {
  it('is E_UNKNOWN_KEY with a hint', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'docstamp.yaml'), 'version: 2\nplugins: []\nfiles: {}\n');
    const [first] = diagnosticsOf(() => readConfig(dir));
    expect(first).toMatchObject({ code: 'E_UNKNOWN_KEY', subject: 'plugins' });
    expect(first?.message).toContain('docstamp.config');
  });
});

describe('§9.6.2 inline selected', () => {
  const parse = (block: string) => {
    const text = `---\n${block}\n---\nbody\n`;
    return parseBlock('doc.md', scanFrontmatter(text)!);
  };

  it('reads Selected Dependencies beside Patterns', () => {
    const { declaration, problems } = parse(
      'docstamp:\n  dependencies:\n    - src/**\n    - path: docs/guide.md\n' +
        '      select: { kind: function, name: abc }',
    );
    expect(problems).toEqual([]);
    expect(declaration.dependencies).toEqual(['src/**']);
    expect(declaration.selected?.[0]?.select).toEqual({ kind: 'function', name: 'abc' });
  });

  it('collects E_BLOCK for a bad entry', () => {
    const { problems } = parse('docstamp:\n  dependencies:\n    - path: a/**\n      select: x');
    expect(problems[0]).toMatchObject({ code: 'E_BLOCK', subject: 'dependencies' });
  });
});
