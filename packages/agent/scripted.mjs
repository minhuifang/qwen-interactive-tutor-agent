// Deterministic collaborators for tests and for the recorded demo trace.
// The simulated runner never evaluates code: it replays pre-declared verdicts,
// so nothing in this file can execute model output in the host process.

/**
 * @param {{thought?: string, calls: {name: string, arguments: object|string}[]}[]} rounds
 */
export function createScriptedModel(rounds, { usagePerCall = 480 } = {}) {
  let index = 0;
  const model = async () => {
    const round = rounds[Math.min(index, rounds.length - 1)];
    index += 1;
    if (!round) return { content: '', toolCalls: [] };
    return {
      content: round.thought || '',
      toolCalls: round.calls.map((call, i) => ({
        id: `scripted-${index}-${i}`,
        name: call.name,
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments),
      })),
      usage: { prompt_tokens: usagePerCall, completion_tokens: 120, total_tokens: usagePerCall + 120 },
    };
  };
  model.calls = () => index;
  return model;
}

/**
 * @param {({status: string, results: {status: string, actual?: unknown}[]} | Error)[]} script
 */
export function createSimulatedRunner(script) {
  let index = 0;
  const runner = async () => {
    const next = script[Math.min(index, script.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    if (!next) return { status: 'unavailable', results: [] };
    return { status: next.status, results: next.results.map(item => ({ ...item })) };
  };
  runner.calls = () => index;
  return runner;
}
