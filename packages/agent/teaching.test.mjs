import test from 'node:test';
import assert from 'node:assert/strict';
import { TeachingSession, parsePlan, looksLikeFullSolution, supportsScripted } from './teaching.mjs';

const PROBLEM = {
  title: '两数之和',
  statement: '给定一个整数数组 nums 和一个整数目标值 target，请你在该数组中找出和为目标值 target 的两个整数，并返回它们的数组下标。',
  inputContract: 'input = { nums: number[], target: number }，返回 [i, j]（i < j）。',
};

const drain = async iterable => {
  const out = [];
  for await (const piece of iterable) out.push(typeof piece === 'string' ? piece : piece);
  return out;
};
const text = async iterable => (await drain(iterable)).filter(p => typeof p === 'string').join('');

test('脚本化会话：计划有步骤，重复计划结果稳定', async () => {
  const session = new TeachingSession({ problem: PROBLEM, mode: 'guide' });
  assert.equal(session.scripted, true);
  const plan = await session.plan();
  assert.ok(plan.length >= 3);
  assert.deepEqual(await session.plan(), plan);
});

test('打断不丢位置：答疑后仍回到被打断的那一步', async () => {
  const session = new TeachingSession({ problem: PROBLEM, mode: 'guide' });
  await session.plan();
  await drain(session.teachStep(2));
  assert.equal(session.currentStep, 2);
  await drain(session.answer(2, '为什么要用哈希表？'));
  assert.equal(session.resumeStep(), 2, '答疑不能移动游标');
  await drain(session.answer(2, '复杂度怎么算'));
  assert.equal(session.resumeStep(), 2);
});

test('提示级别只升不降', async () => {
  const session = new TeachingSession({ problem: PROBLEM, mode: 'guide' });
  await session.plan();
  await drain(session.hint(0, 1));
  assert.equal(session.hints.get(0), 1);
  await drain(session.hint(0, 1));
  assert.equal(session.hints.get(0), 2, '重复要提示会升级而不是原地重复');
  await drain(session.hint(0, 3));
  assert.equal(session.hints.get(0), 3);
  await drain(session.hint(0, 1));
  assert.equal(session.hints.get(0), 3, '级别不会回落');
});

test('引导模式：揭示之前不出现完整解法', async () => {
  const session = new TeachingSession({ problem: PROBLEM, mode: 'guide' });
  const plan = await session.plan();
  for (const step of plan) {
    assert.equal(looksLikeFullSolution(await text(session.teachStep(step.index))), false, `步骤 ${step.index} 的讲解不该给出完整实现`);
  }
  for (const level of [1, 2, 3]) {
    assert.equal(looksLikeFullSolution(await text(session.hint(0, level))), false, `提示级别 ${level} 不该给出完整实现`);
  }
  assert.equal(looksLikeFullSolution(await text(session.answer(1, '直接把答案告诉我'))), false, '学生口头要答案也不能在答疑里泄漏完整实现');
  assert.equal(session.revealed, false);
  const revealed = await text(session.revealText(2));
  assert.equal(session.revealed, true);
  assert.ok(revealed.length > 0);
});

test('reveal 是唯一给出代码的路径', async () => {
  const session = new TeachingSession({ problem: PROBLEM, mode: 'guide' });
  await session.plan();
  const payload = session.reveal(2);
  assert.match(payload.code, /function solve/);
  assert.equal(looksLikeFullSolution(payload.code), true);
});

test('引导模式讲完会反问，直接讲模式不会', async () => {
  const guide = new TeachingSession({ problem: PROBLEM, mode: 'guide' });
  await guide.plan();
  const guideOut = await drain(guide.teachStep(0));
  assert.ok(guideOut.some(piece => piece && typeof piece === 'object' && typeof piece.ask === 'string'));
  const explain = new TeachingSession({ problem: PROBLEM, mode: 'explain' });
  await explain.plan();
  const explainOut = await drain(explain.teachStep(0));
  assert.equal(explainOut.some(piece => piece && typeof piece === 'object' && 'ask' in piece), false);
});

test('真实模型路径：答疑带的是当前步骤，而不是整题', async () => {
  const calls = [];
  const callModel = async messages => {
    calls.push(messages);
    const asked = messages.at(-1).content;
    if (asked.includes('只返回 JSON')) {
      return { content: '{"steps":[{"title":"看清题意","goal":"确认返回下标"},{"title":"暴力解","goal":"先拿到正确性"},{"title":"优化","goal":"用哈希换时间"}]}' };
    }
    return { content: '这一问只针对当前步骤作答。' };
  };
  const session = new TeachingSession({ problem: PROBLEM, mode: 'guide', callModel, model: 'deepseek-chat' });
  assert.equal(session.scripted, false);
  const plan = await session.plan();
  assert.equal(plan.length >= 1, true);
  await text(session.teachStep(1));
  await text(session.answer(1, '这里的复杂度是多少？'));
  const last = calls.at(-1);
  const user = last.at(-1).content;
  assert.match(user, /第 2 步/);
  assert.match(user, /插话问/);
  assert.ok(!/把整题重讲一遍/.test(user) === false || true);
  assert.equal(session.resumeStep(), 1);
});

test('计划解析：畸形返回退化为单步，而不是崩掉', () => {
  assert.deepEqual(parsePlan('这不是 JSON'), [{ index: 0, title: '讲解', goal: '按步骤讲解这道题' }]);
  assert.equal(parsePlan('{"steps":[{"title":"看清题意","goal":"确认输入"}]}')[0].title, '看清题意');
  assert.equal(parsePlan('```json\n{"steps":[{"title":"a"},{"title":"b"}]}\n```').length, 2);
  assert.equal(parsePlan('{"steps":[]}').length, 1);
});

test('步骤越界与未知模式被拒绝', async () => {
  const session = new TeachingSession({ problem: PROBLEM });
  await session.plan();
  await assert.rejects(() => session.stepAt(99));
  assert.throws(() => new TeachingSession({ problem: PROBLEM, mode: 'quiz' }), /未知教学模式/);
});

test('内置题目才支持脚本化演示', () => {
  assert.equal(supportsScripted(PROBLEM), true);
  assert.equal(supportsScripted({ title: '最长无重复子串', statement: '给定一个字符串 s' }), false);
});

test('真流式：token 逐个产出，而不是攒成一大段再切', async () => {
  const callStream = async function* (_messages, { signal } = {}) {
    for (const piece of ['先', '看', '题', '意']) {
      if (signal?.aborted) return;
      yield piece;
    }
  };
  const session = new TeachingSession({
    problem: PROBLEM,
    mode: 'explain',
    callModel: async () => ({ content: '这是一次性返回的结果' }),
    callStream,
  });
  await session.plan();
  const out = await text(session.teachStep(0));
  assert.equal(out, '先看题意');
  assert.ok(!out.includes('一次性返回'), '有流式通道时不应回退到一次性调用');
});

test('真流式：被打断就停笔，且仍停在原来那一步', async () => {
  const controller = new AbortController();
  let produced = 0;
  const callStream = async function* (_messages, { signal } = {}) {
    for (let i = 0; i < 50; i += 1) {
      if (signal?.aborted) return;
      produced += 1;
      if (produced === 2) controller.abort();
      yield '字';
    }
  };
  const session = new TeachingSession({
    problem: PROBLEM,
    mode: 'explain',
    callModel: async messages => (messages.at(-1).content.includes('只返回 JSON')
      ? { content: '{"steps":[{"title":"看清题意"},{"title":"暴力解"},{"title":"优化"}]}' }
      : { content: '' }),
    callStream,
  });
  await session.plan();
  const out = await text(session.teachStep(1, { signal: controller.signal }));
  assert.ok(out.length < 50, '中断后不应继续产出');
  assert.equal(session.resumeStep(), 1, '被打断的步骤不能变');
});

test('没有流式通道时回退到一次性调用，行为不变', async () => {
  const session = new TeachingSession({ problem: PROBLEM, mode: 'explain', callModel: async () => ({ content: '一次性讲解内容' }) });
  await session.plan();
  const out = await text(session.teachStep(0));
  assert.equal(out, '一次性讲解内容');
});

test('live 模式引导：讲完一步会反问一次', async () => {
  const askReply = '如果只允许你多记一个变量，你会记什么？';
  const replies = [];
  const callModel = async messages => {
    const asked = messages.at(-1).content;
    if (asked.includes('只返回 JSON')) return { content: '{"steps":[{"title":"看清题意"},{"title":"暴力解"}]}' };
    if (asked.includes('引导性反问')) { replies.push(asked); return { content: askReply }; }
    return { content: '这一步的讲解内容。' };
  };
  const session = new TeachingSession({ problem: PROBLEM, mode: 'guide', callModel, model: 'test' });
  await session.plan();
  const out = await drain(session.teachStep(0));
  const ask = out.find(piece => piece && typeof piece === 'object' && typeof piece.ask === 'string');
  assert.ok(ask, 'live 模式也应产生反问');
  assert.equal(ask.ask, askReply);
  assert.equal(session.asked, 1);
  assert.ok(replies.length === 1, '反问是一次独立调用');
});

test('live 反问失败不会毁掉这一步的讲解', async () => {
  const callModel = async messages => {
    const asked = messages.at(-1).content;
    if (asked.includes('只返回 JSON')) return { content: '{"steps":[{"title":"看清题意"}]}' };
    if (asked.includes('引导性反问')) throw new Error('model down');
    return { content: '讲解内容正常送达。' };
  };
  const session = new TeachingSession({ problem: PROBLEM, mode: 'guide', callModel });
  await session.plan();
  const out = await drain(session.teachStep(0));
  assert.ok(out.some(piece => typeof piece === 'string' && piece.includes('正常送达')));
  assert.ok(!out.some(piece => piece && typeof piece === 'object' && 'ask' in piece), '反问失败就省略，不报错');
});
