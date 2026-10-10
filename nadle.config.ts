// The build tool. `pnpm build`, `pnpm test`, `pnpm format`, `pnpm schema` and `pnpm clean` are aliases
// onto the tasks below; every other step is `pnpm nadle <task>` (`pnpm nadle --list` shows them).
// One config at the root drives the repository: a package's tasks run with `workingDir` set to it.
import { tasks, configure, Inputs, PnpxTask, NodeTask, DeleteTask } from 'nadle';

// A person at a terminal gets nadle's default reporter. Anything else (an agent, CI, a pipe) gets
// one line per task and only the output of what failed.
const AT_TERMINAL = Boolean(process.stdout.isTTY) && !process.env['CI'];
configure({ reporter: AT_TERMINAL ? 'default' : 'agent' });

const DOCSTAMP = 'packages/docstamp';
const MARKDOWN = 'packages/docstamp-plugin-markdown';

// Directories that hold code, per tool. A package's own `dist` and `node_modules` are never inputs.
const CODE = [
  'action',
  `${DOCSTAMP}/src`,
  `${DOCSTAMP}/tests`,
  `${DOCSTAMP}/scripts`,
  `${MARKDOWN}/src`,
  `${MARKDOWN}/tests`,
];

// What can change the verdict of a check: the code, and the configuration of every tool.
const verdictInputs = [
  Inputs.dirs(...CODE),
  Inputs.files(
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig*.json',
    '*.config.ts',
    '.oxfmtrc.json',
    'knip.json',
    `${DOCSTAMP}/package.json`,
    `${DOCSTAMP}/tsconfig*.json`,
    `${DOCSTAMP}/*.config.ts`,
    `${MARKDOWN}/package.json`,
    `${MARKDOWN}/tsconfig*.json`,
    `${MARKDOWN}/*.config.ts`,
  ),
];

// --- Checking ---

tasks.register('formatCheck', {
  run: PnpxTask,
  group: 'Checking',
  cacheVerdict: true,
  description: 'Check formatting with oxfmt (read-only)',
  options: { command: 'oxfmt', args: ['--check', ...CODE] },
  inputs: verdictInputs,
});

tasks.register('lint', {
  run: PnpxTask,
  group: 'Checking',
  cacheVerdict: true,
  description: 'Lint with oxlint, type-aware (read-only)',
  options: {
    command: 'oxlint',
    args: ['--type-aware', '--ignore-pattern', '**/tests/e2e/fixtures/**', ...CODE],
  },
  inputs: verdictInputs,
});

tasks.register('typecheckRoot', {
  run: PnpxTask,
  group: 'Checking',
  cacheVerdict: true,
  description: 'Type-check the Action and the root configs (read-only)',
  options: { command: 'tsc', args: ['--noEmit'] },
  inputs: verdictInputs,
});

tasks.register('typecheckDocstamp', {
  run: PnpxTask,
  group: 'Checking',
  cacheVerdict: true,
  description: 'Type-check the docstamp package: src, tests, scripts, configs (read-only)',
  options: {
    command: 'tsc',
    args: ['--noEmit', '-p', `${DOCSTAMP}/tsconfig.json`],
  },
  inputs: verdictInputs,
});

// The plugin imports the types of docstamp, which are the declarations docstamp builds into dist.
tasks.register('typecheckMarkdown', {
  run: PnpxTask,
  group: 'Checking',
  cacheVerdict: true,
  dependsOn: ['declarations'],
  description: 'Type-check docstamp-plugin-markdown (read-only)',
  options: {
    command: 'tsc',
    args: ['--noEmit', '-p', `${MARKDOWN}/tsconfig.json`],
  },
  inputs: [...verdictInputs, Inputs.files(`${DOCSTAMP}/dist/lib.d.ts`)],
});

tasks.register('typecheck', {
  group: 'Checking',
  dependsOn: ['typecheckRoot', 'typecheckDocstamp', 'typecheckMarkdown'],
  description: 'Type-check every project (read-only)',
});

tasks.register('knip', {
  run: PnpxTask,
  group: 'Checking',
  cacheVerdict: true,
  description: 'Find unused dependencies, files and exports in every workspace (read-only)',
  options: { command: 'knip' },
  inputs: verdictInputs,
});

// --- Building ---

tasks.register('bundle', {
  run: PnpxTask,
  group: 'Building',
  workingDir: DOCSTAMP,
  description: 'Bundle the CLI and the library with tsup (writes dist)',
  options: { command: 'tsup', args: AT_TERMINAL ? [] : ['--silent'] },
});

// tsup removes dist when its config loads, so the declarations are emitted after it, never beside.
tasks.register('declarations', {
  run: PnpxTask,
  group: 'Building',
  workingDir: DOCSTAMP,
  dependsOn: ['bundle'],
  description: 'Emit the library declarations into dist (writes dist)',
  options: { command: 'tsc', args: ['-p', 'tsconfig.lib.json'] },
});

tasks.register('bundleMarkdown', {
  run: PnpxTask,
  group: 'Building',
  workingDir: MARKDOWN,
  description: 'Bundle docstamp-plugin-markdown with tsup (writes dist)',
  options: { command: 'tsup', args: AT_TERMINAL ? [] : ['--silent'] },
});

tasks.register('declarationsMarkdown', {
  run: PnpxTask,
  group: 'Building',
  workingDir: MARKDOWN,
  dependsOn: ['bundleMarkdown', 'declarations'],
  description: 'Emit the declarations of docstamp-plugin-markdown into dist (writes dist)',
  options: { command: 'tsc', args: ['-p', 'tsconfig.build.json'] },
});

tasks.register('buildMarkdown', {
  group: 'Building',
  dependsOn: ['bundleMarkdown', 'declarationsMarkdown'],
  description: 'docstamp-plugin-markdown and its declarations (writes dist)',
});

tasks.register('buildDocstamp', {
  group: 'Building',
  dependsOn: ['bundle', 'declarations'],
  description: 'The docstamp CLI, library and declarations (writes dist)',
});

tasks.register('build', {
  group: 'Building',
  dependsOn: ['buildDocstamp', 'buildMarkdown'],
  description:
    'Every package: the CLI, the library, the plugins and their declarations (writes dist)',
});

tasks.register('schema', {
  run: NodeTask,
  group: 'Building',
  workingDir: DOCSTAMP,
  description: 'Regenerate schema.json and schema-frontmatter.json (writes)',
  options: { script: 'scripts/write-schema.ts' },
});

tasks.register('clean', {
  run: DeleteTask,
  group: 'Building',
  description: 'Delete dist (writes)',
  options: { paths: [`${DOCSTAMP}/dist`, `${MARKDOWN}/dist`] },
});

// --- Testing ---

// docstamp checking its own docs: the built CLI run on this repository.
tasks.register('docstamp', {
  run: NodeTask,
  group: 'Testing',
  dependsOn: ['buildDocstamp'],
  description: 'Run the built docstamp on this repository (read-only)',
  options: { script: `${DOCSTAMP}/dist/index.js` },
});

tasks.register('testUnit', {
  run: PnpxTask,
  group: 'Testing',
  workingDir: DOCSTAMP,
  description: 'Run the docstamp unit tests (read-only)',
  options: { command: 'vitest', args: ['run', 'tests/unit'] },
});

tasks.register('testAction', {
  run: PnpxTask,
  group: 'Testing',
  description: 'Run the GitHub Action tests (read-only)',
  options: { command: 'vitest', args: ['run'] },
});

tasks.register('testE2e', {
  run: PnpxTask,
  group: 'Testing',
  workingDir: DOCSTAMP,
  dependsOn: ['buildDocstamp'],
  description:
    'Run the end-to-end tests against the built CLI (read-only; -- -u updates snapshots)',
  options: { command: 'vitest', args: ['run', 'tests/e2e/scenarios'] },
});

tasks.register('testMarkdown', {
  run: PnpxTask,
  group: 'Testing',
  workingDir: MARKDOWN,
  dependsOn: ['buildDocstamp', 'buildMarkdown'],
  description: 'Run the docstamp-plugin-markdown tests, with the real docstamp CLI (read-only)',
  options: { command: 'vitest', args: ['run'] },
});

tasks.register('testPack', {
  run: PnpxTask,
  group: 'Testing',
  workingDir: DOCSTAMP,
  dependsOn: ['buildDocstamp'],
  description: 'Pack the package, extract it into node_modules and run the bin (read-only)',
  options: { command: 'vitest', args: ['run', 'tests/e2e/pack.test.ts'] },
});

// The release workflow's gate: the package's own correctness, not the docs self-check.
tasks.register('verifyRelease', {
  group: 'Testing',
  dependsOn: ['testUnit', 'testE2e', 'testPack'],
  description: 'The docstamp unit, end-to-end and pack tests, as publish.yml runs them',
});

// The gate. `pnpm test` is `nadle test --continue`, which reports every failure.
tasks.register('test', {
  group: 'Testing',
  dependsOn: [
    'formatCheck',
    'lint',
    'typecheck',
    'knip',
    'docstamp',
    'testUnit',
    'testAction',
    'testMarkdown',
    'testE2e',
    'testPack',
  ],
  description:
    'The gate: format, lint, types, knip, the build, the self-check and every test suite',
});

// --- Formatting ---

tasks.register('format', {
  run: PnpxTask,
  group: 'Formatting',
  description: 'Format with oxfmt, which also orders imports (writes)',
  options: { command: 'oxfmt', args: CODE },
});
