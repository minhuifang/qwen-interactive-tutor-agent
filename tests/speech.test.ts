import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechService } from '../apps/web/lib/server/speech.ts';
const env = { DASHSCOPE_API_KEY: 'test-only-secret' };
const request = (text = '初始化哈希表。', origin = 'http://localhost:3001') => new Request('http://localhost:3001/api/speech', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
test('TTS 请求、官方音频、缓存与并发合并', async () => {
  let calls = 0;
  const service = createSpeechService(async (url, init) => {
    calls++;
    assert.match(String(url), /^https:\/\/dashscope.aliyuncs.com\//);
    assert.equal(init?.redirect, 'manual');
    assert.equal(JSON.parse(String(init?.body)).model, 'qwen3-tts-flash');
    return Response.json({ output: { audio: { url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav', expires_at: Date.now() / 1000 + 3600 } } });
  });
  const results = await Promise.all([service(request(), env), service(request(), env)]);
  assert.ok(results.every(r => r.status === 200));
  assert.match((await results[0].json()).url, /^https:/);
  assert.equal((await (await service(request(), env)).json()).cached, true);
  assert.equal(calls, 1);
});
test('拒绝跨来源、长文本和未配置密钥，不调用上游', async () => {
  const service = createSpeechService(async () => { throw new Error('must not call'); });
  assert.equal((await service(request('测试', 'https://evil.example'), env)).status, 403);
  assert.equal((await service(request('字'.repeat(581)), env)).status, 400);
  assert.equal((await service(request(), {})).status, 503);
});
test('TTS 故障脱敏，拒绝任意音频地址', async () => {
  for (const reply of [new Response('test-only-secret', { status: 401 }), Response.json({ output: { audio: { url: 'https://evil.example/audio.wav' } } })]) {
    const service = createSpeechService(async () => reply);
    const response = await service(request(), env);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /test-only-secret|evil.example/);
  }
});
