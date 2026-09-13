// Explicit opt-in: requires the dedicated VM and a pinned TUTOR_RUNNER_IMAGE.
import assert from 'node:assert/strict';
import { verifyJob } from '../packages/runner/docker-runner.mjs';

async function check(name, code, cases, expected) {
  const report = await verifyJob({ code, cases, acknowledged: true });
  assert.deepEqual(report.results.map(r => r.status), expected, name);
  console.log(JSON.stringify({ name, status: report.status, results: report.results }));
}

// Preserves the previous real Qwen response's executable logic; not regenerated.
await check('previous Qwen sum: sample, empty, negative', `function solve(input) {
  let arr;
  if (Array.isArray(input)) arr = input;
  else if (input && typeof input === 'object' && Array.isArray(input.array)) arr = input.array;
  else return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum;
}`, [{ input: [1, 2], expected: 3 }, { input: [], expected: 0 }, { input: [-3, 1], expected: -2 }], ['passed', 'passed', 'passed']);

await check('wrong answer', 'function solve() { return 999; }', [{ input: [1, 2], expected: 3 }], ['failed']);
await check('exception', 'function solve() { throw new Error("test"); }', [{ input: 0, expected: 0 }], ['runtime_error']);
await check('infinite loop', 'function solve() { while(true) {} }', [{ input: 0, expected: 0 }], ['timeout']);
await check('stdout flood', 'function solve() { while(true) process.stdout.write("x".repeat(8192)); }', [{ input: 0, expected: 0 }], ['output_limit']);

await check('isolation and enforced cgroups', `function solve() {
  const fs = process.getBuiltinModule('fs');
  const os = process.getBuiltinModule('os');
  let readonly = false;
  try { fs.writeFileSync('/tmp/tutor-probe', 'x'); } catch(e) { readonly = e.code === 'EROFS'; }
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  return {
    uid: process.getuid(), readonly,
    interfaces: Object.keys(os.networkInterfaces()),
    hostHome: fs.existsSync('/Users/minhuifang'), socket: fs.existsSync('/var/run/docker.sock'),
    modelKey: Boolean(process.env.DASHSCOPE_API_KEY), proxy: Boolean(process.env.HTTP_PROXY || process.env.https_proxy),
    memory: fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(),
    pids: fs.readFileSync('/sys/fs/cgroup/pids.max', 'utf8').trim(),
    cpu: fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(),
    caps: status.match(/CapEff:\\s+(\\w+)/)[1],
    noNewPrivileges: status.match(/NoNewPrivs:\\s+(\\d+)/)[1]
  };
}`, [{ input: null, expected: { uid: 65534, readonly: true, interfaces: ['lo'], hostHome: false, socket: false, modelKey: false, proxy: false, memory: '134217728', pids: '32', cpu: '50000 100000', caps: '0000000000000000', noNewPrivileges: '1' } }], ['passed']);
