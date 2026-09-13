import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, createLessonGenerator } from '../apps/web/lib/server/generate-lesson.ts';
import { createProblemParser } from '../apps/web/lib/server/parse-problem.ts';
import { createSolutionGenerator } from '../apps/web/lib/server/generate-solution.ts';
import { createStreamingTeacher } from '../apps/web/lib/server/stream-teacher.ts';
test('DeepSeek 固定官方源，绝不回退/混用 TTS 密钥', () => {
  assert.throws(() => readConfig({ DASHSCOPE_API_KEY: 'tts-only' }), /DeepSeek 密钥/);
  assert.equal(readConfig({ DEEPSEEK_API_KEY: 'ds-only', DASHSCOPE_API_KEY: 'tts-only' }).apiKey, 'ds-only');
  assert.equal(readConfig({ DEEPSEEK_API_KEY: 'ds-only', DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1/' }).url, 'https://api.deepseek.com/v1/chat/completions');
  for (const base of ['https://api.deepseek.com.evil.test', 'http://api.deepseek.com', 'https://api.deepseek.com/beta', 'https://api.deepseek.com/?key=x']) {
    assert.throws(() => readConfig({ DEEPSEEK_API_KEY: 'ds-only', DEEPSEEK_BASE_URL: base }));
  }
});
test('四条实际文本入口全部使用 DS 地址、DS Key 与 DS thinking 参数', async () => {
  let calls = 0;
  const fake: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer ds-only');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.enable_thinking, undefined);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(options?.redirect, 'manual');
    return new Response('', { status: 401 });
  };
  const env = { DEEPSEEK_API_KEY: 'ds-only', DASHSCOPE_API_KEY: 'tts-only' };
  await assert.rejects(createLessonGenerator(fake)({ lessonId: 'two-sum', style: 'beginner' }, env));
  await assert.rejects(createProblemParser(fake)({ text: '给定一个整数数组，请返回所有整数的总和，空数组返回零。' }, env));
  await assert.rejects(createSolutionGenerator(fake)({ text: '数组求和' }, env));
  const request = new Request('http://localhost:3001/api/teach', { method: 'POST', headers: { Origin: 'http://localhost:3001', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '三数之和' }) });
  assert.equal((await createStreamingTeacher(fake)(request, env)).status, 502);
  assert.equal(calls, 4);
});
