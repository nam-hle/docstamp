import { run } from './cli/run.ts';

try {
  process.exitCode = run(process.argv.slice(2), process.cwd(), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    isTty: process.stdout.isTTY === true,
    env: process.env,
  });
} catch (error) {
  process.stderr.write(`internal error: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 70;
}
