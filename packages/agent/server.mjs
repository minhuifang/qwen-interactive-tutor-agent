// Glue between an HTTP request and the loop: request validation, model wiring,
// and a write() callback that emits one NDJSON line per event.

import { runAgent } from './loop.mjs';
import { createChatModel } from './model.mjs';
import { readModelConfig } from './env.mjs';

export class AgentRequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export function parseAgentRequest(raw) {
  if (!isPlainObject(raw)) throw new AgentRequestError('请求必须是 JSON 对象。');
  const keys = Object.keys(raw);
  const unknown = keys.filter(key => !['problem', 'cases', 'maxRounds'].includes(key));
  if (unknown.length) throw new AgentRequestError('请求包含不支持的字段。');

  const problem = raw.problem;
  if (!isPlainObject(problem)) throw new AgentRequestError('缺少题目信息。');
  const statement = typeof problem.statement === 'string' ? problem.statement.trim() : '';
  if (!statement) throw new AgentRequestError('请先填写题目原文。');
  if (statement.length > 6000) throw new AgentRequestError('题目最长 6000 字符。');
  const title = (typeof problem.title === 'string' && problem.title.trim()) || statement.slice(0, 40);
  if (title.length > 200) throw new AgentRequestError('标题最长 200 字符。');
  const inputContract = typeof problem.inputContract === 'string' ? problem.inputContract.trim().slice(0, 1500) : '';

  if (!Array.isArray(raw.cases) || raw.cases.length < 1 || raw.cases.length > 8) throw new AgentRequestError('请提供 1–8 个已核对的样例。');
  const cases = raw.cases.map((item, index) => {
    if (!isPlainObject(item) || !Object.hasOwn(item, 'input') || !Object.hasOwn(item, 'expected')) throw new AgentRequestError(`样例 ${index + 1} 需要 input 与 expected。`);
    const extra = Object.keys(item).filter(key => !['input', 'expected'].includes(key));
    if (extra.length) throw new AgentRequestError(`样例 ${index + 1} 含不支持字段。`);
    if (JSON.stringify(item).length > 8000) throw new AgentRequestError(`样例 ${index + 1} 过大。`);
    return { input: item.input, expected: item.expected };
  });

  const maxRounds = raw.maxRounds === undefined ? 4 : raw.maxRounds;
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 6) throw new AgentRequestError('maxRounds 需为 1–6 的整数。');

  return { problem: { title, statement, inputContract }, cases, maxRounds };
}

/**
 * @param {object} options
 * @param {object} options.raw         parsed JSON body
 * @param {(event: object) => void} options.write
 * @param {AbortSignal} [options.signal]
 * @param {(job: object, opts: object) => Promise<object>} options.runTests
 * @param {(config: object) => Function} [options.modelFactory]
 */
export async function streamAgentRun({ raw, write, signal, runTests, modelFactory }) {
  const input = parseAgentRequest(raw);
  const injected = typeof modelFactory === 'function';
  let config;
  if (injected) {
    config = { model: 'injected' };
  } else {
    try {
      config = readModelConfig();
    } catch (error) {
      throw new AgentRequestError(error?.message || '模型未配置。', 503);
    }
  }
  const callModel = injected ? modelFactory(config) : createChatModel(config);
  return runAgent({
    problem: input.problem,
    cases: input.cases,
    maxRounds: input.maxRounds,
    callModel,
    runTests,
    emit: write,
    signal,
    model: config.model,
    mode: 'live',
  });
}
