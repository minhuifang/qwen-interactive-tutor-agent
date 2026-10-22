// Tool surface exposed to the model. Two tools only: execute, or submit.
// Every argument is validated before it can reach the sandbox, and validation
// failures are returned to the model as observations instead of throwing, so a
// malformed call becomes a recoverable turn rather than a dead run.

export const LIMITS = {
  code: 16000,
  approach: 4000,
  step: 600, steps: 12,
  assumption: 300, assumptions: 10,
  complexity: 500,
  caution: 500, cautions: 10,
  note: 200,
  cases: 8,
  observationBytes: 8192,
};

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'run_tests',
      description:
        '在隔离容器中执行当前的 solve 实现，对照已确认样例逐例返回真实结果。这是你唯一能获得执行反馈的方式；返回结果由执行器生成，不能由你推断或声明。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['code'],
        properties: {
          code: {
            type: 'string',
            description: '完整的 JavaScript 实现：function solve(input){...}。单个 JSON 入参，返回 JSON 结果。不要包含 Markdown 围栏、import、require、网络/文件/DOM 访问。',
          },
          note: { type: 'string', description: '本轮修改意图，一句话，便于记录轨迹。' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description:
        '提交最终解法并结束任务。只有在 run_tests 已经验证过这份代码、或你在 cautions 里明确写明未验证原因时才调用。提交与你刚验证的代码不一致时，系统会再跑一次验证，结果以执行器为准。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'approach', 'timeComplexity', 'spaceComplexity'],
        properties: {
          code: { type: 'string', description: '最终 function solve(input) 实现。' },
          approach: { type: 'string', description: '核心思路，中文，面向正在学习的用户。' },
          steps: { type: 'array', items: { type: 'string' }, description: '用具体数据逐步推演，最多 12 步。' },
          assumptions: { type: 'array', items: { type: 'string' }, description: '额外假设，没有就给空数组。' },
          timeComplexity: { type: 'string' },
          spaceComplexity: { type: 'string' },
          cautions: { type: 'array', items: { type: 'string' }, description: '边界情况与未验证说明。' },
        },
      },
    },
  },
];

const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const stringList = (value, maxItems, maxLength) =>
  Array.isArray(value) && value.length <= maxItems
  && value.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= maxLength);

const keySets = {
  run_tests: ['code', 'note'],
  finish: ['code', 'approach', 'steps', 'assumptions', 'timeComplexity', 'spaceComplexity', 'cautions'],
};

/**
 * @returns {{ok: true, args: object} | {ok: false, reason: string}}
 * `reason` names the failing field only — never the model's own values.
 */
export function validateArguments(name, raw) {
  if (!keySets[name]) return { ok: false, reason: `未知工具 ${String(name).slice(0, 40)}` };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'arguments 必须是 JSON 对象' };
  const unknown = Object.keys(raw).filter(key => !keySets[name].includes(key));
  if (unknown.length) return { ok: false, reason: `不支持的字段：${unknown.slice(0, 5).join('、')}` };

  if (!text(raw.code, LIMITS.code)) return { ok: false, reason: `code 必须是非空字符串，最长 ${LIMITS.code} 字符` };
  if (/^\s*```/.test(raw.code)) return { ok: false, reason: 'code 不要包含 Markdown 围栏' };

  if (name === 'run_tests') {
    if (raw.note !== undefined && (typeof raw.note !== 'string' || raw.note.length > LIMITS.note)) {
      return { ok: false, reason: `note 最长 ${LIMITS.note} 字符` };
    }
    return { ok: true, args: { code: raw.code, note: raw.note?.trim() || '' } };
  }

  if (!text(raw.approach, LIMITS.approach)) return { ok: false, reason: `approach 必须是非空字符串，最长 ${LIMITS.approach} 字符` };
  if (!text(raw.timeComplexity, LIMITS.complexity)) return { ok: false, reason: `timeComplexity 最长 ${LIMITS.complexity} 字符且不能为空` };
  if (!text(raw.spaceComplexity, LIMITS.complexity)) return { ok: false, reason: `spaceComplexity 最长 ${LIMITS.complexity} 字符且不能为空` };
  const steps = raw.steps === undefined ? ['按题意直接求解'] : raw.steps;
  if (!stringList(steps, LIMITS.steps, LIMITS.step)) return { ok: false, reason: `steps 最多 ${LIMITS.steps} 项，每项最长 ${LIMITS.step} 字符` };
  const assumptions = raw.assumptions === undefined ? [] : raw.assumptions;
  if (!stringList(assumptions, LIMITS.assumptions, LIMITS.assumption)) return { ok: false, reason: `assumptions 最多 ${LIMITS.assumptions} 项，每项最长 ${LIMITS.assumption} 字符` };
  const cautions = raw.cautions === undefined ? [] : raw.cautions;
  if (!stringList(cautions, LIMITS.cautions, LIMITS.caution)) return { ok: false, reason: `cautions 最多 ${LIMITS.cautions} 项，每项最长 ${LIMITS.caution} 字符` };

  return {
    ok: true,
    args: {
      code: raw.code,
      approach: raw.approach,
      steps: steps.map(item => item.trim()),
      assumptions: assumptions.map(item => item.trim()),
      timeComplexity: raw.timeComplexity,
      spaceComplexity: raw.spaceComplexity,
      cautions: cautions.map(item => item.trim()),
    },
  };
}

/** Trim an observation to a bounded size without splitting a JSON string. */
export function boundedObservation(value, maxBytes = LIMITS.observationBytes) {
  let json = JSON.stringify(value);
  if (json.length <= maxBytes) return json;
  // Drop per-case payloads first; keep the verdict counts, which is what the
  // model actually needs to decide what to fix.
  if (Array.isArray(value?.results)) {
    json = JSON.stringify({ ...value, results: value.results.map(r => ({ status: r.status })), truncated: true });
    if (json.length <= maxBytes) return json;
  }
  return JSON.stringify({ status: value?.status ?? 'unknown', truncated: true });
}
