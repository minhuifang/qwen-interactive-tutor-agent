// Explicit live acceptance check. Reuses the already generated server cache.
// Run only after authorizing model use; one POST may call the model if cache expired.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT + '/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:3001/');
  // SSR buttons exist before React hydration; wait for the mounted config effect.
  await page.waitForFunction(() => document.querySelector('.generation-status')?.textContent?.includes('服务端模型：'), null, { timeout: 15000 });
  await page.getByRole('button', { name: '两道示例课件', exact: true }).click();
  const generate = page.getByRole('button', { name: '用 Qwen 生成课件', exact: true });
  console.log(JSON.stringify({ stage: 'before-generate', errors, disabled: await generate.isDisabled() }));
  const waiting = page.waitForResponse(r => r.url().endsWith('/api/lessons/generate') && r.request().method() === 'POST');
  await generate.click();
  const response = await waiting;
  assert.equal(response.status(), 200);
  const result = await response.json();
  assert.equal(result.cached, true, 'Acceptance must reuse existing cache');
  await page.getByText('正在使用 AI 讲解', { exact: true }).waitFor();
  await page.getByRole('heading', { name: result.lesson.frames[0].title, exact: true }).waitFor();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('heading', { name: result.lesson.frames[1].title, exact: true }).waitFor();
  await page.getByRole('textbox', { name: '你的答案', exact: true }).fill('[2,4]');
  await page.getByRole('button', { name: '检验答案' }).click();
  await page.getByText('找到数值了，再找它们的位置', { exact: true }).waitFor();
  await page.getByRole('button', { name: '针对这个误区，再讲一次' }).click();
  await page.getByRole('heading', { name: result.lesson.frames[5].title, exact: true }).waitFor();
  // Inject failure without another model request and ensure current lesson survives.
  await page.route('**/api/lessons/generate', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_FAILURE', message: '验收模拟失败，原课件仍可使用。' } }) })
    : route.continue());
  await generate.click();
  await page.getByText('验收模拟失败，原课件仍可使用。', { exact: true }).waitFor();
  await page.getByRole('heading', { name: result.lesson.frames[5].title, exact: true }).waitFor();
  await page.getByRole('button', { name: '恢复固定课件', exact: true }).click();
  await page.getByRole('heading', { name: '先想：我还缺哪个数？', exact: true }).waitFor();
  await page.getByText('正在使用固定课件', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ model: result.model, cached: result.cached, usage: result.usage, checks: ['真实接口缓存命中', 'AI讲解显示', '步骤切换', '规则判题和补讲定位', '模拟失败保留当前课件', '恢复固定课件', '无浏览器运行时异常'] }));
} finally { await browser.close(); }
