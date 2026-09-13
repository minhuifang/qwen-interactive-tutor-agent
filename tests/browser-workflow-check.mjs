// Explicit browser acceptance: mocked model output + real local Docker verification.
// TUTOR_LIVE_SOLUTION=1 permits exactly one real solution-generation request at the end.
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT + '/package.json');
const { chromium } = require('playwright');
const output = await mkdtemp(join(tmpdir(), 'tutor-browser-'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const mark = name => { checks.push(name); console.log(JSON.stringify({ check: name })); };
const problemText = '题目：合并区间。给定整数数组 intervals，每一项 [start,end] 表示闭区间。合并所有重叠区间，端点相同也视为重叠。返回按起点升序排列、互不重叠且覆盖原区间集合的二维整数数组。不要求原地修改输入。样例输入：intervals = [[1,3],[2,6],[8,10]]，样例输出：[[1,6],[8,10]]。约束：1 <= intervals.length <= 1000；每个元素恰好包含两个整数；0 <= start <= end <= 10000。';
const normalCode = 'function solve(input) { const a = input.map(x => x.slice()).sort((a,b) => a[0]-b[0]); const out=[]; for(const cur of a) { const last=out[out.length-1]; if(last && cur[0]<=last[1]) last[1]=Math.max(last[1],cur[1]); else out.push(cur); } return out; }';
const fixture = { solution: { approach: '先排序，再合并重叠闭区间。', steps: ['按起点排序', '逐个合并或追加'], assumptions: [], timeComplexity: 'O(n log n)', spaceComplexity: 'O(n)', language: 'javascript', entrypoint: 'solve', inputContract: 'input 直接为二维整数数组 intervals。', code: normalCode, cautions: [] }, model: 'UI acceptance fixture (not a model call)', usage: null, verification: { status: 'not_run', reason: 'Not run' } };
let generateMode = 'success', verifyUnavailable = false, liveCalls = 0, liveResult = null;
await page.route('**/api/problems/parse', route => route.fulfill({ status: 503, json: { error: { message: '本轮不调用题目解析模型。' } } }));
await page.route('**/api/solutions/generate', async route => {
  if (generateMode === 'live') {
    assert.equal(liveCalls, 0, 'Only one real model request is permitted'); liveCalls++;
    return route.continue();
  }
  if (generateMode === 'failure') return route.fulfill({ status: 502, json: { error: { message: '模拟生成失败，旧解法保留。' } } });
  return route.fulfill({ status: 200, json: { ...fixture, solution: { ...fixture.solution, code: generateMode === 'timeout' ? 'function solve() { while(true) {} }' : normalCode } } });
});
await page.route('**/api/local-runner/verify', route => verifyUnavailable ? route.fulfill({ status: 503, json: { error: { message: '模拟：本地执行器不可用，请启动 tutor-sandbox。' } } }) : route.continue());

const review = () => page.getByRole('region', { name: '核对解析草稿', exact: true });
const panel = () => page.getByRole('region', { name: '本地运行验证', exact: true });
const confirm = () => page.getByRole('button', { name: '确认题意', exact: true });
async function generate() {
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/solutions/generate') && r.request().method() === 'POST', { timeout: 60000 });
  await page.getByRole('button', { name: /^(生成解法|重新生成解法)（消耗额度）$/ }).click();
  const response = await responsePromise;
  return { status: response.status(), body: await response.json() };
}
async function run(expectedStatus) {
  await panel().getByRole('checkbox').check();
  const waiting = page.waitForResponse(r => r.url().endsWith('/api/local-runner/verify'), { timeout: 25000 });
  await panel().getByRole('button', { name: '运行这些样例', exact: true }).click();
  const response = await waiting;
  const result = await response.json();
  assert.equal(response.status(), 200);
  assert.equal(result.results[0].status, expectedStatus);
  await panel().getByText(expectedStatus === 'passed' ? '已通过本次全部样例' : '本次未全部通过', { exact: true }).waitFor();
  return result;
}
try {
  console.log(JSON.stringify({ artifacts: output }));
  await page.goto('http://localhost:3001/');
  await page.waitForFunction(() => document.querySelector('.generation-status')?.textContent?.includes('服务端模型：'));
  await page.getByRole('textbox', { name: '题目原文', exact: true }).fill(problemText);
  await page.getByRole('button', { name: '手动整理', exact: true }).click();
  await review().getByLabel('题目标题', { exact: true }).fill('合并区间');
  await review().getByLabel('输入数据与类型', { exact: true }).fill('二维整数数组 intervals，每项为 [start,end]');
  await review().getByLabel('期望输出', { exact: true }).fill('按起点升序排列的合并后二维整数数组');
  await review().getByLabel('约束与边界（每行一条，未提供可留空）').fill('1 <= intervals.length <= 1000\n0 <= start <= end <= 10000');
  await review().getByRole('button', { name: '添加样例', exact: true }).click();
  await review().getByLabel('样例 1 输入', { exact: true }).fill('intervals = [[1,3],[2,6],[8,10]]');
  await review().getByLabel('样例 1 输出', { exact: true }).fill('[[1,6],[8,10]]');
  assert.equal(await confirm().isDisabled(), true);
  await review().getByRole('checkbox').check(); await confirm().click();
  await page.getByRole('heading', { name: '03 / 生成解法草稿', exact: true }).waitFor();
  assert.equal((await generate()).status, 200);
  await panel().waitFor();
  assert.equal(await panel().getByRole('button', { name: '运行这些样例', exact: true }).isDisabled(), true);
  await panel().getByText(/输入与预期输出须是合法 JSON/).waitFor();
  await panel().getByLabel('样例 1 · JSON 输入', { exact: true }).fill('[[1,3],[2,6],[8,10]]');
  assert.equal(await panel().getByRole('button', { name: '运行这些样例', exact: true }).isDisabled(), true);
  mark('人工题意确认、输入格式校验、运行确认门槛');
  await run('passed');
  await panel().screenshot({ path: join(output, 'verification-desktop.png') });
  mark('真实浏览器 → 会话令牌 → Docker，合并区间样例通过');

  await panel().getByLabel('预期输出', { exact: true }).fill('[[1,7],[8,10]]');
  assert.equal(await panel().getByText('已通过本次全部样例', { exact: true }).count(), 0);
  assert.equal(await panel().getByRole('checkbox').isChecked(), false);
  await run('failed');
  await panel().getByText('样例 1：答案不符', { exact: true }).waitFor();
  mark('修改测试撤销旧结果、错误预期显示不符');

  await panel().getByLabel('预期输出', { exact: true }).fill('[[1,6],[8,10]]');
  await panel().getByRole('checkbox').check();
  verifyUnavailable = true;
  await panel().getByRole('button', { name: '运行这些样例', exact: true }).click();
  await panel().getByText('模拟：本地执行器不可用，请启动 tutor-sandbox。', { exact: true }).waitFor();
  assert.equal(await panel().getByLabel('样例 1 · JSON 输入', { exact: true }).inputValue(), '[[1,3],[2,6],[8,10]]');
  verifyUnavailable = false;
  mark('模拟执行器不可用：错误提示与测试数据保留');

  generateMode = 'failure';
  assert.equal((await generate()).status, 502);
  await page.getByText('模拟生成失败，旧解法保留。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: '生成解法', exact: true }).locator('code').textContent(), normalCode);
  await panel().waitFor();
  assert.equal(await panel().getByRole('checkbox').isChecked(), false);
  mark('模拟模型失败：旧代码保留、旧验证撤销');

  generateMode = 'timeout'; await generate(); await panel().waitFor();
  await panel().getByLabel('样例 1 · JSON 输入', { exact: true }).fill('[[1,3],[2,6],[8,10]]');
  await run('timeout');
  await panel().getByText('样例 1：超时，已终止', { exact: true }).waitFor();
  mark('真实死循环超时与页面反馈');

  await page.setViewportSize({ width: 390, height: 844 });
  await panel().screenshot({ path: join(output, 'verification-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page-wide horizontal overflow on mobile');
  await page.setViewportSize({ width: 1280, height: 900 });
  mark('390px移动端无页面横向溢出');

  await review().getByLabel('题目标题', { exact: true }).fill('合并区间（复核）');
  assert.equal(await page.getByRole('region', { name: '生成解法', exact: true }).count(), 0);
  assert.equal(await review().getByRole('checkbox').isChecked(), false);
  await review().getByRole('checkbox').check(); await confirm().click();
  mark('修改题意卸载解法与验证并撤销确认');

  if (process.env.TUTOR_LIVE_SOLUTION === '1') {
    generateMode = 'live'; liveResult = await generate();
    await writeFile(join(output, 'live-solution.json'), JSON.stringify(liveResult, null, 2));
    console.log(JSON.stringify({ liveSolution: { status: liveResult.status, error: liveResult.body.error, usage: liveResult.body.usage, artifact: join(output, 'live-solution.json') } }));
    if (liveResult.status === 200) { await panel().waitFor(); mark('合并区间真实解法生成及页面展示'); }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'summary.json'), JSON.stringify({ checks, errors, liveCalls, liveStatus: liveResult?.status }, null, 2));
  console.log(JSON.stringify({ completed: true, checks, errors, liveCalls, artifacts: output }));
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ failed: true, checks, errors, liveCalls, artifacts: output }));
  throw error;
} finally { await browser.close(); }
