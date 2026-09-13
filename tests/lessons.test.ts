import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { lessons } from '../apps/web/lib/lessons.ts';
import { assertLesson } from '../packages/lesson-schema/src/index.ts';
import { evaluateAnswer } from '../packages/lesson-schema/src/assessment.ts';

test('课件通过校验，越界动画与重复步骤被拒绝', () => {
  lessons.forEach(assertLesson);
  const broken = structuredClone(lessons[0]);
  broken.frames[0].current = 99;
  assert.throws(() => assertLesson(broken));
  broken.frames[0].current = 0;
  broken.frames[1].id = broken.frames[0].id;
  assert.throws(() => assertLesson(broken));
});
test('两数之和：顺序不限，区分数值、重复下标与无效输入', () => {
  for (const answer of ['[1, 2]', '2,1', '［1，2］'])
    assert.equal(evaluateAnswer('two-sum', answer).status, 'correct');
  assert.equal(evaluateAnswer('two-sum', '[2,4]').errorType, 'VALUES_NOT_INDICES');
  assert.equal(evaluateAnswer('two-sum', '[0,0]').errorType, 'REUSED_INDEX');
  assert.equal(evaluateAnswer('two-sum', '[0,1]').errorType, 'SUM_MISMATCH');
  for (const answer of ['', '[1,2', '1,2]', '[1,2,3]', 'alert(1)', '[1.2,2]'])
    assert.equal(evaluateAnswer('two-sum', answer).status, 'invalid');
});
test('窗口检查点正确区分左边界回退错误', () => {
  assert.equal(evaluateAnswer('longest-substring', '2').status, 'correct');
  assert.equal(evaluateAnswer('longest-substring', '1').errorType, 'LEFT_MOVED_BACKWARD');
  assert.equal(evaluateAnswer('longest-substring', '3').status, 'incorrect');
  assert.equal(evaluateAnswer('longest-substring', '2abc').status, 'invalid');
});
test('教学中展示的 JS 参考算法能处理边界用例', () => {
  // Execute only repository-owned reference code here, never student input.
  const sum = runInNewContext(lessons[0].code + '; twoSum');
  for (const [nums,target] of [[[3,2,4],6],[[3,3],6],[[0,4,3,0],0],[[-3,4,3,90],0]] as [number[],number][]) {
    const [a,b] = sum(nums,target);
    assert.notEqual(a,b);
    assert.equal(nums[a]+nums[b],target);
  }
  const longest = runInNewContext(lessons[1].code + '; lengthOfLongestSubstring');
  for (const [input,expected] of [['',0],['abba',2],['abcabcbb',3],['bbbbb',1],['pwwkew',3],['dvdf',3],[' ',1]] as [string,number][])
    assert.equal(longest(input),expected);
});
