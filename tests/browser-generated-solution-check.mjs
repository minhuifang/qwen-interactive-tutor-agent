// Replays a reviewed real model response in a fresh test browser. No model requests.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT + '/package.json');
const { chromium } = require('playwright');
const captured = JSON.parse(await readFile(process.env.TUTOR_REVIEWED_SOLUTION, 'utf8'));
assert.equal(captured.status, 200);
assert.equal(captured.body.solution.entrypoint, 'solve');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/solutions/generate', route => route.fulfill({ status: 200, json: captured.body }));
  await page.route('**/api/problems/parse', route => route.abort());
  await page.goto('http://localhost:3001/');
  await page.waitForFunction(() => document.querySelector('.generation-status')?.textContent?.includes('服务端模型：'));
  await page.getByLabel('题目原文', { exact: true }).fill('合并重叠闭区间，端点相接也合并，返回按起点升序排列的区间数组。1到1000个区间，0<=start<=end<=10000。');
  await page.getByRole('button', { name: '手动整理', exact: true }).click();
  const review = page.getByRole('region', { name: '核对解析草稿', exact: true });
  await review.getByLabel('题目标题', { exact: true }).fill('合并区间（已生成结果复用验收）');
  await review.getByLabel('输入数据与类型', { exact: true }).fill('二维整数区间数组');
  await review.getByLabel('期望输出', { exact: true }).fill('按起点升序排列的合并结果');
  await review.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认题意', exact: true }).click();
  await page.getByRole('button', { name: '生成解法（消耗额度）', exact: true }).click();
  const panel = page.getByRole('region', { name: '本地运行验证', exact: true });
  await panel.waitFor();
  const cases = [
    { input: { intervals: [[1,3],[2,6],[8,10]] }, expected: [[1,6],[8,10]] },
    { input: { intervals: [[1,2],[2,3]] }, expected: [[1,3]] },
    { input: { intervals: [[8,10],[2,5],[1,10]] }, expected: [[1,10]] },
    { input: { intervals: [[0,0]] }, expected: [[0,0]] },
  ];
  for (let i = 0; i < cases.length; i++) {
    if (i) await panel.getByRole('button', { name: '添加测试样例', exact: true }).click();
    await panel.getByLabel(`样例 ${i + 1} · JSON 输入`, { exact: true }).fill(JSON.stringify(cases[i].input));
    await panel.getByLabel('预期输出', { exact: true }).nth(i).fill(JSON.stringify(cases[i].expected));
  }
  await panel.getByRole('checkbox').check();
  const waiting = page.waitForResponse(r => r.url().endsWith('/api/local-runner/verify'), { timeout: 30000 });
  await panel.getByRole('button', { name: '运行这些样例', exact: true }).click();
  const response = await waiting;
  assert.equal(response.status(), 200);
  const report = await response.json();
  assert.deepEqual(report.results.map(r => r.status), ['passed', 'passed', 'passed', 'passed']);
  await panel.getByText('已通过本次全部样例', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ reviewedRealCode: true, modelCalls: 0, report, pageErrors: errors }));
} finally { await browser.close(); }
