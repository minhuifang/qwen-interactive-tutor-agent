import { readFile, stat } from 'node:fs/promises';
import { verifyJob } from './docker-runner.mjs';

try {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error('Usage: node packages/runner/cli.mjs <reviewed-job.json>');
  if ((await stat(path)).size > 100000) throw new Error('Job file exceeds 100 KB');
  const result = await verifyJob(JSON.parse(await readFile(path, 'utf8')));
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'examples_passed') process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Runner unavailable');
  process.exitCode = 1;
}
