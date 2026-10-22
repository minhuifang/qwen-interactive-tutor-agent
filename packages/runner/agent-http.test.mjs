// HTTP-level tests for the agent endpoint: token gate, validation, streaming
// framing, serialization and the "verdict comes from the executor" invariant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRunnerMiddleware } from './http-middleware.mjs';
import { createScriptedModel } from '../agent/scripted.mjs';

const body = {
  problem: { title: '两数之和', statement: '返回两个下标。', inputContract: 'input = { nums, target }' },
  cases: [{ input: { nums: [2, 7], target: 9 }, expected: [0, 1] }],
};

/** The host allow-list is keyed to localhost:3001 in production, so tests inject an empty set and fill it after listen. */
async function setup(run, modelFactory) {
  const hosts = new Set();
  const middleware = createRunnerMiddleware(run, Date.now, { modelFactory, hosts });
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  hosts.add(`127.0.0.1:${port}`);
  return {
    port,
    close: () => new Promise(resolve => server.close(resolve)),
    session: async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/local-runner/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tutor-Local': '1', Origin: `http://127.0.0.1:${port}` },
        body: '{}',
      });
      return (await response.json()).token;
    },
    post: async (path, { token, payload, origin } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tutor-Local': '1',
          Origin: origin ?? `http://127.0.0.1:${port}`,
          ...(token ? { 'X-Tutor-Runner-Token': token } : {}),
        },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
      });
      return { status: response.status, headers: response.headers, text: await response.text() };
    },
  };
}

const events = text => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const ok = { status: 'examples_passed', results: [{ status: 'passed', actual: [0, 1] }] };

test('缺少令牌、伪造令牌与跨来源请求都被拒绝', async () => {
  const app = await setup(async () => ok, () => createScriptedModel([{ calls: [] }]));
  try {
    assert.equal((await app.post('/api/local-runner/agent', { payload: body })).status, 403);
    assert.equal((await app.post('/api/local-runner/agent', { payload: body, token: 'x'.repeat(43) })).status, 403);
    assert.equal((await app.post('/api/local-runner/agent', { payload: body, token: 'x'.repeat(43), origin: 'http://evil.example' })).status, 403);
  } finally { await app.close(); }
});

test('非法请求体在开流之前返回 JSON 错误', async () => {
  const app = await setup(async () => ok, () => createScriptedModel([{ calls: [] }]));
  try {
    const token = await app.session();
    const empty = await app.post('/api/local-runner/agent', { token, payload: { problem: { statement: '' }, cases: [] } });
    assert.equal(empty.status, 400);
    assert.match(JSON.parse(empty.text).error.message, /题目/);
    const tooMany = await app.post('/api/local-runner/agent', { token, payload: { ...body, maxRounds: 99 } });
    assert.equal(tooMany.status, 400);
    const extra = await app.post('/api/local-runner/agent', { token, payload: { ...body, surprise: 1 } });
    assert.equal(extra.status, 400);
  } finally { await app.close(); }
});

test('成功运行：NDJSON 逐行事件，acknowledged 由服务端补上', async () => {
  const seen = [];
  const app = await setup(async job => { seen.push(job); return ok; }, () => createScriptedModel([
    { thought: '先跑一版，看真实结果。', calls: [{ name: 'run_tests', arguments: { code: 'function solve(){return [0,1]}' } }] },
    { calls: [{ name: 'finish', arguments: { code: 'function solve(){return [0,1]}', approach: '枚举', steps: ['遍历'], timeComplexity: 'O(n^2)', spaceComplexity: 'O(1)' } }] },
  ]));
  try {
    const token = await app.session();
    const response = await app.post('/api/local-runner/agent', { token, payload: body });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /ndjson/);
    const list = events(response.text);
    assert.equal(list[0].type, 'meta');
    assert.equal(list[0].mode, 'live');
    assert.equal(list.at(-1).type, 'done');
    const final = list.find(event => event.type === 'final');
    assert.equal(final.status, 'examples_passed');
    assert.equal(final.verification.passed, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].acknowledged, true);
    assert.match(seen[0].code, /return \[0,1\]/);
    assert.equal(seen[0].cases.length, 1);
  } finally { await app.close(); }
});

test('执行器判定失败时如实返回，模型自称通过无效', async () => {
  const app = await setup(
    async () => ({ status: 'not_passed', results: [{ status: 'failed', actual: [] }] }),
    () => createScriptedModel([
      { calls: [{ name: 'finish', arguments: { code: 'function solve(){return []}', approach: '直接返回', steps: ['空'], timeComplexity: 'O(1)', spaceComplexity: 'O(1)' } }] },
    ]),
  );
  try {
    const token = await app.session();
    const list = events((await app.post('/api/local-runner/agent', { token, payload: body })).text);
    const final = list.find(event => event.type === 'final');
    assert.equal(final.status, 'not_passed');
    assert.equal(list.some(event => event.type === 'tool_call' && event.auto), true);
  } finally { await app.close(); }
});

test('串行：一次运行未结束时拒绝第二个请求', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = await setup(
    async () => { await gate; return ok; },
    () => createScriptedModel([{ calls: [{ name: 'run_tests', arguments: { code: 'function solve(){return [0,1]}' } }] }]),
  );
  try {
    const token = await app.session();
    const first = app.post('/api/local-runner/agent', { token, payload: body });
    await new Promise(resolve => setTimeout(resolve, 150));
    const second = await app.post('/api/local-runner/agent', { token, payload: body });
    assert.equal(second.status, 429);
    release();
    await first;
  } finally { await app.close(); }
});
