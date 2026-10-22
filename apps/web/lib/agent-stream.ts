// Client-side transport for the agent endpoint. Plain NDJSON, one event per
// line, so a partial line at the end of a chunk is simply held until complete.

export type AgentCase = { input: unknown; expected: unknown };
export type AgentProblem = { title: string; statement: string; inputContract?: string };

export type CaseResult = { index: number; status: string; actual?: string };

export type AgentSolution = {
  code?: string;
  approach?: string;
  steps?: string[];
  assumptions?: string[];
  cautions?: string[];
  timeComplexity?: string;
  spaceComplexity?: string;
};

export type AgentEvent =
  | { type: 'meta'; runId: string; model: string; mode: 'live' | 'scripted'; maxRounds: number; caseCount: number; problem: { title: string; entrypoint: string }; sandbox?: string; note?: string }
  | { type: 'round_start'; round: number }
  | { type: 'round_end'; round: number; verdict: string }
  | { type: 'thought'; round: number; text: string }
  | { type: 'tool_call'; id: string; round: number; tool: string; args: Record<string, unknown>; code?: string; auto?: boolean; note?: string }
  | { type: 'tool_result'; id: string; round: number; status: string; passed: number; total: number; results: CaseResult[]; note?: string }
  | { type: 'final'; status: string; reason: string; solution: AgentSolution | null; verification: { status: string; passed: number; total: number; results: { status: string; actual?: unknown }[]; notice: string }; rounds: number; usage?: { total_tokens: number } | null; durationMs?: number }
  | { type: 'error'; message: string; recoverable?: boolean }
  | { type: 'done' };

const TYPES = new Set(['meta', 'round_start', 'round_end', 'thought', 'tool_call', 'tool_result', 'final', 'error', 'done']);
const CASE_STATUS = new Set(['passed', 'failed', 'timeout', 'runtime_error', 'output_limit', 'invalid_output', 'unavailable']);

export const CASE_LABELS: Record<string, string> = {
  passed: '通过',
  failed: '答案不符',
  timeout: '超时',
  runtime_error: '运行异常',
  output_limit: '输出超限',
  invalid_output: '输出无效',
  unavailable: '执行环境不可用',
};

export const FINAL_LABELS: Record<string, string> = {
  examples_passed: '已通过全部样例',
  not_passed: '未全部通过',
  not_run: '未验证',
  blocked: '被阻塞',
  cancelled: '已停止',
  round_limit: '达到轮次上限',
  budget_limit: '达到调用上限',
};

/** Structural gate: drop unknown shapes instead of letting them reach the view. */
export function parseAgentEvent(line: string): AgentEvent | null {
  if (!line.trim() || line.length > 65536) return null;
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (typeof event.type !== 'string' || !TYPES.has(event.type)) return null;
  if (event.type === 'tool_result') {
    if (!Array.isArray(event.results)) return null;
    if (!event.results.every(item => item && typeof item === 'object' && CASE_STATUS.has(String((item as CaseResult).status)))) return null;
  }
  if (event.type === 'final' && typeof event.status !== 'string') return null;
  return value as AgentEvent;
}

export type AgentRunInput = { problem: AgentProblem; cases: AgentCase[]; maxRounds: number };

export class AgentHttpError extends Error {}

/** Server-sent framing on top of NDJSON; resolves when `done` arrives. */
export async function consumeAgentStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let bytes = 0;
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new AgentHttpError('轨迹数据超出上限，已停止显示。');
      pending += decoder.decode(value, { stream: true });
      let end = pending.indexOf('\n');
      while (end >= 0) {
        const event = parseAgentEvent(pending.slice(0, end).replace(/\r$/, ''));
        pending = pending.slice(end + 1);
        if (event) {
          onEvent(event);
          if (event.type === 'done') { finished = true; return; }
        }
        end = pending.indexOf('\n');
      }
      if (pending.length > 65536) throw new AgentHttpError('单行事件过长，已停止显示。');
    }
    if (pending.trim()) {
      const event = parseAgentEvent(pending);
      if (event) { onEvent(event); if (event.type === 'done') finished = true; }
    }
    if (!finished && !signal?.aborted) onEvent({ type: 'error', message: '连接提前结束，已收到的事件保留。' });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Opens a run. The local runner is dev-only and bound to localhost:3001, so a
 * failure here is expected on a deployed build — the UI falls back to replay.
 */
export async function postAgentRun(input: AgentRunInput, signal: AbortSignal): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'X-Tutor-Local': '1' };
  const session = await fetch('/api/local-runner/session', { method: 'POST', headers, body: '{}', signal });
  if (!session.ok) throw new AgentHttpError('本地 Agent 接口不可用：请用 pnpm dev 启动本地服务后访问 localhost:3001。');
  const token = (await session.json() as { token?: string }).token;
  if (!token) throw new AgentHttpError('本地会话创建失败，请刷新页面重试。');
  const response = await fetch('/api/local-runner/agent', {
    method: 'POST',
    headers: { ...headers, 'X-Tutor-Runner-Token': token },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const raw = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new AgentHttpError(raw?.error?.message || `Agent 接口返回 ${response.status}。`);
  }
  if (!response.body) throw new AgentHttpError('未收到轨迹数据。');
  return response;
}
