// Client transport for the teaching endpoint. Same NDJSON framing as the agent
// stream, and the same rule: unknown or malformed lines are dropped rather than
// allowed to break the view.

export type TeachStep = { index: number; title: string; goal: string };

export type TeachEvent =
  | { type: 'meta'; sessionId: string; kind: 'live' | 'scripted'; mode: string; model: string; action: string }
  | { type: 'plan'; steps: TeachStep[] }
  | { type: 'step_start'; index: number }
  | { type: 'delta'; text: string }
  | { type: 'ask'; index: number; text: string }
  | { type: 'step_end'; index: number }
  | { type: 'hint_start'; index: number; level: number }
  | { type: 'hint_delta'; text: string }
  | { type: 'hint_end'; index: number; level: number }
  | { type: 'answer_start'; index: number; question: string }
  | { type: 'answer_delta'; text: string }
  | { type: 'answer_end'; index: number }
  | { type: 'reveal'; index: number; code: string; explanation: string }
  | { type: 'reveal_start'; index: number }
  | { type: 'reveal_delta'; text: string }
  | { type: 'reveal_end'; index: number }
  | { type: 'notice'; message: string }
  | { type: 'resume'; index: number; interrupted?: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' };

const TYPES = new Set(['meta', 'plan', 'step_start', 'delta', 'ask', 'step_end', 'hint_start', 'hint_delta', 'hint_end', 'answer_start', 'answer_delta', 'answer_end', 'reveal', 'reveal_start', 'reveal_delta', 'reveal_end', 'notice', 'resume', 'error', 'done']);

const isIndex = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 12;

/** Structural gate: drop unknown shapes instead of letting them reach the view. */
export function parseTeachEvent(line: string): TeachEvent | null {
  if (!line.trim() || line.length > 65536) return null;
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (typeof event.type !== 'string' || !TYPES.has(event.type)) return null;
  if ('index' in event && !isIndex(event.index)) return null;
  if ((event.type === 'delta' || event.type === 'hint_delta' || event.type === 'answer_delta' || event.type === 'reveal_delta') && typeof event.text !== 'string') return null;
  if (event.type === 'plan' && !Array.isArray(event.steps)) return null;
  return value as TeachEvent;
}

export class TeachHttpError extends Error {}

export async function consumeTeach(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TeachEvent) => void,
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
      if (bytes > 2_000_000) throw new TeachHttpError('讲解内容超出上限，已停止显示。');
      pending += decoder.decode(value, { stream: true });
      let end = pending.indexOf('\n');
      while (end >= 0) {
        const event = parseTeachEvent(pending.slice(0, end).replace(/\r$/, ''));
        pending = pending.slice(end + 1);
        if (event) {
          onEvent(event);
          if (event.type === 'done') { finished = true; return; }
        }
        end = pending.indexOf('\n');
      }
      if (pending.length > 65536) throw new TeachHttpError('单行内容过长，已停止显示。');
    }
    if (pending.trim()) {
      const event = parseTeachEvent(pending);
      if (event) { onEvent(event); if (event.type === 'done') finished = true; }
    }
    if (!finished && !signal?.aborted) onEvent({ type: 'error', message: '连接提前结束，已收到的讲解保留。' });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export type TeachRequest = {
  problem: { title: string; statement: string; inputContract?: string };
  mode: 'guide' | 'explain';
  action: 'plan' | 'teach' | 'hint' | 'answer' | 'reveal';
  step?: number;
  level?: number;
  question?: string;
  sessionId?: string | null;
};

/** The local runner is dev-only, so a failure here is expected on a deployed build. */
export async function postTeach(input: TeachRequest, signal: AbortSignal): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'X-Tutor-Local': '1' };
  const session = await fetch('/api/local-runner/session', { method: 'POST', headers, body: '{}', signal });
  if (!session.ok) throw new TeachHttpError('本地教学接口不可用：请用 pnpm dev 启动本地服务后访问 localhost:3001。');
  const token = (await session.json() as { token?: string }).token;
  if (!token) throw new TeachHttpError('本地会话创建失败，请刷新页面重试。');
  const response = await fetch('/api/local-runner/teach', {
    method: 'POST',
    headers: { ...headers, 'X-Tutor-Runner-Token': token },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const raw = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new TeachHttpError(raw?.error?.message || `教学接口返回 ${response.status}。`);
  }
  if (!response.body) throw new TeachHttpError('未收到讲解内容。');
  return response;
}
