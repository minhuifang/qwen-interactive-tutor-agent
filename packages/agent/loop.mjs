// The agent loop. Pure orchestration: no network, no child processes, no clock.
// Everything with side effects (model call, sandbox execution) is injected, so
// the same loop runs in the dev server, in tests with fakes, and in the eval
// harness with a real model.
//
// Invariant: the verdict shown to the user is always produced by the executor.
// A model can only ever *request* execution or *submit* code; it cannot declare
// success, and submitting code that was never executed triggers one final run.

import { hashCode } from './protocol.mjs';
import { validateArguments, boundedObservation } from './tools.mjs';
import { buildSystemPrompt, buildUserMessage, buildProtocolNudge } from './prompt.mjs';

const truncate = (value, max) => (typeof value === 'string' && value.length > max ? value.slice(0, max) : value);

function normalizeCall(call) {
  const name = typeof call?.name === 'string' ? call.name : '';
  let args = call?.arguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); }
    catch { return { name, id: call?.id, parseError: 'arguments 不是合法 JSON' }; }
  }
  return { name, id: call?.id, args };
}

/**
 * @param {object} options
 * @param {{title:string,statement:string,inputContract?:string}} options.problem
 * @param {{input:unknown,expected:unknown}[]} options.cases
 * @param {(messages: object[], opts: {signal?: AbortSignal}) => Promise<{content?:string, toolCalls?:object[], usage?:object}>} options.callModel
 * @param {(job: {code:string, cases:object[]}, opts:{signal?:AbortSignal}) => Promise<{status:string, results:object[]}>} options.runTests
 * @param {(event: object) => void} [options.emit]
 */
export async function runAgent({
  problem,
  cases,
  callModel,
  runTests,
  emit = () => {},
  signal,
  maxRounds = 4,
  maxModelCalls = 8,
  mode = 'live',
  model = 'unknown',
  runId = `run-${Date.now().toString(36)}`,
  entrypoint = 'solve',
  hash = hashCode,
} = {}) {
  const send = event => { try { emit(event); } catch { /* a broken listener must not abort the run */ } };
  const started = Date.now();

  const messages = [
    { role: 'system', content: buildSystemPrompt({ entrypoint, maxRounds }) },
    { role: 'user', content: buildUserMessage({ ...problem, cases }) },
  ];

  const totals = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 };
  let lastVerification = null;   // {status, passed, total, results, codeHash}
  let best = null;               // {code, verification} — most recent submitted candidate
  let sandboxFailures = 0;
  let rounds = 0;

  send({
    type: 'meta', runId, model, mode, maxRounds, caseCount: cases.length,
    problem: { title: truncate(problem.title, 200), entrypoint },
    startedAt: started,
  });

  const finishWith = (status, reason, extra = {}) => {
    const solution = extra.solution ?? (best ? { code: best.code } : null);
    // The verdict only applies to the code that was actually executed. If the
    // submitted code differs (for example the final verification could not run),
    // the run is reported as unverified rather than inheriting an older result.
    const verified = lastVerification && solution?.code && lastVerification.codeHash === hash(solution.code);
    const verification = verified
      ? {
          status: lastVerification.status,
          passed: lastVerification.passed,
          total: lastVerification.total,
          codeHash: lastVerification.codeHash,
          results: lastVerification.results.map(r => ({ status: r.status, actual: r.actual })),
          notice: '仅验证了已确认的人工核对样例，通过不代表所有输入都正确。',
        }
      : { status: 'not_run', passed: 0, total: cases.length, results: [], notice: '提交的代码未在隔离容器中执行过，结果标记为未验证。' };
    const finalStatus = verified ? status : (status === 'examples_passed' || status === 'not_passed' ? 'not_run' : status);
    const finalReason = verified ? reason : `${reason}（提交代码未被执行器验证）`;
    send({
      type: 'final', status: finalStatus, reason: finalReason,
      solution, verification, rounds, usage: totals.calls ? { ...totals } : null,
      durationMs: Date.now() - started,
    });
    return { status: finalStatus, reason: finalReason, solution, verification, rounds, usage: totals.calls ? { ...totals } : null };
  };

  const record = report => {
    const results = Array.isArray(report?.results) ? report.results : [];
    const passed = results.filter(item => item.status === 'passed').length;
    return {
      status: report?.status === 'examples_passed' ? 'examples_passed' : 'not_passed',
      passed, total: cases.length, results,
    };
  };

  const execute = async (code, round, id, note) => {
    let report;
    try {
      report = await runTests({ code, cases }, { signal });
    } catch (error) {
      report = { status: 'unavailable', results: [], message: error instanceof Error ? truncate(error.message, 200) : '执行器不可用' };
    }
    if (report?.status === 'unavailable') {
      sandboxFailures += 1;
      send({ type: 'tool_result', id, round, status: 'unavailable', passed: 0, total: cases.length, results: [], note: truncate(report.message || '隔离执行器不可用', 200) });
      return { status: 'unavailable', passed: 0, total: cases.length, results: [] };
    }
    sandboxFailures = 0;
    const verification = record(report);
    verification.codeHash = hash(code);
    lastVerification = verification;
    best = { code, verification };
    send({
      type: 'tool_result', id, round, status: verification.status,
      passed: verification.passed, total: verification.total,
      results: verification.results.map((r, index) => ({
        index: index + 1, status: r.status,
        actual: r.actual === undefined ? undefined : truncate(JSON.stringify(r.actual) ?? 'null', 400),
      })),
      note: note || '',
    });
    return verification;
  };

  for (let round = 1; round <= maxRounds; round++) {
    if (signal?.aborted) return finishWith('cancelled', '用户已停止，保留已完成的结果。');
    if (totals.calls >= maxModelCalls) return finishWith('budget_limit', `本任务已用满 ${maxModelCalls} 次模型调用，停止继续修改。`);
    rounds = round;
    send({ type: 'round_start', round });

    let response;
    totals.calls += 1;
    try {
      response = await callModel(messages, { signal, tools: true });
    } catch (error) {
      const message = error instanceof Error ? truncate(error.message, 300) : '模型调用失败';
      send({ type: 'error', message, recoverable: true });
      return finishWith('blocked', `模型调用失败：${message}`);
    }
    if (response?.usage) {
      for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
        if (Number.isFinite(response.usage[key])) totals[key] += response.usage[key];
      }
    }
    if (typeof response?.content === 'string' && response.content.trim()) {
      send({ type: 'thought', round, text: truncate(response.content.trim(), 4000) });
    }

    const calls = Array.isArray(response?.toolCalls) ? response.toolCalls : [];
    if (!calls.length) {
      send({ type: 'error', message: '模型没有调用工具，已提示其使用 run_tests 或 finish。', recoverable: true });
      messages.push({ role: 'assistant', content: response?.content || '' });
      messages.push({ role: 'user', content: buildProtocolNudge('没有调用任何工具') });
      send({ type: 'round_end', round, verdict: 'no_tool' });
      continue;
    }

    messages.push({
      role: 'assistant',
      content: response?.content || '',
      tool_calls: calls.map((call, index) => ({
        id: call?.id || `call-${round}-${index}`,
        type: 'function',
        function: { name: String(call?.name || ''), arguments: typeof call?.arguments === 'string' ? call.arguments : JSON.stringify(call?.arguments ?? {}) },
      })),
    });

    let verdict = 'submitted';
    for (const [index, rawCall] of calls.entries()) {
      const call = normalizeCall(rawCall);
      const id = call.id || `call-${round}-${index}`;
      if (call.parseError) {
        send({ type: 'tool_call', id, round, tool: String(call.name || 'unknown'), args: { invalid: true }, note: call.parseError });
        send({ type: 'tool_result', id, round, status: 'invalid_arguments', passed: 0, total: cases.length, results: [], note: call.parseError });
        messages.push({ role: 'tool', tool_call_id: id, content: boundedObservation({ status: 'invalid_arguments', reason: call.parseError }) });
        verdict = 'invalid_arguments';
        continue;
      }
      if (!['run_tests', 'finish'].includes(call.name)) {
        const reason = `未知工具 ${String(call.name).slice(0, 40)}`;
        send({ type: 'tool_call', id, round, tool: String(call.name || 'unknown').slice(0, 40), args: { invalid: true }, note: reason });
        send({ type: 'tool_result', id, round, status: 'invalid_arguments', passed: 0, total: cases.length, results: [], note: reason });
        messages.push({ role: 'tool', tool_call_id: id, content: boundedObservation({ status: 'invalid_arguments', reason }) });
        verdict = 'invalid_arguments';
        continue;
      }

      const validation = validateArguments(call.name, call.args);
      if (!validation.ok) {
        send({ type: 'tool_call', id, round, tool: call.name, args: { invalid: true }, note: validation.reason });
        send({ type: 'tool_result', id, round, status: 'invalid_arguments', passed: 0, total: cases.length, results: [], note: validation.reason });
        messages.push({ role: 'tool', tool_call_id: id, content: boundedObservation({ status: 'invalid_arguments', reason: validation.reason }) });
        verdict = 'invalid_arguments';
        continue;
      }

      if (call.name === 'run_tests') {
        const args = validation.args;
        send({ type: 'tool_call', id, round, tool: 'run_tests', args: { codeBytes: args.code.length, note: args.note }, code: args.code });
        const verification = await execute(args.code, round, id, args.note);
        verdict = verification.status === 'examples_passed' ? 'passed' : 'failed';
        messages.push({
          role: 'tool', tool_call_id: id,
          content: boundedObservation({
            status: verification.status, passed: verification.passed, total: verification.total,
            results: verification.results.map((r, i) => ({ index: i + 1, status: r.status, actual: r.actual })),
            notice: '这是隔离容器里的真实执行结果。只能依据它判断通过与否。',
          }),
        });
        if (verification.status === 'unavailable' && sandboxFailures >= 2) {
          send({ type: 'round_end', round, verdict });
          return finishWith('blocked', '隔离执行器连续不可用，已停止继续尝试。请检查本地 Docker 后重试。');
        }
        continue;
      }

      // finish
      const args = validation.args;
      send({
        type: 'tool_call', id, round, tool: 'finish',
        args: { codeBytes: args.code.length, approach: truncate(args.approach, 2000), steps: args.steps, cautions: args.cautions, timeComplexity: args.timeComplexity, spaceComplexity: args.spaceComplexity },
        code: args.code,
      });

      if (!lastVerification || lastVerification.codeHash !== hash(args.code)) {
        const verifyId = `${id}-verify`;
        send({ type: 'tool_call', id: verifyId, round, tool: 'run_tests', args: { codeBytes: args.code.length, note: '提交前自动验证（代码与上次执行的不一致）' }, code: args.code, auto: true });
        const verification = await execute(args.code, round, verifyId, '提交前自动验证');
        if (verification.status === 'unavailable') {
          send({ type: 'round_end', round, verdict: 'submitted' });
          return finishWith('blocked', '提交前自动验证失败：隔离执行器不可用。提交的代码未经验证。', { solution: args });
        }
      }
      send({ type: 'round_end', round, verdict: 'submitted' });
      return finishWith(
        lastVerification?.status ?? 'not_run',
        lastVerification?.status === 'examples_passed'
          ? `提交的代码通过了全部 ${lastVerification.passed} 个已确认样例。`
          : lastVerification
            ? `提交的代码未通过 ${lastVerification.total - lastVerification.passed} 个样例，结果如实展示。`
            : '代码未执行，结果标记为未验证。',
        { solution: args },
      );
    }
    send({ type: 'round_end', round, verdict });
  }

  return finishWith(
    lastVerification?.status ?? 'not_run',
    `已达到 ${maxRounds} 轮上限，返回最后一次执行结果。`,
  );
}
