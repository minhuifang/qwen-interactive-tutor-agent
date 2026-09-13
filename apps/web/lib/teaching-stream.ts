import { z } from 'zod';
export const teachingInput = z.object({ text: z.string().trim().min(1).max(6000), followUp: z.string().trim().max(1500).optional(), previous: z.string().max(30000).optional() }).strict();
const usage = z.object({ prompt_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative(), total_tokens: z.number().nonnegative() });
export const teachingEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('meta'), model: z.string() }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('done'), usage: usage.nullable() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type TeachingEvent = z.infer<typeof teachingEvent>;
/** Transport chunks can split UTF-8 characters, SSE frames and JSON lines. */
export async function* streamLines(body: ReadableStream<Uint8Array>, maxBytes = 2_000_000) {
  const reader = body.getReader(); const decoder = new TextDecoder();
  let pending = '', bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { pending += decoder.decode(); break; }
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('STREAM_LIMIT');
      pending += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, '');
        if (line.length > 65536) throw new Error('STREAM_LIMIT');
        pending = pending.slice(end + 1); yield line;
      }
      if (pending.length > 65536) throw new Error('STREAM_LIMIT');
    }
    if (pending) yield pending.replace(/\r$/, '');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function* sseData(body: ReadableStream<Uint8Array>) {
  let data: string[] = [], length = 0;
  for await (const line of streamLines(body)) {
    if (line === '') { if (data.length) yield data.join('\n'); data = []; length = 0; }
    else if (line.startsWith('data:')) {
      const value = line.slice(5).replace(/^ /, ''); length += value.length;
      if (length > 65536) throw new Error('STREAM_LIMIT');
      data.push(value);
    }
  }
  if (data.length) yield data.join('\n');
}
export async function consumeTeaching(body: ReadableStream<Uint8Array>, onEvent: (event: TeachingEvent) => void) {
  let complete = false;
  for await (const line of streamLines(body)) {
    if (!line.trim()) continue;
    const event = teachingEvent.parse(JSON.parse(line)); onEvent(event);
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'done') { complete = true; break; }
  }
  if (!complete) throw new Error('连接中断，已收到的讲解已保留。可以重试或补充提问。');
}
