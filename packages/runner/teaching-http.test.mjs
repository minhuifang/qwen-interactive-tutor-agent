// HTTP-level tests for the teaching endpoint: validation gate, scripted labelling,
// and the invariant that matters most — answering a question must not move the
// student to another step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRunnerMiddleware } from './http-middleware.mjs';

const PROBLEM = {
  title: '两数之和',
  statement: '给定一个整数数组 nums 和一个整数目标值 target，返回和为目标值的两个整数的下标。',
  inputContract: 'input = { nums, target }',
};

async function setup(modelFactory) {
  const hosts = new Set();
  const middleware = createRunnerMiddleware(async () => ({ status: 'examples_passed', results: [] }), Date.now, { modelFactory, hosts });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  hosts.add(`127.0.0.1:${port}`);
  const headers = { 'Content-Type': 'application/json', 'X-Tutor-Local': '1', Origin: `http://127.0.0.1:${port}` };
  return {
    close: () => new Promise(resolve => server.close(resolve)),
    run: async (payload, token) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/local-runner/teach`, {
        method: 'POST',
        headers: { ...headers, ...(token ? { 'X-Tutor-Runner-Token': token } : {}) },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      return { status: response.status, text, events: text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
    },
    token: async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/local-runner/session`, { method: 'POST', headers, body: '{}' });
      return (await response.json()).token;
    },
  };
}

test('缺少令牌与非法请求体都被拒绝，且不会开流', async () => {
  const app = await setup();
  try {
    const token = await app.token();
    assert.equal((await app.run({ problem: PROBLEM, action: 'plan' })).status, 403);
    assert.equal((await app.run({ problem: PROBLEM, action: 'plan' }, 'x'.repeat(43))).status, 403);
    const bad = await app.run({ problem: PROBLEM, action: 'quiz' }, token);
    assert.equal(bad.status, 400);
    assert.match(JSON.parse(bad.text).error.message, /未知的教学动作/);
    assert.equal((await app.run({ problem: { statement: '' }, action: 'plan' }, token)).status, 400);
    assert.equal((await app.run({ problem: PROBLEM, action: 'hint', level: 9 }, token)).status, 400);
  } finally { await app.close(); }
});

test('脚本化会话：标注为 scripted，plan 给出步骤', async () => {
  const app = await setup();
  try {
    const token = await app.token();
    const result = await app.run({ problem: PROBLEM, action: 'plan', mode: 'guide' }, token);
    assert.equal(result.status, 200);
    const meta = result.events[0];
    assert.equal(meta.type, 'meta');
    assert.equal(meta.kind, 'scripted');
    assert.ok(/^[a-f0-9]{16}$/.test(meta.sessionId));
    const plan = result.events.find(event => event.type === 'plan');
    assert.ok(plan.steps.length >= 3);
    assert.equal(result.events.at(-1).type, 'done');
  } finally { await app.close(); }
});

test('打断：答疑结束后回到被打断的那一步', async () => {
  const app = await setup();
  try {
    const token = await app.token();
    const planned = await app.run({ problem: PROBLEM, action: 'plan' }, token);
    const sessionId = planned.events[0].sessionId;

    const taught = await app.run({ problem: PROBLEM, action: 'teach', step: 2, sessionId }, token);
    const teachResume = taught.events.find(event => event.type === 'resume');
    assert.equal(teachResume.index, 2);
    assert.ok(taught.events.some(event => event.type === 'delta'));
    assert.ok(taught.events.some(event => event.type === 'ask'), '引导模式讲完要反问');

    const answered = await app.run({ problem: PROBLEM, action: 'answer', step: 2, question: '为什么用哈希表？', sessionId }, token);
    const answerEvents = answered.events.filter(event => event.type === 'answer_delta').map(event => event.text).join('');
    assert.match(answerEvents, /哈希/);
    const resume = answered.events.find(event => event.type === 'resume');
    assert.equal(resume.index, 2, '答疑后必须停在原步骤');
    assert.equal(resume.interrupted, true);
  } finally { await app.close(); }
});

test('引导模式下模型泄漏完整解法会被如实标注', async () => {
  const app = await setup(() => async () => ({ content: 'function solve(input) { return [0,1]; }' }));
  try {
    const token = await app.token();
    const planned = await app.run({ problem: PROBLEM, action: 'plan', mode: 'guide' }, token);
    const sessionId = planned.events[0].sessionId;
    const taught = await app.run({ problem: PROBLEM, action: 'teach', mode: 'guide', step: 0, sessionId }, token);
    assert.equal(taught.events[0].kind, 'live');
    assert.ok(taught.events.some(event => event.type === 'notice'), '越界给出完整实现要发 notice');
  } finally { await app.close(); }
});

test('没有密钥又不是内置题目：明确报错而不是假装会讲', async () => {
  const app = await setup();
  try {
    const token = await app.token();
    const result = await app.run({ problem: { title: '最长回文子串', statement: '给你一个字符串 s，找到 s 中最长的回文子串。' }, action: 'plan' }, token);
    // Same shape as the agent endpoint: the stream opens, then reports the error.
    const failure = result.events.find(event => event.type === 'error');
    assert.ok(failure, '应当给出错误事件');
    assert.match(failure.message, /内置脚本化演示/);
    assert.equal(result.events.at(-1).type, 'done');
  } finally { await app.close(); }
});
