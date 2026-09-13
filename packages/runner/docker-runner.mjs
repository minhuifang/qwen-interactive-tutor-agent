// Host-side controller only. Untrusted JavaScript is evaluated exclusively inside Docker.
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { runnerImage } from './runtime-config.mjs';

const context = 'colima-tutor-sandbox';
const harness = `const fs = require('node:fs');
const { code, input } = JSON.parse(fs.readFileSync(0, 'utf8'));
const solve = new Function(code + '\\n;return solve;')();
Promise.resolve(solve(input)).then(value => {
  const output = JSON.stringify({ value });
  if (!output || !Object.hasOwn(JSON.parse(output), 'value')) process.exit(2);
  process.stdout.write(output);
}).catch(() => process.exit(2));`;

export function validateJob(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['code', 'cases', 'acknowledged'].includes(k))) throw new Error('Invalid job');
  if (raw.acknowledged !== true || typeof raw.code !== 'string' || !raw.code.trim() || raw.code.length > 16000) throw new Error('Review code and acknowledge before execution');
  if (!Array.isArray(raw.cases) || raw.cases.length < 1 || raw.cases.length > 8) throw new Error('Provide 1–8 reviewed cases');
  for (const item of raw.cases) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(k => !['input', 'expected'].includes(k)) || !Object.hasOwn(item, 'input') || !Object.hasOwn(item, 'expected')) throw new Error('Each case requires input and expected');
    if (JSON.stringify(item).length > 8000) throw new Error('Case too large');
  }
  return raw;
}

export function containerArgs(name, image) {
  if (!/^tutor-case-[0-9a-f-]{36}$/.test(name)) throw new Error('Invalid container name');
  if (!/^node@sha256:[0-9a-f]{64}$/.test(image)) throw new Error('Set TUTOR_RUNNER_IMAGE to a reviewed node@sha256 digest');
  return ['--context', context, 'run', '--name', name, '--rm', '-i', '--pull=never',
    '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--user=65534:65534', '--cpus=0.5', '--memory=128m', '--memory-swap=128m',
    '--pids-limit=32', '--ulimit=nofile=64:64', '--log-driver=none',
    ...['HTTP_PROXY', 'HTTPS_PROXY', 'FTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'ftp_proxy', 'all_proxy', 'no_proxy'].map(key => `--env=${key}=`),
    '--entrypoint=node', image, '--max-old-space-size=64', '-e', harness];
}

function removeContainer(docker, name) {
  return new Promise(resolve => execFile(docker, ['--context', context, 'rm', '-f', name], { timeout: 5000, maxBuffer: 4096 }, error => {
    if (!error) return resolve(true);
    // --rm may already have removed it. Distinguish absence from daemon failure.
    execFile(docker, ['--context', context, 'ps', '-aq', '--filter', `name=^/${name}$`], { timeout: 5000, maxBuffer: 4096 }, (inspectError, stdout) => resolve(!inspectError && !stdout.trim()));
  }));
}

async function runCase(code, input, image, docker) {
  const name = `tutor-case-${randomUUID()}`;
  const args = containerArgs(name, image);
  const chunks = [];
  let size = 0, failure = null;
  const child = spawn(docker, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  // Includes startup; no automatic retries. rm -f targets only this generated name.
  const timer = setTimeout(() => { failure = 'timeout'; child.kill('SIGKILL'); }, 8000);
  const consume = (chunk, stdout) => {
    size += chunk.length;
    if (size > 32768) { failure = 'output_limit'; child.kill('SIGKILL'); return; }
    if (stdout) chunks.push(chunk);
  };
  child.stdout.on('data', chunk => consume(chunk, true));
  child.stderr.on('data', chunk => consume(chunk, false));
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ code, input }));
  try {
    const exitCode = await new Promise(resolve => {
      child.once('error', () => { failure = 'unavailable'; resolve(-1); });
      child.once('close', resolve);
    });
    if (failure) return { status: failure };
    if (exitCode !== 0) return { status: exitCode === 125 ? 'unavailable' : 'runtime_error' };
    try {
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || Object.keys(result).length !== 1 || !Object.hasOwn(result, 'value')) throw new Error();
      return { status: 'completed', actual: result.value };
    } catch { return { status: 'invalid_output' }; }
  } finally {
    clearTimeout(timer);
    // Always attempt cleanup, including after killing the Docker CLI.
    const removed = await removeContainer(docker, name);
    if (!removed) throw new Error(`Cleanup could not be confirmed for ${name}; inspect the isolated runtime before continuing`);
  }
}

let busy = false;
export async function verifyJob(raw, { image = process.env.TUTOR_RUNNER_IMAGE || runnerImage, docker = '/opt/homebrew/bin/docker', signal = undefined } = {}) {
  const job = validateJob(raw);
  containerArgs(`tutor-case-${randomUUID()}`, image || '');
  if (busy) throw new Error('Runner busy');
  busy = true;
  try {
    const results = [];
    for (const item of job.cases) {
      // Let the current bounded case finish/clean up, but never start more after disconnect.
      if (signal?.aborted) break;
      const result = await runCase(job.code, item.input, image, docker);
      const { status, ...rest } = result;
      results.push({ ...rest, status: status === 'completed' ? (isDeepStrictEqual(result.actual, item.expected) ? 'passed' : 'failed') : status });
      if (['unavailable', 'timeout', 'output_limit'].includes(status)) break;
    }
    return { status: results.length === job.cases.length && results.every(r => r.status === 'passed') ? 'examples_passed' : 'not_passed', results,
      notice: 'Only the supplied, manually reviewed examples were checked. This is not a correctness proof.' };
  } finally { busy = false; }
}
