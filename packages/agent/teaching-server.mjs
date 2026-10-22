// HTTP glue for the teaching session: request validation, session reuse, and a
// write() callback that emits one NDJSON line per event.
//
// A teaching session is conversational, so it spans several requests. The server
// keeps them in memory for the lifetime of the dev server — single user, single
// machine, same trust assumptions as the runner middleware.

import { randomBytes } from 'node:crypto';
import { TeachingSession, supportsScripted, looksLikeFullSolution } from './teaching.mjs';
import { createChatModel, createChatStream } from './model.mjs';
import { readModelConfig } from './env.mjs';

export class TeachRequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const MAX_SESSIONS = 8;
const sessions = new Map();

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export function parseTeachRequest(raw) {
  if (!isPlainObject(raw)) throw new TeachRequestError('请求必须是 JSON 对象。');
  const unknown = Object.keys(raw).filter(key => !['problem', 'mode', 'action', 'sessionId', 'step', 'level', 'question'].includes(key));
  if (unknown.length) throw new TeachRequestError('请求包含不支持的字段。');

  const problem = raw.problem;
  if (!isPlainObject(problem)) throw new TeachRequestError('缺少题目信息。');
  const statement = typeof problem.statement === 'string' ? problem.statement.trim() : '';
  if (!statement) throw new TeachRequestError('请先填写题目原文。');
  if (statement.length > 6000) throw new TeachRequestError('题目最长 6000 字符。');
  const title = (typeof problem.title === 'string' && problem.title.trim()) || statement.slice(0, 40);
  if (title.length > 200) throw new TeachRequestError('标题最长 200 字符。');
  const inputContract = typeof problem.inputContract === 'string' ? problem.inputContract.trim().slice(0, 1500) : '';

  const mode = raw.mode === undefined ? 'guide' : raw.mode;
  if (mode !== 'guide' && mode !== 'explain') throw new TeachRequestError('教学模式只能是 guide 或 explain。');

  const action = raw.action;
  if (!['plan', 'teach', 'hint', 'answer', 'reveal'].includes(action)) throw new TeachRequestError('未知的教学动作。');

  const step = raw.step === undefined ? 0 : raw.step;
  if (!Number.isInteger(step) || step < 0 || step > 11) throw new TeachRequestError('步骤序号不合法。');

  let level;
  if (action === 'hint') {
    level = raw.level === undefined ? 1 : raw.level;
    if (![1, 2, 3].includes(level)) throw new TeachRequestError('提示级别只能是 1、2 或 3。');
  }

  let question;
  if (action === 'answer') {
    question = typeof raw.question === 'string' ? raw.question.trim() : '';
    if (!question) throw new TeachRequestError('请先写下你的疑问。');
    if (question.length > 600) throw new TeachRequestError('疑问最长 600 字符。');
  }

  const sessionId = typeof raw.sessionId === 'string' && /^[a-f0-9]{16}$/.test(raw.sessionId) ? raw.sessionId : null;
  return { problem: { title, statement, inputContract }, mode, action, step, level, question, sessionId };
}

function remember(session) {
  const id = randomBytes(8).toString('hex');
  if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  sessions.set(id, session);
  return id;
}

/**
 * @param {object} options
 * @param {object} options.raw parsed JSON body
 * @param {(event: object) => void} options.write
 * @param {AbortSignal} [options.signal]
 * @param {(config: object) => Function} [options.modelFactory]
 */
export async function streamTeach({ raw, write, signal, modelFactory }) {
  const input = parseTeachRequest(raw);
  let callModel = null;
  let callStream = null;
  let model = '';
  if (typeof modelFactory === 'function') {
    callModel = modelFactory({ model: 'injected' });
    model = 'injected';
  } else {
    try {
      const config = readModelConfig();
      callModel = createChatModel(config);
      callStream = createChatStream(config);
      model = config.model;
    } catch {
      callModel = null; // scripted demo below
    }
  }

  let session = input.sessionId ? sessions.get(input.sessionId) : null;
  let sessionId = input.sessionId;
  if (!session || session.problem.statement !== input.problem.statement || session.mode !== input.mode) {
    if (!callModel && !supportsScripted(input.problem)) {
      throw new TeachRequestError('未配置模型密钥，且这道题没有内置脚本化演示。请先在 apps/web/.env.local 填写 DEEPSEEK_API_KEY。', 503);
    }
    session = new TeachingSession({ problem: input.problem, mode: input.mode, callModel, callStream, model });
    sessionId = remember(session);
  } else if (callModel && session.scripted) {
    // A key appeared mid-session: upgrade rather than keep replaying a script.
    session.callModel = callModel;
    session.callStream = callStream;
    session.model = model;
    session.kind = 'live';
  }

  write({ type: 'meta', sessionId, kind: session.kind, mode: session.mode, model: session.model || '', action: input.action });

  if (input.action === 'plan') {
    const steps = await session.plan();
    write({ type: 'plan', steps });
    write({ type: 'resume', index: session.currentStep });
    return;
  }

  if (input.action === 'teach') {
    const step = await session.stepAt(input.step);
    write({ type: 'step_start', index: step.index });
    let collected = '';
    for await (const piece of session.teachStep(step.index, { signal })) {
      if (signal?.aborted) return;
      if (typeof piece === 'string') { collected += piece; write({ type: 'delta', text: piece }); }
      else if (piece?.ask) write({ type: 'ask', index: step.index, text: piece.ask });
    }
    if (session.mode === 'guide' && looksLikeFullSolution(collected)) {
      write({ type: 'notice', message: '模型在这一步直接给出了完整实现，与引导模式的约定不符。这是模型行为，不是产品意图。' });
    }
    write({ type: 'step_end', index: step.index });
    write({ type: 'resume', index: session.currentStep });
    return;
  }

  if (input.action === 'hint') {
    const step = await session.stepAt(input.step);
    write({ type: 'hint_start', index: step.index, level: session.hints.get(step.index) || 0 });
    for await (const piece of session.hint(step.index, input.level, { signal })) {
      if (signal?.aborted) return;
      if (typeof piece === 'string') write({ type: 'hint_delta', text: piece });
    }
    write({ type: 'hint_end', index: step.index, level: session.hints.get(step.index) || 0 });
    write({ type: 'resume', index: session.currentStep });
    return;
  }

  if (input.action === 'answer') {
    const step = await session.stepAt(input.step);
    write({ type: 'answer_start', index: step.index, question: input.question });
    for await (const piece of session.answer(step.index, input.question, { signal })) {
      if (signal?.aborted) return;
      if (typeof piece === 'string') write({ type: 'answer_delta', text: piece });
    }
    write({ type: 'answer_end', index: step.index });
    write({ type: 'resume', index: session.currentStep, interrupted: true });
    return;
  }

  const step = await session.stepAt(input.step);
  if (session.scripted) {
    const payload = session.reveal(step.index);
    write({ type: 'reveal', index: step.index, code: payload.code, explanation: payload.explanation });
  } else {
    write({ type: 'reveal_start', index: step.index });
    for await (const piece of session.revealText(step.index, { signal })) {
      if (signal?.aborted) return;
      if (typeof piece === 'string') write({ type: 'reveal_delta', text: piece });
    }
    write({ type: 'reveal_end', index: step.index });
  }
  write({ type: 'resume', index: session.currentStep });
}
