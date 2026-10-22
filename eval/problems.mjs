// Fixed evaluation set. Every case's `expected` is checked against `reference`
// by `node eval/self-check.mjs`, so a typo in the fixtures fails the build
// instead of quietly deflating the pass rate.
//
// `reference` is only used by the self-check. It is never sent to the model and
// never executed inside the sandbox — the sandbox only runs model-written code.

export const problems = [
  {
    id: 'two-sum',
    title: '两数之和',
    statement: '给定整数数组 nums 和整数目标值 target，返回和为 target 的两个元素的下标，按 i < j 返回。假设恰好只有一个答案，同一元素不能使用两次。',
    inputContract: 'input = { nums: number[], target: number }',
    cases: [
      { input: { nums: [2, 7, 11, 15], target: 9 }, expected: [0, 1] },
      { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
      { input: { nums: [3, 3], target: 6 }, expected: [0, 1] },
    ],
    reference: ({ nums, target }) => {
      for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) if (nums[i] + nums[j] === target) return [i, j];
      return [];
    },
  },
  {
    id: 'reverse-string',
    title: '反转字符串',
    statement: '给定字符串 s，返回反转后的字符串，空格与大小写保持不变。',
    inputContract: 'input = { s: string }',
    cases: [
      { input: { s: 'hello' }, expected: 'olleh' },
      { input: { s: 'a' }, expected: 'a' },
      { input: { s: 'ab cd' }, expected: 'dc ba' },
    ],
    reference: ({ s }) => s.split('').reverse().join(''),
  },
  {
    id: 'max-subarray',
    title: '最大子数组和',
    statement: '给定整数数组 nums，返回和最大的连续子数组的和，子数组至少包含一个元素。',
    inputContract: 'input = { nums: number[] }',
    cases: [
      { input: { nums: [-2, 1, -3, 4, -1, 2, 1, -5, 4] }, expected: 6 },
      { input: { nums: [1] }, expected: 1 },
      { input: { nums: [-3, -1, -2] }, expected: -1 },
    ],
    reference: ({ nums }) => {
      let best = nums[0], current = nums[0];
      for (let i = 1; i < nums.length; i++) {
        current = Math.max(nums[i], current + nums[i]);
        best = Math.max(best, current);
      }
      return best;
    },
  },
  {
    id: 'valid-parentheses',
    title: '有效的括号',
    statement: '给定只包含 ()[]{} 的字符串 s，判断括号是否按正确顺序闭合，返回布尔值。',
    inputContract: 'input = { s: string }',
    cases: [
      { input: { s: '()[]{}' }, expected: true },
      { input: { s: '(]' }, expected: false },
      { input: { s: '({[]})' }, expected: true },
      { input: { s: '((' }, expected: false },
    ],
    reference: ({ s }) => {
      const pairs = { ')': '(', ']': '[', '}': '{' };
      const stack = [];
      for (const char of s) {
        if (char === '(' || char === '[' || char === '{') stack.push(char);
        else if (stack.pop() !== pairs[char]) return false;
      }
      return stack.length === 0;
    },
  },
  {
    id: 'merge-sorted',
    title: '合并两个有序数组',
    statement: '给定两个升序整数数组 a 与 b，返回合并后的升序数组。',
    inputContract: 'input = { a: number[], b: number[] }',
    cases: [
      { input: { a: [1, 2, 4], b: [1, 3, 4] }, expected: [1, 1, 2, 3, 4, 4] },
      { input: { a: [], b: [1] }, expected: [1] },
      { input: { a: [5], b: [] }, expected: [5] },
    ],
    reference: ({ a, b }) => [...a, ...b].sort((x, y) => x - y),
  },
  {
    id: 'best-time-stock',
    title: '买卖股票的最佳时机',
    statement: '给定每日股价数组 prices，只允许买入一次并卖出一次（先买后卖），返回最大利润；无法获利时返回 0。',
    inputContract: 'input = { prices: number[] }',
    cases: [
      { input: { prices: [7, 1, 5, 3, 6, 4] }, expected: 5 },
      { input: { prices: [7, 6, 4, 3, 1] }, expected: 0 },
      { input: { prices: [2, 4, 1] }, expected: 2 },
    ],
    reference: ({ prices }) => {
      let low = Infinity, profit = 0;
      for (const price of prices) { low = Math.min(low, price); profit = Math.max(profit, price - low); }
      return profit;
    },
  },
  {
    id: 'move-zeroes',
    title: '移动零',
    statement: '给定整数数组 nums，把所有 0 移到末尾，同时保持非零元素的相对顺序，返回处理后的数组。',
    inputContract: 'input = { nums: number[] }',
    cases: [
      { input: { nums: [0, 1, 0, 3, 12] }, expected: [1, 3, 12, 0, 0] },
      { input: { nums: [0] }, expected: [0] },
      { input: { nums: [1, 2] }, expected: [1, 2] },
    ],
    reference: ({ nums }) => [...nums.filter(value => value !== 0), ...nums.filter(value => value === 0)],
  },
  {
    id: 'single-number',
    title: '只出现一次的数字',
    statement: '给定非空整数数组，除某个元素只出现一次外，其余元素都出现两次，返回那个只出现一次的元素。',
    inputContract: 'input = { nums: number[] }',
    cases: [
      { input: { nums: [2, 2, 1] }, expected: 1 },
      { input: { nums: [4, 1, 2, 1, 2] }, expected: 4 },
      { input: { nums: [1] }, expected: 1 },
    ],
    reference: ({ nums }) => nums.reduce((acc, value) => acc ^ value, 0),
  },
  {
    id: 'climbing-stairs',
    title: '爬楼梯',
    statement: '每次可以爬 1 阶或 2 阶，给定阶数 n（n ≥ 1），返回爬到顶的不同方法数。',
    inputContract: 'input = { n: number }',
    cases: [
      { input: { n: 2 }, expected: 2 },
      { input: { n: 3 }, expected: 3 },
      { input: { n: 5 }, expected: 8 },
    ],
    reference: ({ n }) => {
      let a = 1, b = 2;
      if (n === 1) return 1;
      for (let i = 3; i <= n; i++) { const next = a + b; a = b; b = next; }
      return b;
    },
  },
  {
    id: 'majority-element',
    title: '多数元素',
    statement: '给定长度为 n 的数组，返回出现次数严格大于 n/2 的元素。假设多数元素一定存在。',
    inputContract: 'input = { nums: number[] }',
    cases: [
      { input: { nums: [3, 2, 3] }, expected: 3 },
      { input: { nums: [2, 2, 1, 1, 1, 2, 2] }, expected: 2 },
    ],
    reference: ({ nums }) => {
      const counts = new Map();
      for (const value of nums) counts.set(value, (counts.get(value) || 0) + 1);
      for (const [value, count] of counts) if (count > nums.length / 2) return value;
      return null;
    },
  },
  {
    id: 'contains-duplicate',
    title: '存在重复元素',
    statement: '给定整数数组 nums，如果任一元素出现至少两次返回 true，否则返回 false。',
    inputContract: 'input = { nums: number[] }',
    cases: [
      { input: { nums: [1, 2, 3, 1] }, expected: true },
      { input: { nums: [1, 2, 3, 4] }, expected: false },
      { input: { nums: [1, 1] }, expected: true },
    ],
    reference: ({ nums }) => new Set(nums).size !== nums.length,
  },
  {
    id: 'intersection-of-arrays',
    title: '两个数组的交集',
    statement: '给定两个整数数组 a 和 b，返回它们的交集（每个元素唯一），结果按升序排列。',
    inputContract: 'input = { a: number[], b: number[] }',
    cases: [
      { input: { a: [1, 2, 2, 1], b: [2, 2] }, expected: [2] },
      { input: { a: [4, 9, 5], b: [9, 4, 9, 8, 4] }, expected: [4, 9] },
      { input: { a: [1], b: [2] }, expected: [] },
    ],
    reference: ({ a, b }) => [...new Set(a.filter(value => b.includes(value)))].sort((x, y) => x - y),
  },
  {
    id: 'longest-common-prefix',
    title: '最长公共前缀',
    statement: '给定字符串数组 strs，返回所有字符串的最长公共前缀；不存在时返回空字符串。',
    inputContract: 'input = { strs: string[] }',
    cases: [
      { input: { strs: ['flower', 'flow', 'flight'] }, expected: 'fl' },
      { input: { strs: ['dog', 'racecar', 'car'] }, expected: '' },
      { input: { strs: ['a'] }, expected: 'a' },
    ],
    reference: ({ strs }) => {
      let prefix = strs[0] ?? '';
      for (const word of strs) {
        while (!word.startsWith(prefix)) prefix = prefix.slice(0, -1);
      }
      return prefix;
    },
  },
  {
    id: 'palindrome-number',
    title: '回文数',
    statement: '给定整数 n，判断它是否是回文数（正序与倒序读相同）。负数不是回文数。',
    inputContract: 'input = { n: number }',
    cases: [
      { input: { n: 121 }, expected: true },
      { input: { n: -121 }, expected: false },
      { input: { n: 10 }, expected: false },
    ],
    reference: ({ n }) => n >= 0 && String(n) === String(n).split('').reverse().join(''),
  },
  {
    id: 'plus-one',
    title: '加一',
    statement: '给定用数组表示的非负整数（最高位在数组开头，无前导零），返回该整数加一后的数组。',
    inputContract: 'input = { digits: number[] }',
    cases: [
      { input: { digits: [1, 2, 3] }, expected: [1, 2, 4] },
      { input: { digits: [4, 3, 2, 1] }, expected: [4, 3, 2, 2] },
      { input: { digits: [9, 9] }, expected: [1, 0, 0] },
    ],
    reference: ({ digits }) => {
      const out = [...digits];
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i] < 9) { out[i] += 1; return out; }
        out[i] = 0;
      }
      return [1, ...out];
    },
  },
  {
    id: 'length-of-last-word',
    title: '最后一个单词的长度',
    statement: '给定由字母和空格组成的字符串 s，返回最后一个单词的长度。单词之间可能有多个空格。',
    inputContract: 'input = { s: string }',
    cases: [
      { input: { s: 'Hello World' }, expected: 5 },
      { input: { s: '   fly me   to   the moon  ' }, expected: 4 },
      { input: { s: 'luffy' }, expected: 5 },
    ],
    reference: ({ s }) => {
      const parts = s.trim().split(/\s+/).filter(Boolean);
      return parts.length ? parts[parts.length - 1].length : 0;
    },
  },
  {
    id: 'roman-to-int',
    title: '罗马数字转整数',
    statement: '给定合法罗马数字字符串 s，返回对应整数。小值在大值左侧表示减法（如 IV = 4）。',
    inputContract: 'input = { s: string }',
    cases: [
      { input: { s: 'III' }, expected: 3 },
      { input: { s: 'LVIII' }, expected: 58 },
      { input: { s: 'MCMXCIV' }, expected: 1994 },
    ],
    reference: ({ s }) => {
      const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
      let total = 0;
      for (let i = 0; i < s.length; i++) {
        const current = values[s[i]], next = values[s[i + 1]];
        total += next && current < next ? -current : current;
      }
      return total;
    },
  },
  {
    id: 'binary-search',
    title: '二分查找',
    statement: '给定升序且元素不重复的整数数组 nums 和目标值 target，返回其下标；不存在返回 -1。',
    inputContract: 'input = { nums: number[], target: number }',
    cases: [
      { input: { nums: [-1, 0, 3, 5, 9, 12], target: 9 }, expected: 4 },
      { input: { nums: [-1, 0, 3, 5, 9, 12], target: 2 }, expected: -1 },
      { input: { nums: [5], target: 5 }, expected: 0 },
    ],
    reference: ({ nums, target }) => {
      let low = 0, high = nums.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (nums[mid] === target) return mid;
        if (nums[mid] < target) low = mid + 1; else high = mid - 1;
      }
      return -1;
    },
  },
  {
    id: 'sorted-squares',
    title: '有序数组的平方',
    statement: '给定非递减整数数组 nums（可能含负数），返回每个元素平方后按非递减排序的数组。',
    inputContract: 'input = { nums: number[] }',
    cases: [
      { input: { nums: [-4, -1, 0, 3, 10] }, expected: [0, 1, 9, 16, 100] },
      { input: { nums: [-7, -3, 2, 3, 11] }, expected: [4, 9, 9, 49, 121] },
    ],
    reference: ({ nums }) => nums.map(value => value * value).sort((x, y) => x - y),
  },
  {
    id: 'count-primes',
    title: '统计质数个数',
    statement: '给定非负整数 n，返回小于 n 的质数个数。',
    inputContract: 'input = { n: number }',
    cases: [
      { input: { n: 10 }, expected: 4 },
      { input: { n: 0 }, expected: 0 },
      { input: { n: 1 }, expected: 0 },
      { input: { n: 20 }, expected: 8 },
    ],
    reference: ({ n }) => {
      if (n < 3) return 0;
      const sieve = new Array(n).fill(true);
      sieve[0] = sieve[1] = false;
      for (let i = 2; i * i < n; i++) if (sieve[i]) for (let j = i * i; j < n; j += i) sieve[j] = false;
      return sieve.filter(Boolean).length;
    },
  },
];

export const PUBLIC_FIELDS = ['id', 'title', 'statement', 'inputContract', 'cases'];
