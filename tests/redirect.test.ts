import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonGenerator, GenerationError } from '../apps/web/lib/server/generate-lesson.ts';
import { createProblemParser } from '../apps/web/lib/server/parse-problem.ts';

test('两条模型调用使用 Worker 兼容的 manual，拒绝重定向且不重试', async () => {
  for (const kind of ['lesson', 'problem']) {
    let calls = 0;
    const fetcher: typeof fetch = async (_url, options) => {
      calls++;
      // Reproduce the actual Worker restriction that Node fetch mocks previously missed.
      assert.equal(options?.redirect, 'manual');
      return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } });
    };
    const run = kind === 'lesson' ? createLessonGenerator(fetcher) : createProblemParser(fetcher);
    const input = kind === 'lesson' ? { lessonId: 'two-sum', style: 'beginner' } : { text: '给定一个只包含括号的字符串，请判断它是否由成对的合法括号组成，返回布尔值。' };
    await assert.rejects(run(input, { DEEPSEEK_API_KEY: 'fake-test-key' }), error => error instanceof GenerationError && error.code === 'MODEL_REDIRECT');
    assert.equal(calls, 1);
  }
});
