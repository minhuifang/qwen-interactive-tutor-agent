import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createRunnerMiddleware } from '../packages/runner/http-middleware.mjs';

const job = { acknowledged: true, code: 'function solve(input) { return input; }', cases: [{ input: 1, expected: 1 }] };
const report = { status: 'examples_passed', results: [{ status: 'passed', actual: 1 }], notice: 'Only supplied examples' };
function fetchTest(url, options) {
  // Node fetch normalizes Host; raw HTTP is needed to test DNS-rebinding guards.
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: options.method, headers: options.headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end(options.body);
  });
}
async function fixture(t, run = async () => report) {
  const handler = createRunnerMiddleware(run, () => 1);
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/local-runner/`;
  const headers = { Host: 'localhost:3001', Origin: 'http://localhost:3001', 'Content-Type': 'application/json', 'X-Tutor-Local': '1' };
  const session = await fetchTest(base + 'session', { method: 'POST', headers, body: '{}' });
  assert.equal(session.status, 200);
  assert.equal(session.headers.get('cache-control'), 'no-store');
  const token = (await session.json()).token;
  return { request: (body = JSON.stringify(job), extra = {}) => fetchTest(base + 'verify', { method: 'POST', headers: { ...headers, 'X-Tutor-Runner-Token': token, ...extra }, body }), base, headers };
}

test('本地运行 HTTP：来源/Host/会话令牌拦截，拒绝未经核对或超大数据', async t => {
  let runs = 0;
  const { request, base, headers } = await fixture(t, async () => { runs++; return report; });
  assert.equal((await request(undefined, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await request(undefined, { Host: 'evil.test:3001' })).status, 403);
  assert.equal((await request(undefined, { 'X-Tutor-Runner-Token': 'wrong' })).status, 403);
  assert.equal((await request(undefined, { 'X-Tutor-Local': '' })).status, 403);
  assert.equal((await request('{')).status, 400);
  assert.equal((await request(JSON.stringify({ ...job, acknowledged: false }))).status, 400);
  assert.equal((await request('a'.repeat(100001))).status, 413);
  assert.equal((await fetchTest(base + 'session', { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body: '{}' })).status, 403);
  assert.equal(runs, 0);
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), report);
  assert.equal(runs, 1);
});
test('本地运行 HTTP：失败也计入12次上限，不反射异常秘密', async t => {
  let count = 0;
  const { request } = await fixture(t, async () => { count++; throw new Error('secret-path-key'); });
  for (let i = 0; i < 12; i++) {
    const response = await request();
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('secret-path-key'), false);
  }
  assert.equal((await request()).status, 429);
  assert.equal(count, 12);
});
test('本地运行 HTTP：并发拦截，无法确认清理时停止接受作业', async t => {
  let release;
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const { request } = await fixture(t, async () => { started(); return new Promise(resolve => { release = resolve; }); });
  const first = request();
  await began;
  assert.equal((await request()).status, 429);
  release(report);
  assert.equal((await first).status, 200);
  const blocked = await fixture(t, async () => { throw new Error('Cleanup could not be confirmed for private-name'); });
  assert.equal((await blocked.request()).status, 503);
  const response = await blocked.request();
  assert.equal((await response.json()).error.code, 'CLEANUP');
});
