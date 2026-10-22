// Records the demo trace used by the UI replay mode and the static page.
//
// It runs the *real* loop with a scripted policy and a simulated executor, so
// the event stream is produced by production code paths — but the model is
// scripted and the execution results are declared, not measured. That is why
// the trace carries mode:"scripted" and sandbox:"simulated" and the UI shows a
// badge. Never present this file as a real model run.
//
//   node packages/agent/record-demo.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { runAgent } from './loop.mjs';
import { createScriptedModel, createSimulatedRunner } from './scripted.mjs';

const problem = {
  title: '两数之和',
  statement: '给定一个整数数组 nums 和一个整数目标值 target，请你在该数组中找出和为目标值 target 的两个整数，并返回它们的数组下标。你可以假设每种输入只会对应一个答案，且不能重复使用同一个元素。',
  inputContract: 'input = { nums: number[], target: number }，返回 [i, j]（i < j）。',
};

const cases = [
  { input: { nums: [2, 7, 11, 15], target: 9 }, expected: [0, 1] },
  { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
  { input: { nums: [3, 3], target: 6 }, expected: [0, 1] },
];

const v1 = `function solve(input) {
  const { nums, target } = input;
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [need, nums[i]];
    seen.set(nums[i], i);
  }
  return [];
}`;

const v2 = `function solve(input) {
  const { nums, target } = input;
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return [];
}`;

const v3 = `function solve(input) {
  const { nums, target } = input;
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) {
      const j = seen.get(need);
      return j < i ? [j, i] : [i, j];
    }
    seen.set(nums[i], i);
  }
  return [];
}`;

const model = createScriptedModel([
  {
    thought: '用哈希表把查找降到 O(1)。边遍历边记录「值 → 下标」，遇到 target - nums[i] 就返回。',
    calls: [{
      name: 'run_tests',
      arguments: {
        code: v1,
        note: '第一版：单遍哈希表，边存边查',
      },
    }],
  },
  {
    thought: '三例全部返回了数值本身，不是下标。第 1 例期望 [0,1]，实际是 [2,7]——返回值取错了，应该返回 seen.get(need) 和当前下标 i。',
    calls: [{
      name: 'run_tests',
      arguments: {
        code: v2,
        note: '改为返回下标',
      },
    }],
  },
  {
    thought: '第 1、2 例通了，第 3 例 [3,3] 期望 [0,1] 却返回 [0,0]。原因是当前写法恰好把「同一个元素用两次」也算成了答案：i=0 时先写入 seen，i=1 查到的是自己刚写的。要保证两个下标不同，并且按 i < j 输出。',
    calls: [{
      name: 'run_tests',
      arguments: {
        code: v3,
        note: '保证两个下标不同，并按 i < j 排序',
      },
    }],
  },
  {
    thought: '三例全部通过，提交。',
    calls: [{
      name: 'finish',
      arguments: {
        code: v3,
        approach: '单遍哈希表：遍历数组时，对每个元素先算「还差多少」（need = target - nums[i]），再去表里查这个差值是否出现过。出现过就说明找到了一对，直接返回两个下标；没出现过就把当前值和下标存进表，供后面的元素查。每个元素只进出哈希表一次，所以是线性的。',
        steps: [
          '输入 nums = [2,7,11,15]，target = 9，建空表 seen。',
          'i = 0，nums[0] = 2，need = 7。表里没有 7，把 2 → 0 存进 seen。',
          'i = 1，nums[1] = 7，need = 2。表里有 2，下标是 0，返回 [0, 1]。',
          '再验证重复元素：[3,3]、target = 6。i = 0 存 3 → 0；i = 1 时 need = 3 命中，得到 0，输出前比较大小保证 i < j，返回 [0, 1]。',
          '如果始终没命中，说明无解，返回空数组。',
        ],
        assumptions: ['题目保证最多一个答案，因此找到第一对即可返回。'],
        timeComplexity: 'O(n)：每个元素最多被访问一次，哈希表查找与插入均摊 O(1)。',
        spaceComplexity: 'O(n)：最坏情况下要把 n 个元素全部存进哈希表。',
        cautions: [
          '返回值是下标而不是数值，这是本题最容易写错的地方。',
          '相同元素不能重复使用，因此必须先查表再存表，且返回前保证两个下标不同。',
          '以上结论只覆盖 3 组已确认样例，不代表所有输入都正确。',
        ],
      },
    }],
  },
]);

const runner = createSimulatedRunner([
  {
    status: 'not_passed',
    results: [
      { status: 'failed', actual: [2, 7] },
      { status: 'failed', actual: [2, 4] },
      { status: 'failed', actual: [3, 3] },
    ],
  },
  {
    status: 'not_passed',
    results: [
      { status: 'passed', actual: [0, 1] },
      { status: 'passed', actual: [1, 2] },
      { status: 'failed', actual: [0, 0] },
    ],
  },
  {
    status: 'examples_passed',
    results: [
      { status: 'passed', actual: [0, 1] },
      { status: 'passed', actual: [1, 2] },
      { status: 'passed', actual: [0, 1] },
    ],
  },
]);

const events = [];
const result = await runAgent({
  problem, cases, callModel: model, runTests: runner,
  emit: event => events.push(event),
  model: 'scripted-policy', mode: 'scripted', maxRounds: 4, runId: 'demo-two-sum',
});

// Mark the trace so no reader can mistake it for a measured run.
events[0] = { ...events[0], sandbox: 'simulated', note: '脚本化策略 + 模拟执行结果，用于演示轨迹界面，不是真实模型运行。' };
const payload = { recordedAt: '2026-10-22', problem, cases, result: { status: result.status, rounds: result.rounds }, events };

mkdirSync(new URL('../../apps/web/public/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../apps/web/public/agent-demo.json', import.meta.url), JSON.stringify(payload, null, 2));
mkdirSync(new URL('../../docs/demo/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../docs/demo/agent-demo.json', import.meta.url), JSON.stringify(payload, null, 2));
console.log(`recorded ${events.length} events, final status = ${result.status}`);
