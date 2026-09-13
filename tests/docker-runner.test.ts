import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containerArgs, validateJob } from '../packages/runner/docker-runner.mjs';

test('隔离运行参数固定，无网络、挂载、密钥、特权，镜像必须为摘要', () => {
  const args = containerArgs('tutor-case-12345678-1234-1234-1234-123456789abc', `node@sha256:${'a'.repeat(64)}`);
  for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534', '--memory=128m', '--memory-swap=128m', '--pids-limit=32', '--pull=never']) assert.ok(args.includes(flag));
  for (const flag of ['--privileged', '-v', '--mount', '-e', '--env-file']) assert.equal(args.slice(0, -2).includes(flag), false);
  assert.throws(() => containerArgs('bad', 'node:latest'));
});
test('隔离运行必须人工确认，限定输入结构和样例数量', () => {
  const job = { code: 'function solve(input) { return input; }', acknowledged: true, cases: [{ input: [1], expected: [1] }] };
  assert.equal(validateJob(job), job);
  assert.throws(() => validateJob({ ...job, acknowledged: false }));
  assert.throws(() => validateJob({ ...job, command: 'sh' }));
  assert.throws(() => validateJob({ ...job, cases: [] }));
  assert.throws(() => validateJob({ ...job, cases: [{ input: 1 }] }));
});
