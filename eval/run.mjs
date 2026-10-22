// Live evaluation: runs the real agent loop against the fixed problem set using
// the real model and the real Docker sandbox.
//
//   node eval/run.mjs                 # all 20
//   node eval/run.mjs --limit 5       # smoke test
//   node eval/run.mjs --id two-sum    # one problem
//
// Requires DEEPSEEK_API_KEY and a running `colima start tutor-sandbox`.
// Costs money: each problem makes 2–5 model calls and up to 5 container runs.

import { writeFileSync } from 'node:fs';
import { runAgent } from '../packages/agent/loop.mjs';
import { createChatModel } from '../packages/agent/model.mjs';
import { readModelConfig } from '../packages/agent/env.mjs';
import { verifyJob } from '../packages/runner/docker-runner.mjs';
import { problems } from './problems.mjs';

const args = process.argv.slice(2);
const flag = name => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const limit = flag('limit') ? Number(flag('limit')) : undefined;
const onlyId = flag('id');
const maxRounds = flag('rounds') ? Number(flag('rounds')) : 4;
const outFile = flag('out') || 'eval/results.json';

if (onlyId && !problems.some(problem => problem.id === onlyId)) {
  console.error(`未知题目 id：${onlyId}`);
  process.exit(2);
}

const selected = problems
  .filter(problem => !onlyId || problem.id === onlyId)
  .slice(0, limit ?? problems.length);

let config;
try {
  config = readModelConfig();
} catch (error) {
  console.error(`无法开始评测：${error.message}`);
  process.exit(2);
}

// Preflight: fail fast instead of burning model calls when the sandbox is down.
process.stdout.write('检查隔离执行器…');
try {
  const report = await verifyJob({ acknowledged: true, code: 'function solve(value) { return value; }', cases: [{ input: 1, expected: 1 }] });
  if (report.status !== 'examples_passed') throw new Error(`执行器返回 ${report.status}`);
  console.log(' 可用');
} catch (error) {
  console.log(` 不可用\n\n${error.message}`);
  console.error('请先启动专用沙箱：colima start tutor-sandbox，并确认 tutor-sandbox 镜像存在（见 docs/runner-setup.md）。\n没有沙箱时模型无法获得执行反馈，跑出来的数字没有意义，因此本次评测不开始。');
  process.exit(3);
}

const callModel = createChatModel(config);
const results = [];

for (const [index, problem] of selected.entries()) {
  const started = Date.now();
  const events = [];
  process.stdout.write(`[${index + 1}/${selected.length}] ${problem.id} … `);
  const outcome = await runAgent({
    problem: { title: problem.title, statement: problem.statement, inputContract: problem.inputContract },
    cases: problem.cases,
    callModel,
    runTests: (job, opts) => verifyJob({ ...job, acknowledged: true }, opts),
    emit: event => events.push(event),
    model: config.model,
    mode: 'live',
    maxRounds,
    runId: `eval-${problem.id}`,
  });
  const testRuns = events.filter(event => event.type === 'tool_result').length;
  results.push({
    id: problem.id,
    status: outcome.status,
    passed: outcome.verification.passed,
    total: outcome.verification.total,
    rounds: outcome.rounds,
    testRuns,
    tokens: outcome.usage?.total_tokens ?? 0,
    durationMs: Date.now() - started,
    reason: outcome.reason,
  });
  console.log(`${outcome.status} (${outcome.verification.passed}/${outcome.verification.total}, ${outcome.rounds} 轮, ${outcome.usage?.total_tokens ?? 0} tokens)`);
}

const solved = results.filter(item => item.status === 'examples_passed').length;
const attempted = results.length;
const summary = {
  model: config.model,
  maxRounds,
  attempted,
  solved,
  passRate: attempted ? Number((solved / attempted).toFixed(3)) : 0,
  avgRounds: attempted ? Number((results.reduce((sum, item) => sum + item.rounds, 0) / attempted).toFixed(2)) : 0,
  avgTestRuns: attempted ? Number((results.reduce((sum, item) => sum + item.testRuns, 0) / attempted).toFixed(2)) : 0,
  totalTokens: results.reduce((sum, item) => sum + item.tokens, 0),
  ranAt: new Date().toISOString(),
  note: '样例通过只说明这些已确认样例通过，不构成正确性证明。',
  results,
};

writeFileSync(new URL(`../${outFile}`, import.meta.url), JSON.stringify(summary, null, 2));
console.log(`\n通过 ${solved}/${attempted}（${(summary.passRate * 100).toFixed(1)}%），平均 ${summary.avgRounds} 轮、${summary.avgTestRuns} 次执行，共 ${summary.totalTokens} tokens`);
console.log(`写入 ${outFile}`);
