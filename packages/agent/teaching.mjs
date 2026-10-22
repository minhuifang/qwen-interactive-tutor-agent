// Teaching session: explain a problem step by step, let the student interrupt at
// any moment, answer only the current step, and resume from the exact step.
//
// The two hard rules this module exists to enforce:
//   1. An interruption never loses the student's place. `answer()` does not move
//      the cursor; `resumeStep()` returns the same index that was being taught.
//   2. In guide mode the full solution is never shown before the student asks
//      for it. Hints escalate 1 → 2 → 3, and only `reveal()` prints the code.
//
// Without a model the session runs a scripted strategy for the built-in problem
// so the interaction is still demonstrable. It is labelled as such everywhere it
// surfaces.

import { buildTeachingSystemPrompt, buildPlanPrompt, buildStepPrompt, buildHintPrompt, buildAnswerPrompt, buildRevealPrompt, buildAskPrompt } from './teaching-prompt.mjs';

export const TEACH_MODES = ['guide', 'explain'];
export const HINT_LEVELS = [1, 2, 3];

// ---------------------------------------------------------------------------
// Scripted strategy — the built-in problem, used when no model is configured.
// ---------------------------------------------------------------------------

const SCRIPTED = {
  match: /两数之和|two\s*sum|target/i,
  steps: [
    {
      title: '先看清题目到底要什么',
      goal: '确认返回的是下标，不是数值',
      teach: '先别急着写代码。题目要的是「和为目标值的两个整数的下标」，所以返回值是位置，不是那两个数字本身。另外题目保证每种输入只有一个答案，且同一个元素不能重复使用——这两条决定了后面不用处理多解和自匹配。把输入输出先说清楚：进数组 nums 和目标 target，出一对下标 [i, j] 且 i < j。',
      ask: '如果 nums 是 [3,2,4]、target 是 6，答案应该是 [1,2] 还是 [2,4]？为什么？',
      hints: [
        '提示一：答案是一个长度为 2 的数组，里面装的是什么？回到题目第一句话再读一遍。',
        '提示二：题目说「返回下标」，下标是元素在数组里的位置编号，从 0 开始数。所以 [3,2,4] 里 2 的位置是 1，4 的位置是 2。',
        '提示三：答案就是 [1,2]。因为 nums[1] + nums[2] = 2 + 4 = 6，而题目要求返回的是位置而不是 2 和 4 这两个数。',
      ],
    },
    {
      title: '先写出最直觉的做法',
      goal: '暴力两重循环，把正确性先拿到手',
      teach: '最直觉的办法是枚举：固定第一个数 i，再拿它和后面每一个 j 试一遍，看相加等不等于 target。这是两重循环，外层 i 从 0 到 n-1，内层 j 从 i+1 到 n-1。先把它写出来，因为它是正确的——在优化之前，先保证有个能跑通的版本，这一步的价值是给你一个对照基准。',
      ask: '这个写法里，同一个元素会不会被用两次？内层 j 从 i+1 开始是为了什么？',
      hints: [
        '提示一：如果你要检查所有两两组合，需要几层循环？',
        '提示二：外层固定 i，内层从 i+1 开始遍历到末尾，就得到了所有不重复的两两组合。',
        '提示三：for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (nums[i] + nums[j] === target) return [i, j]; —— 这就是暴力解，正确但慢。',
      ],
    },
    {
      title: '找到瓶颈：我们在重复比较',
      goal: '用哈希表把「找另一个数」变成 O(1)',
      teach: '暴力解的瓶颈在于：为了找 target - nums[i]，我们把剩下的数全扫了一遍。但这个问题其实可以反过来问——不是「去找谁和我配」，而是「我需要的那个数之前出现过吗」。如果一边遍历一边把看过的数值和它的下标记进一个 Map，那么对当前的 x，只需要查一次 map 里有没有 target - x。查 Map 是常数时间，于是两重循环塌缩成一重。这就是典型的用空间换时间。',
      ask: '为什么可以「一边遍历一边查」，而不是先把整个数组都存进 Map 再查？',
      hints: [
        '提示一：内层循环在做的事，本质是「在一个集合里查找某个数」。有没有一种结构让查找不用遍历？',
        '提示二：把「数值 → 下标」存进一个 Map。遍历到 x 时，查 map.has(target - x)，有就直接返回两个下标。',
        '提示三：先查再存——对当前的 x，先看 needed = target - x 在不在 map 里；不在就把 map.set(x, i) 存起来。顺序反了会在 target 是自身两倍时匹配到自己。',
      ],
    },
    {
      title: '复杂度与边界情况',
      goal: '说清为什么是 O(n)，以及哪些输入要当心',
      teach: '一次遍历，每次做一次常数时间的 Map 查找，所以时间复杂度是 O(n)，空间复杂度是 O(n)——多出来的就是那个 Map。边界上要当心三件事：一是同一个元素不能重复用，先查后存的顺序正好保证了这一点；二是数组里可能有重复数值，比如 [3,3] 配 target=6，先查后存仍然能正确得到 [0,1]；三是题目保证有解，所以不用处理找不到的情况，但真实工程里最好显式返回一个约定值。',
      ask: '如果数组是 [3,3]、target 是 6，走一遍先查后存，看看哪一步匹配上了？',
      hints: [
        '提示一：时间复杂度的瓶颈从「每次扫描剩余数组」变成了什么？',
        '提示二：每次只做一次 Map 查找，是 O(1)；n 个元素就是 O(n)。空间上多了一个 Map，也是 O(n)。',
        '提示三：i=0 时 map 为空，存入 3→0；i=1 时查 target-3=3，map 里有 3→0，直接返回 [0,1]。同一个元素没有被用两次。',
      ],
    },
  ],
  reveal: {
    code: 'function solve(input) {\n  const { nums, target } = input;\n  const seen = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    const needed = target - nums[i];\n    if (seen.has(needed)) return [seen.get(needed), i];\n    seen.set(nums[i], i);\n  }\n  return null;\n}',
    explanation: '一次遍历：先查 needed 在不在 seen 里，命中就直接返回两个下标；没命中才把当前数值和下标存进去。先查后存保证同一个元素不会被用两次，也让 [3,3] target=6 这类输入得到 [0,1]。',
  },
  // Keyword → answer. Kept short: this is a scripted fallback, not a knowledge base.
  followUps: [
    { match: /为什么.*(哈希|map|Map|表)|哈希.*为什么|空间换时间/, text: '因为暴力解每次都要把剩下的数全扫一遍才能找到配对，而这个问题只关心「某个数出现没出现过」——这是判断存在性，正好是哈希表的强项，查找是常数时间。代价是多占一份 O(n) 的内存，所以叫空间换时间。' },
    { match: /(复杂度|O\(|时间|空间).*(多少|怎么算|为什么)/, text: '时间复杂度 O(n)：只遍历一次，每一步的 Map 查找与插入都是 O(1)。空间复杂度 O(n)：最坏情况下要把 n 个数值存进 Map。对比暴力解是 O(n²) 时间、O(1) 空间。' },
    { match: /(重复|两个 3|\[3,3\]|自身两倍|同一个元素)/, text: '关键在顺序：先查再存。遍历到第二个 3 时，第一个 3 已经存进 Map 了，所以能匹配上，返回 [0,1]。如果先存再查，第一个 3 就会和自己匹配——这就是「不能重复使用同一个元素」这条约束的落地点。' },
    { match: /(暴力|两重循环|n\^2|O\(n2\)).*(还要|意义|为什么)/, text: '它的意义是给你一个确定正确的基准。优化的前提是先有正确解，否则你不知道优化后的版本是不是只是更快了但错了。面试里先把暴力解说清楚，再谈优化，也是最稳的表达顺序。' },
    { match: /(下标|index|返回.*什么|为什么.*不是.*数值)/, text: '题目要的是「下标」，也就是元素在数组里的位置编号，从 0 开始。所以 [3,2,4] 配 target=6 返回的是 [1,2]，不是 [2,4]。这一步最容易看错，先看清楚再动手。' },
  ],
};

const SCRIPTED_FALLBACK_ANSWER = '这个问题我记下来了。在脚本化演示里我只能按预设内容回答，换一句更具体的问法（比如「为什么用哈希表」「复杂度怎么算」「重复元素怎么办」）我能答得更准；接上真实模型后，任意追问都会针对当前这一步作答。';

const KEYWORDS_PROGRESS = /(哈希|map|Map|seen|空间换时间|查表|记录)/;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export class TeachingSession {
  /**
   * @param {object} options
   * @param {{title:string, statement:string, inputContract?:string}} options.problem
   * @param {'guide'|'explain'} options.mode
   * @param {Function} [options.callModel] injected chat model; absent ⇒ scripted
   * @param {Function} [options.callStream] streaming chat model (async iterable of deltas)
   * @param {string} [options.model]
   */
  constructor({ problem, mode = 'guide', callModel = null, callStream = null, model = '' }) {
    if (!TEACH_MODES.includes(mode)) throw new Error(`未知教学模式：${mode}`);
    this.problem = problem;
    this.mode = mode;
    this.callModel = callModel;
    this.callStream = callStream;
    this.model = model;
    this.kind = callModel ? 'live' : 'scripted';
    this.steps = [];
    this.currentStep = 0;
    this.hints = new Map(); // step index → highest level given
    this.revealed = false;
    this.asked = 0;
  }

  get scripted() { return this.kind === 'scripted'; }

  /**
   * Live replies: token-streamed when a streaming transport is available, so an
   * abort mid-reply stops the model instead of only stopping the display.
   * Falls back to one call + chunked playback when streaming is not wired up.
   */
  async *live(messages, empty, { signal } = {}) {
    if (this.callStream) {
      let received = false;
      for await (const piece of this.callStream(messages, { signal })) {
        received = true;
        if (piece) yield piece;
      }
      if (received) return;
    }
    const reply = await this.callModel(messages);
    yield* chunks(reply.content?.trim() || empty);
  }

  /** Steps are fixed once planned; calling again is a no-op. */
  async plan() {
    if (this.steps.length) return this.steps;
    if (this.scripted) {
      this.steps = SCRIPTED.steps.map((step, index) => ({ index, title: step.title, goal: step.goal }));
      return this.steps;
    }
    const reply = await this.callModel([
      { role: 'system', content: buildTeachingSystemPrompt({ mode: this.mode }) },
      { role: 'user', content: buildPlanPrompt(this.problem) },
    ]);
    this.steps = parsePlan(reply.content);
    return this.steps;
  }

  /** Guides mode also asks a question after each step. */
  async *teachStep(index, { signal } = {}) {
    const step = await this.stepAt(index);
    this.currentStep = index;
    if (this.scripted) {
      yield* chunks(SCRIPTED.steps[index]?.teach ?? '这一步没有预设讲解。');
    } else {
      yield* this.live([
        { role: 'system', content: buildTeachingSystemPrompt({ mode: this.mode }) },
        { role: 'user', content: buildStepPrompt({ problem: this.problem, steps: this.steps, index }) },
      ], '（模型这次没有返回讲解内容，可以重试。）', { signal });
    }
    if (this.mode === 'guide' && !this.revealed) {
      const ask = this.scripted
        ? SCRIPTED.steps[index]?.ask
        : await this.composeAsk(step.index, { signal });
      if (ask) { this.asked += 1; yield { ask }; }
    }
  }

  /** Guide mode asks one question per step; live mode composes it on the spot. */
  async composeAsk(index, { signal } = {}) {
    if (!this.callModel) return null;
    try {
      const reply = await this.callModel([
        { role: 'system', content: buildTeachingSystemPrompt({ mode: this.mode }) },
        { role: 'user', content: buildAskPrompt({ problem: this.problem, steps: this.steps, index }) },
      ], { signal });
      const ask = String(reply.content || '').trim().replace(/^问[题：:]\s*/, '').replace(/^[「"]|[」"]$/g, '');
      return ask ? ask.slice(0, 80) : null;
    } catch {
      return null; // a failed question must not fail the step it follows
    }
  }

  /**
   * Answer the student's interruption. Never moves the cursor — the caller
   * resumes with `resumeStep()`.
   */
  async *answer(index, question, { signal } = {}) {
    const step = await this.stepAt(index);
    const asked = String(question || '').trim();
    if (!asked) yield* chunks('你还没说想问什么。可以直接打字，也可以点麦克风说。');
    if (this.scripted) {
      const hit = SCRIPTED.followUps.find(item => item.match.test(asked));
      let text = hit ? hit.text : SCRIPTED_FALLBACK_ANSWER;
      if (this.mode === 'guide' && KEYWORDS_PROGRESS.test(asked)) {
        text += ' 你已经说到关键点了——要不要自己试着把这一步写出来？写不出来就点「再提示一点」。';
      }
      yield* chunks(text);
      return;
    }
    yield* this.live([
      { role: 'system', content: buildTeachingSystemPrompt({ mode: this.mode }) },
      { role: 'user', content: buildAnswerPrompt({ problem: this.problem, steps: this.steps, index: step.index, question: asked }) },
    ], '（模型这次没有返回内容，可以换个问法再试。）', { signal });
  }

  /** Escalating hints. Level only ever moves forward for a given step. */
  async *hint(index, level = 1, { signal } = {}) {
    const step = await this.stepAt(index);
    const wanted = Math.min(Math.max(Number(level) || 1, 1), 3);
    const given = this.hints.get(index) || 0;
    const next = Math.max(wanted, Math.min(given + 1, 3));
    this.hints.set(index, next);
    if (this.scripted) {
      yield* chunks(SCRIPTED.steps[index]?.hints?.[next - 1] ?? '这一步没有更多预设提示了，点「直接告诉我」看完整解法。');
      return;
    }
    yield* this.live([
      { role: 'system', content: buildTeachingSystemPrompt({ mode: this.mode }) },
      { role: 'user', content: buildHintPrompt({ problem: this.problem, steps: this.steps, index: step.index, level: next }) },
    ], '（模型这次没有返回提示，可以再点一次。）', { signal });
  }

  /** The only way the full solution enters the conversation. */
  reveal(index) {
    const step = this.steps[index] ?? { index };
    this.revealed = true;
    if (this.scripted) return { code: SCRIPTED.reveal.code, explanation: SCRIPTED.reveal.explanation, step: step.index };
    return null; // live mode streams the reveal through the model
  }

  async *revealText(index, { signal } = {}) {
    const step = await this.stepAt(index);
    this.revealed = true;
    if (this.scripted) {
      yield* chunks(SCRIPTED.reveal.explanation);
      return;
    }
    yield* this.live([
      { role: 'system', content: buildTeachingSystemPrompt({ mode: this.mode }) },
      { role: 'user', content: buildRevealPrompt({ problem: this.problem, steps: this.steps, index: step.index }) },
    ], '（模型这次没有返回解法，可以重试。）', { signal });
  }

  resumeStep() { return this.currentStep; }

  async stepAt(index) {
    if (!this.steps.length) await this.plan();
    const at = Number(index) || 0;
    if (at < 0 || at >= this.steps.length) throw new Error(`步骤不存在：${index}`);
    return this.steps[at];
  }
}

export function supportsScripted(problem) {
  const haystack = `${problem?.title || ''}\n${problem?.statement || ''}`;
  return SCRIPTED.match.test(haystack);
}

/** Split a reply into readable chunks so the UI can render it progressively. */
export function* chunks(text, size = 18) {
  const value = String(text ?? '');
  for (let i = 0; i < value.length; i += size) yield value.slice(i, i + size);
}

export function parsePlan(content, fallbackTitle = '讲解') {
  const text = String(content ?? '').trim();
  const candidate = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(candidate);
    const list = Array.isArray(parsed) ? parsed : parsed?.steps;
    if (!Array.isArray(list) || !list.length) throw new Error('empty');
    const steps = list.slice(0, 6).map((item, index) => ({
      index,
      title: String(item?.title || `${fallbackTitle} ${index + 1}`).slice(0, 80),
      goal: String(item?.goal || '').slice(0, 120),
    }));
    if (steps.length) return steps;
  } catch { /* fall through to the single-step shape */ }
  return [{ index: 0, title: fallbackTitle, goal: '按步骤讲解这道题' }];
}

/** Heuristic used by tests and by the server guard: does this text hand over a full solution? */
export function looksLikeFullSolution(text) {
  const value = String(text ?? '');
  return /function\s+solve/.test(value) && /return\s/.test(value);
}
