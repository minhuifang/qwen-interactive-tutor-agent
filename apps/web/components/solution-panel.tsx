'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { solutionResultSchema, type SolutionResult } from '@/lib/solution-schema';
import type { confirmProblem } from '@/lib/problem-schema';
import { VerificationPanel } from '@/components/verification-panel';

export function SolutionPanel({ confirmed, text, context }: { confirmed?: ReturnType<typeof confirmProblem>; text?: string; context?: string }) {
  const [result, setResult] = useState<SolutionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function generate() {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setPending(true); setError('');
    const timer = setTimeout(() => controller.abort(), 100000);
    try {
      const response = await fetch('/api/solutions/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(confirmed ? { confirmed } : { text, context }), signal: controller.signal });
      const raw = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.object({ message: z.string() }) }).safeParse(raw);
        throw new Error(failure.success ? failure.data.error.message : '解法生成失败。');
      }
      const next = solutionResultSchema.parse(raw);
      if (!controller.signal.aborted) setResult(next);
    } catch (cause) {
      setError(controller.signal.aborted ? '已停止等待；服务端可能仍在结束请求，已有解法保留。' : cause instanceof Error ? cause.message : '解法生成失败。');
    } finally { clearTimeout(timer); active.current = null; setPending(false); }
  }
  return <section className="intake-card" aria-label="生成解法">
    <h2>{text ? '参考代码（可选）' : '03 / 生成解法草稿'}</h2>
    <p>仅点击后生成 JavaScript 参考代码，失败不影响上方讲解。运行代码仍需主动核对样例，不会自动执行。</p>
    <Button disabled={pending} onClick={generate}>{pending ? '正在生成参考代码…' : result ? '重新生成代码（消耗额度）' : '生成参考代码（消耗额度）'}</Button>
    <div role="status">{pending && <p>正在生成，修改题意会撤销本次结果。</p>}{error && <p className="generation-error">{error}</p>}</div>
    {result && <>
      <p className="intake-note">{result.model} · {result.usage ? `${result.usage.total_tokens} Token` : '用量未返回'}</p>
      <div className="intake-issues"><strong>解法草稿 · 生成不代表正确</strong><p>本地运行结果见下方“04 / 本地运行验证”；未点击运行的解法不算已验证。</p></div>
      <h3>解题思路</h3><p>{result.solution.approach}</p>
      <ol>{result.solution.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      <h3>输入约定</h3><p>{result.solution.inputContract}</p>
      <h3>参考代码</h3><pre style={{ overflowX: 'auto', maxHeight: '32rem', whiteSpace: 'pre', fontSize: '0.875rem' }}><code>{result.solution.code}</code></pre>
      <p>时间复杂度：{result.solution.timeComplexity}</p><p>空间复杂度：{result.solution.spaceComplexity}</p>
      <h3>额外假设</h3>{result.solution.assumptions.length ? <ul>{result.solution.assumptions.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p>模型未声明额外假设，仍需对照原题核对。</p>}
      {result.solution.cautions.length > 0 && <><h3>需要复核</h3><ul>{result.solution.cautions.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
      {!pending && <VerificationPanel key={JSON.stringify(result)} code={result.solution.code} examples={confirmed?.problem.examples ?? []} />}
    </>}
  </section>;
}
