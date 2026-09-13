import { assertLesson, type Lesson } from '../../../packages/lesson-schema/src/index.ts';

const twoSum: Lesson = {
  version: '0.1', id: 'two-sum', number: 1, title: '两数之和', difficulty: '简单', technique: '哈希表',
  source: 'https://leetcode.cn/problems/two-sum/',
  problem: '在整数数组中找到两个不同位置的数，使它们的和等于目标值。返回这两个位置的下标，顺序不限；题目保证恰好存在一组答案。',
  inputLabel: 'nums = [3, 2, 4] · target = 6', values: [3, 2, 4], output: '[1, 2]', complexity: '时间 O(n) · 空间 O(n)（Map 操作平均 O(1)）',
  code: `function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) {
      return [seen.get(need), i];
    }
    seen.set(nums[i], i);
  }
  return [];
}`,
  frames: [
    {id:'read',title:'先想：我还缺哪个数？',narration:'目标是 6。遍历到一个数时，先求出它的补数。Map 只记录已经走过的数及其下标。',formula:'need = target − nums[i]',current:0,active:[0],matched:[],entries:[],variables:{i:0,当前值:3,need:3},codeLine:4},
    {id:'lookup-3',title:'3 还没有搭档',narration:'当前值是 3，补数也是 3。但 Map 还是空的。不能让下标 0 的这个 3 和自己配对，所以必须先查找，再存入。',formula:'seen.has(3) → false',current:0,active:[0],matched:[],entries:[],variables:{i:0,need:3},codeLine:5},
    {id:'store-3',title:'记住走过的位置',narration:'把数值 3 和下标 0 存进 Map。键是数值，值是下标，这样找到补数时就能直接返回位置。',formula:'seen.set(3, 0)',current:0,active:[0],matched:[],entries:[['3',0]],variables:{i:0,need:3},codeLine:8},
    {id:'lookup-2',title:'来到 2，寻找 4',narration:'移动到下标 1。6 减 2 等于 4，Map 里只有 3，没有 4，所以继续记录当前数字。',formula:'6 − 2 = 4',current:1,active:[1],matched:[],entries:[['3',0]],variables:{i:1,当前值:2,need:4},codeLine:5},
    {id:'store-2',title:'把 2 的位置也记下来',narration:'Map 现在记录 3 在下标 0，2 在下标 1。接下来检查最后一个数字 4。',formula:'seen.set(2, 1)',current:1,active:[1],matched:[],entries:[['3',0],['2',1]],variables:{i:1,need:4},codeLine:8},
    {id:'found',title:'找到补数，返回下标',narration:'来到 4，需要的补数是 2。Map 告诉我们 2 在下标 1，而当前下标是 2。因此返回 [1, 2]，不是数值 [2, 4]。',formula:'nums[1] + nums[2] = 2 + 4 = 6',current:2,active:[2],matched:[1,2],entries:[['3',0],['2',1]],variables:{i:2,need:2,结果:'[1, 2]'},codeLine:6},
  ],
  checkpoint:{prompt:'nums = [3, 2, 4]，target = 6。函数应该返回哪两个下标？',placeholder:'例如：[0, 1]',explanation:'输入两个整数下标；两种顺序都可以。'},
};

const longest: Lesson = {
  version:'0.1',id:'longest-substring',number:3,title:'无重复字符的最长子串',difficulty:'中等',technique:'滑动窗口',
  source:'https://leetcode.cn/problems/longest-substring-without-repeating-characters/',
  problem:'从字符串里找到一段连续且字符不重复的片段，返回最大长度。字符必须连续，不能跳过中间字符；空字符串返回 0。',
  inputLabel:'s = "abba"', values:['a','b','b','a'],output:'2',complexity:'时间 O(n) · 空间 O(min(n, 字符集大小))',
  code:`function lengthOfLongestSubstring(s) {
  const last = new Map();
  let left = 0, best = 0;
  for (let right = 0; right < s.length; right++) {
    const char = s[right];
    if (last.has(char)) {
      left = Math.max(left, last.get(char) + 1);
    }
    last.set(char, right);
    best = Math.max(best, right - left + 1);
  }
  return best;
}`,
  frames:[
    {id:'a',title:'从一个字符开始',narration:'用 left 和 right 框出一个没有重复字符的窗口。先放入 a，记录它最后出现的位置是 0，最大长度更新为 1。',formula:'窗口 "a" · 长度 1',current:0,active:[0],matched:[],entries:[['a',0]],variables:{left:0,right:0,best:1},codeLine:10},
    {id:'ab',title:'扩展右边界',narration:'右边界移动到 b。b 没有出现过，窗口扩展为 ab，长度是 2。Map 保存的是每个字符最近出现的下标。',formula:'窗口 "ab" · 长度 2',current:1,active:[0,1],matched:[],entries:[['a',0],['b',1]],variables:{left:0,right:1,best:2},codeLine:9},
    {id:'repeat',title:'遇到重复的 b',narration:'准备把下标 2 的 b 加进来。Map 显示上一个 b 在下标 1，留着它会重复。左边界必须移到 1 加 1，也就是 2。',formula:'left = max(0, 1 + 1) = 2',current:2,active:[0,1],matched:[1,2],entries:[['a',0],['b',1]],variables:{left:0,right:2,best:2},codeLine:7},
    {id:'shrink',title:'缩小窗口，保留历史最优',narration:'把左边界移到 2，窗口现在只有新的 b。当前长度是 1，但曾经找到长度为 2 的 ab，所以 best 仍然是 2。',formula:'best = max(2, 1) = 2',current:2,active:[2],matched:[],entries:[['a',0],['b',2]],variables:{left:2,right:2,best:2},codeLine:10},
    {id:'no-backward',title:'旧的 a 已经在窗口外',narration:'来到最后的 a。Map 中旧 a 的下标是 0，已经不在当前窗口中。不能把 left 退回 1，否则窗口 bba 又会重复。用 Math.max 保证左边界只向右移动。',formula:'left = max(2, 0 + 1) = 2',current:3,active:[2,3],matched:[],entries:[['a',0],['b',2]],variables:{left:2,right:3,best:2},codeLine:7},
    {id:'finish',title:'答案是历史最大长度',narration:'最后的窗口是 ba，长度为 2；整个过程中的最大长度也是 2。ab 和 ba 都是合法的最长子串，最终返回长度，而不是子串内容。',formula:'return best → 2',current:3,active:[2,3],matched:[],entries:[['a',3],['b',2]],variables:{left:2,right:3,best:2},codeLine:12},
  ],
  checkpoint:{prompt:'处理 "abba" 最后的 a（right = 3）时，left 已经是 2，Map 中旧 a 的下标是 0。更新后 left 应该是多少？',placeholder:'输入 left 的数值',explanation:'检查点考察窗口左边界，不是最终返回值。'},
};

export const lessons: Lesson[] = [twoSum,longest];
lessons.forEach(assertLesson);
