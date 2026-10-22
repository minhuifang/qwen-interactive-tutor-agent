// Validates the fixtures themselves: every `expected` must equal what the
// reference implementation returns for the same input. If this fails, the eval
// set is wrong and any pass rate measured against it would be meaningless.
//
//   node eval/self-check.mjs

import { isDeepStrictEqual } from 'node:util';
import { problems } from './problems.mjs';

let checks = 0;
const failures = [];

for (const problem of problems) {
  if (!problem.id || !problem.statement || !problem.inputContract) failures.push(`${problem.id || '(no id)'} 缺少必填字段`);
  if (!Array.isArray(problem.cases) || problem.cases.length < 1 || problem.cases.length > 4) failures.push(`${problem.id} 样例数量应为 1–4`);
  for (const [index, item] of problem.cases.entries()) {
    checks++;
    let actual;
    try {
      actual = problem.reference(structuredClone(item.input));
    } catch (error) {
      failures.push(`${problem.id} 样例 ${index + 1} 参考实现抛错：${error?.message}`);
      continue;
    }
    if (!isDeepStrictEqual(actual, item.expected)) {
      failures.push(`${problem.id} 样例 ${index + 1} 期望 ${JSON.stringify(item.expected)}，参考实现给出 ${JSON.stringify(actual)}`);
    }
  }
}

const ids = new Set(problems.map(problem => problem.id));
if (ids.size !== problems.length) failures.push('存在重复的题目 id');

console.log(`题目 ${problems.length} 道，样例 ${checks} 条`);
if (failures.length) {
  console.error(`\n自检失败 ${failures.length} 项：`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('自检通过：所有样例的预期输出与参考实现一致。');
