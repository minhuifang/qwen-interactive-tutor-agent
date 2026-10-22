import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from './loop.mjs';
import { createScriptedModel, createSimulatedRunner } from './scripted.mjs';
import { validateArguments, boundedObservation, LIMITS } from './tools.mjs';
import { parseEventLine, isValidEvent } from './protocol.mjs';

const problem = {
  title: '两数之和',
  statement: '给定整数数组 nums 和目标值 target，返回两个数的下标。',
  inputContract: 'input = { nums: number[], target: number }',
};
const cases = [
  { input: { nums: [2, 7, 11, 15], target: 9 }, expected: [0, 1] },
  { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
];

const collect = () => {
  const events = [];
  return { events, emit: event => events.push(event) };
};
const failed = (n = 3) => ({ status: 'not_passed', results: Array.from({ length: n }, (_, i) => ({ status: i === 0 ? 'passed' : 'failed', actual: i === 0 ? [0, 1] : [] })) });
const passed = (n = 3) => ({ status: 'examples_passed', results: Array.from({ length: n }, () => ({ status: 'passed', actual: [0, 1] })) });

test('失败后修复：第二轮通过，结论来自执行器', async () => {
  const { events, emit } = collect();
  const model = createScriptedModel([
    { thought: '先写暴力解法。', calls: [{ name: 'run_tests', arguments: { code: 'function solve(input){return []}' } }] },
    { thought: '第一例通过，后两例返回空。外层循环少了一层。', calls: [{ name: 'run_tests', arguments: { code: 'function solve(input){return [0,1]}', note: '补全内层循环' } }] },
    { thought: '全部通过，提交。', calls: [{ name: 'finish', arguments: { code: 'function solve(input){return [0,1]}', approach: '枚举', steps: ['遍历'], timeComplexity: 'O(n^2)', spaceComplexity: 'O(1)' } }] },
  ]);
  const runner = createSimulatedRunner([failed(), passed()]);
  const result = await runAgent({ problem, cases, callModel: model, runTests: runner, emit, model: 'scripted', mode: 'scripted' });

  assert.equal(result.status, 'examples_passed');
  assert.equal(result.rounds, 3);
  assert.equal(result.verification.passed, 3);
  assert.equal(model.calls(), 3);
  assert.equal(runner.calls(), 2);

  const results = events.filter(e => e.type === 'tool_result');
  assert.deepEqual(results.map(r => r.status), ['not_passed', 'examples_passed']);
  assert.equal(events.at(-1).type, 'final');
  // every event must survive the client-side validator
  for (const event of events) assert.equal(isValidEvent(event), true, JSON.stringify(event).slice(0, 120));
  assert.equal(events.filter(e => e.type === 'round_start').length, 3);
});

test('模型直接 finish 未执行过的代码：自动补跑一次，仍然以执行器判定为准', async () => {
  const { events, emit } = collect();
  const model = createScriptedModel([
    { thought: '我确信已经正确。', calls: [{ name: 'finish', arguments: { code: 'function solve(){throw new Error("x")}', approach: '直接返回', steps: ['跳过验证'], timeComplexity: 'O(1)', spaceComplexity: 'O(1)' } }] },
  ]);
  const runner = createSimulatedRunner([failed()]);
  const result = await runAgent({ problem, cases, callModel: model, runTests: runner, emit, model: 'scripted', mode: 'scripted' });

  assert.equal(runner.calls(), 1, '提交前必须执行一次');
  assert.equal(result.status, 'not_passed', '模型不能自称通过');
  const auto = events.find(e => e.type === 'tool_call' && e.auto);
  assert.ok(auto, '应记录自动验证的调用');
});

test('提交代码与上次执行不一致且执行器不可用：标记未验证，不继承旧结论', async () => {
  const model = createScriptedModel([
    { calls: [{ name: 'run_tests', arguments: { code: 'function solve(){return 1}' } }] },
    { calls: [{ name: 'finish', arguments: { code: 'function solve(){return 2}', approach: '改了一行', steps: ['改'], timeComplexity: 'O(1)', spaceComplexity: 'O(1)' } }] },
  ]);
  const runner = createSimulatedRunner([passed(), { status: 'unavailable', results: [] }, { status: 'unavailable', results: [] }]);
  const result = await runAgent({ problem, cases, callModel: model, runTests: runner, model: 'scripted', mode: 'scripted' });
  assert.equal(result.status, 'blocked');
  assert.equal(result.verification.status, 'not_run');
});

test('工具参数不合法：作为观察返回给模型，循环继续且不抛异常', async () => {
  const { events, emit } = collect();
  const model = createScriptedModel([
    { calls: [{ name: 'run_tests', arguments: { code: '```js\nfunction solve(){}\n```' } }] },
    { calls: [{ name: 'delete_everything', arguments: {} }] },
    { calls: [{ name: 'run_tests', arguments: { code: 'function solve(){return [0,1]}', extra: 1 } }] },
    { calls: [{ name: 'finish', arguments: { code: 'function solve(){return [0,1]}', approach: '枚举', steps: ['遍历'], timeComplexity: 'O(n^2)', spaceComplexity: 'O(1)' } }] },
  ]);
  const runner = createSimulatedRunner([passed()]);
  const result = await runAgent({ problem, cases, callModel: model, runTests: runner, emit, model: 'scripted', mode: 'scripted' });

  const invalid = events.filter(e => e.type === 'tool_result' && e.status === 'invalid_arguments');
  assert.equal(invalid.length, 3);
  assert.match(invalid[0].note, /Markdown 围栏/);
  assert.match(invalid[1].note, /未知工具/);
  assert.match(invalid[2].note, /不支持的字段/);
  assert.equal(result.status, 'examples_passed');
  assert.equal(runner.calls(), 1, '非法调用不能触达沙箱');
});

test('模型不调用工具：提示后继续，不消耗执行器', async () => {
  const { events, emit } = collect();
  const model = createScriptedModel([
    { thought: '这题很简单，我直接说思路。', calls: [] },
    { calls: [{ name: 'run_tests', arguments: { code: 'function solve(){return [0,1]}' } }] },
    { calls: [{ name: 'finish', arguments: { code: 'function solve(){return [0,1]}', approach: '枚举', steps: ['遍历'], timeComplexity: 'O(n^2)', spaceComplexity: 'O(1)' } }] },
  ]);
  const runner = createSimulatedRunner([passed()]);
  const result = await runAgent({ problem, cases, callModel: model, runTests: runner, emit, model: 'scripted', mode: 'scripted' });
  assert.equal(events.filter(e => e.type === 'round_end' && e.verdict === 'no_tool').length, 1);
  assert.equal(result.status, 'examples_passed');
});

test('执行器连续不可用：第二次即停止，不空转', async () => {
  const model = createScriptedModel([
    { calls: [{ name: 'run_tests', arguments: { code: 'function solve(){}' } }] },
    { calls: [{ name: 'run_tests', arguments: { code: 'function solve(){return 1}' } }] },
    { calls: [{ name: 'run_tests', arguments: { code: 'function solve(){return 2}' } }] },
  ]);
  const runner = createSimulatedRunner([new Error('runner down')]);
  const result = await runAgent({ problem, cases, callModel: model, runTests: runner, model: 'scripted', mode: 'scripted', maxRounds: 4 });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /连续不可用/);
  assert.equal(runner.calls(), 2);
});

test('轮次与调用预算：到上限即停止并说明原因', async () => {
  const oneRound = () => createScriptedModel([{ calls: [{ name: 'run_tests', arguments: { code: 'function solve(){return []}' } }] }]);
  const a = await runAgent({ problem, cases, callModel: oneRound(), runTests: createSimulatedRunner([failed()]), maxRounds: 2, model: 'scripted', mode: 'scripted' });
  assert.equal(a.status, 'not_passed');
  assert.match(a.reason, /2 轮上限/);

  const b = await runAgent({ problem, cases, callModel: oneRound(), runTests: createSimulatedRunner([failed()]), maxRounds: 3, maxModelCalls: 1, model: 'scripted', mode: 'scripted' });
  assert.equal(b.status, 'budget_limit');
});

test('取消：保留已完成结果并标记 cancelled', async () => {
  const controller = new AbortController();
  const model = createScriptedModel([
    { calls: [{ name: 'run_tests', arguments: { code: 'function solve(){return [0,1]}' } }] },
    { calls: [{ name: 'run_tests', arguments: { code: 'function solve(){return [1,0]}' } }] },
  ]);
  const runner = async (job, opts) => { controller.abort(); return passed(); };
  const result = await runAgent({ problem, cases, callModel: model, runTests: runner, signal: controller.signal, model: 'scripted', mode: 'scripted' });
  assert.equal(result.status, 'cancelled');
});

test('观察值有大小上限，超长时先丢逐例明细', () => {
  const big = { status: 'not_passed', passed: 0, total: 8, results: Array.from({ length: 8 }, () => ({ status: 'failed', actual: 'x'.repeat(4000) })) };
  const json = boundedObservation(big);
  assert.ok(json.length <= LIMITS.observationBytes);
  assert.equal(JSON.parse(json).truncated, true);
});

test('参数校验：长度、围栏、必填与多余字段', () => {
  assert.equal(validateArguments('run_tests', { code: 'function solve(){}' }).ok, true);
  assert.equal(validateArguments('run_tests', { code: '' }).ok, false);
  assert.equal(validateArguments('run_tests', { code: 'x'.repeat(LIMITS.code + 1) }).ok, false);
  assert.equal(validateArguments('run_tests', { code: 'function solve(){}', note: 'x' }).ok, true);
  assert.equal(validateArguments('finish', { code: 'function solve(){}', approach: 'a', timeComplexity: 'O(n)', spaceComplexity: 'O(1)' }).ok, true);
  assert.equal(validateArguments('finish', { code: 'function solve(){}', approach: 'a' }).ok, false);
  assert.equal(validateArguments('finish', { code: 'function solve(){}', approach: 'a', timeComplexity: 'O(n)', spaceComplexity: 'O(1)', steps: 'one' }).ok, false);
  assert.equal(validateArguments('rm_rf', { code: 'x' }).ok, false);
});

test('线协议：非法行被丢弃而不是抛错', () => {
  assert.equal(parseEventLine(''), null);
  assert.equal(parseEventLine('not json'), null);
  assert.equal(parseEventLine('{"type":"hack"}'), null);
  assert.equal(parseEventLine('{"type":"error","message":"boom"}').type, 'error');
  assert.equal(parseEventLine('{"type":"final","status":"examples_passed","reason":"ok","solution":null,"rounds":1}').status, 'examples_passed');
});
