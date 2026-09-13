// Explicit opt-in acceptance test: makes exactly two real parsing requests.
// Not part of pnpm test. Requires configured local server and authorized model quota.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT + '/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const fullText = '题目：合并区间。给定整数数组 intervals，每一项 [start,end] 表示闭区间。合并所有重叠区间，端点相同也视为重叠。返回按起点升序排列、互不重叠且覆盖原区间集合的二维整数数组。不要求原地修改输入。样例输入：intervals = [[1,3],[2,6],[8,10]]，样例输出：[[1,6],[8,10]]。约束：1 <= intervals.length <= 1000；每个元素恰好包含两个整数；0 <= start <= end <= 10000。';
const incompleteText = '给定一组区间，将可以合并的区间合并。返回处理后的结果。具体输入格式、合并规则和数据范围尚未提供。';
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3001/');
  await page.waitForFunction(() => document.querySelector('.generation-status')?.textContent?.includes('服务端模型：'), null, { timeout: 15000 });
  const original = page.getByRole('textbox', { name: '题目原文', exact: true });
  const parseButton = page.getByRole('button', { name: '用 AI 解析题目', exact: true });
  const confirm = page.getByRole('button', { name: '确认题意', exact: true });
  const checkbox = page.getByRole('checkbox');
  const results = [];
  async function parseText(text) {
    await original.fill(text);
    const wait = page.waitForResponse(r => r.url().endsWith('/api/problems/parse') && r.request().method() === 'POST', { timeout: 60000 });
    await parseButton.click();
    const response = await wait;
    const value = await response.json();
    console.log(JSON.stringify({ phase: 'parse-response', status: response.status(), result: value }));
    assert.equal(response.status(), 200);
    results.push(value);
    await page.getByLabel('题目标题', { exact: true }).waitFor();
    return value;
  }
  const full = await parseText(fullText);
  assert.equal(full.draft.missingInformation.length, 0, 'Complete question should not need clarification');
  assert.equal(await confirm.isDisabled(), true, 'Human acknowledgement required');
  await checkbox.check();
  await confirm.click();
  await page.getByText('题意已确认', { exact: true }).waitFor();
  let confirmed = JSON.parse(await page.locator('.intake-confirmed pre').textContent());
  assert.equal(confirmed.source, 'qwen');
  assert.equal(confirmed.originalText, fullText);
  assert.equal(confirmed.problem.title, full.draft.title);
  assert.equal('solution' in confirmed, false);
  await page.getByLabel('题目标题', { exact: true }).fill('合并区间（已人工核对）');
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(await page.locator('.intake-confirmed').count(), 0);
  await page.getByLabel('期望输出', { exact: true }).fill('');
  await checkbox.check();
  assert.equal(await confirm.isDisabled(), true, 'Empty output must block confirmation even when acknowledged');
  await page.getByLabel('期望输出', { exact: true }).fill(full.draft.outputDescription);
  await checkbox.check(); await confirm.click();
  await page.getByText('题意已确认', { exact: true }).waitFor();
  const partial = await parseText(incompleteText);
  assert.ok(partial.draft.missingInformation.length > 0);
  assert.equal(await page.locator('.intake-confirmed').count(), 0);
  await checkbox.check();
  assert.equal(await confirm.isDisabled(), true, 'Unresolved questions must block confirmation');
  // Simulate failure, without another provider request; preserve original and existing draft.
  await page.route('**/api/problems/parse', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_FAILURE', message: '模拟解析失败，保留原文和草稿。' } }) }));
  await parseButton.click();
  await page.getByText('模拟解析失败，保留原文和草稿。', { exact: true }).waitFor();
  assert.equal(await original.inputValue(), incompleteText);
  assert.equal(await page.getByLabel('题目标题', { exact: true }).inputValue(), partial.draft.title);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks: ['真实新题解析', '人工确认和原文保留', '编辑撤销确认', '空输出禁止确认', '缺失信息禁止确认', '模拟失败保留原文草稿', '无页面运行时异常'], calls: results.length, usage: results.map(r => r.usage), totalTokens: results.reduce((sum,r) => sum + (r.usage?.total_tokens || 0),0) }));
} finally { await browser.close(); }
