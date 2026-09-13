import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamingTeacher } from '../apps/web/lib/server/stream-teacher.ts';
import { consumeTeaching, sseData, type TeachingEvent } from '../apps/web/lib/teaching-stream.ts';
const original = '给你一个整数数组 nums ，判断是否存在三元组 [nums[i], nums[j], nums[k]] 满足 i != j、i != k 且 j != k ，同时还满足 nums[i] + nums[j] + nums[k] == 0 。请你返回所有和为 0 且不重复的三元组。\n\n注意：答案中不可以包含重复的三元组。';
const env = { DEEPSEEK_API_KEY: 'secret-not-real' };
const req = (text = original, origin = 'http://localhost:3001', extra = {}) => new Request('http://localhost:3001/api/teach', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...extra }) });
const enc = new TextEncoder();
const frame = (text: string, finish: string | null = null) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] }) + '\r\n\r\n';
const end = 'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\ndata: [DONE]\n\n';
test('三数之和原文直接进入一次流式教学，没有解析与格式门槛，首段早于结束', async () => {
  let calls = 0, upstream!: ReadableStreamDefaultController<Uint8Array>;
  const teacher = createStreamingTeacher(async (_url, opts) => {
    calls++; const body = JSON.parse(String(opts?.body));
    assert.equal(body.stream, true); assert.equal(body.response_format, undefined);
    assert.equal(body.messages[1].content, original); assert.equal(body.messages.length, 2);
    assert.equal(opts?.redirect, 'manual');
    return new Response(new ReadableStream({ start(c) { upstream = c; c.enqueue(enc.encode(frame('先排序，再固定一个数。'))); } }));
  });
  const response = await teacher(req(), env);
  assert.equal(response.status, 200);
  let partial!: () => void; const gotPartial = new Promise<void>(r => { partial = r; });
  const events: TeachingEvent[] = [];
  const consuming = consumeTeaching(response.body!, e => { events.push(e); if (e.type === 'delta') partial(); });
  await gotPartial;
  assert.ok(!events.some(e => e.type === 'done'));
  assert.equal((await teacher(req(), env)).status, 429);
  upstream.enqueue(enc.encode(frame('使用双指针并跳过重复值。', 'stop') + end)); upstream.close();
  await consuming;
  assert.equal(calls, 1); assert.equal(events.at(-1)?.type, 'done');
});
test('SSE 支持逐字节 UTF-8、CRLF、注释、多行 data', async () => {
  const bytes = enc.encode(':ping\r\ndata: 中文\r\ndata: 第二行\r\n\r\n');
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
  const data: string[] = []; for await (const value of sseData(body)) data.push(value);
  assert.deepEqual(data, ['中文\n第二行']);
});
test('输出截断/断流保留文本，不能宣称完整，也不自动重试', async () => {
  for (const finish of ['length', null]) {
    let calls = 0; const seen: string[] = [];
    const teacher = createStreamingTeacher(async () => { calls++; return new Response(frame('已经讲到这里。', finish)); });
    const response = await teacher(req(), env);
    await assert.rejects(consumeTeaching(response.body!, e => { if (e.type === 'delta') seen.push(e.text); }), /未完整结束/);
    assert.deepEqual(seen, ['已经讲到这里。']); assert.equal(calls, 1);
  }
});
test('非空短题可以讲，空输入和跨来源拒绝；错误不反射供应商秘密', async () => {
  let calls = 0;
  const teacher = createStreamingTeacher(async () => { calls++; return new Response('secret-not-real', { status: 401 }); });
  assert.equal((await teacher(req(''), env)).status, 400);
  assert.equal((await teacher(req(original, 'https://evil.test'), env)).status, 403);
  assert.equal(calls, 0);
  const response = await teacher(req('讲讲三数之和'), env);
  assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /secret-not-real/);
});
test('追问携带原题与先前讲解，仍是一次调用；取消向上游传播', async () => {
  let signal: AbortSignal | null | undefined;
  const teacher = createStreamingTeacher(async (_url, opts) => {
    signal = opts?.signal;
    const body = JSON.parse(String(opts?.body));
    assert.equal(body.messages[1].content, original);
    assert.equal(body.messages[2].content, '先排序。'); assert.equal(body.messages[3].content, '为什么要排序？');
    return new Response(new ReadableStream({ start(c) { opts?.signal?.addEventListener('abort', () => c.error(new Error('aborted'))); } }));
  });
  const response = await teacher(req(original, undefined, { previous: '先排序。', followUp: '为什么要排序？' }), env);
  await response.body!.cancel(); assert.equal(signal?.aborted, true);
});
test('失败请求计入12次上限，超时保留错误事件并释放锁', async () => {
  const limited = createStreamingTeacher(async () => new Response('secret', { status: 500 }));
  for (let i=0;i<12;i++) assert.equal((await limited(req(), env)).status, 502);
  assert.equal((await limited(req(), env)).status, 429);
  const timed = createStreamingTeacher(async (_url, opts) => new Response(new ReadableStream({ start(c) { opts?.signal?.addEventListener('abort', () => c.error(new Error('secret'))); } })), Date.now, 10);
  for (let i=0;i<2;i++) { const response = await timed(req(), env); await assert.rejects(consumeTeaching(response.body!, () => {}), /超时/); }
});
