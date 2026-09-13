'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ProblemIntake } from '@/components/problem-intake';
import { VerificationPanel } from '@/components/verification-panel';
import { teachingResultSchema, type TeachingResult } from '@/lib/teaching-schema';
import { useNarration } from '@/hooks/use-narration';

function TeachingContent({ data }: { data: Extract<TeachingResult, { status: 'ready' }> }) {
  const { solution } = data.result;
  const segments = [solution.approach, ...solution.steps];
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const narration = useNarration(segments[step], String(step), playing,
    () => { if (step + 1 < segments.length) setStep(s => s + 1); else setPlaying(false); }, () => setPlaying(false));
  return <section className="intake-card" aria-label="题目讲解">
    <h2>{data.draft.title}</h2><p className="intake-note">先理解思路，再看代码。以下为 AI 讲解，代码尚未运行。</p>
    <div className="generation-controls"><Button onClick={() => { if(narration.error) narration.retry(); setPlaying(p => !p); }}>{playing ? '暂停讲解' : '听讲解（TTS 按段计费）'}</Button><Button variant="ghost" onClick={() => { setPlaying(false); setStep(0); narration.retry(); }}>从头阅读 / 重播</Button></div>
    <p role="status">{narration.status}</p>{narration.error && <p role="alert">{narration.error} 点击“听讲解”重试。</p>}
    {segments.map((content, i) => <section key={i} style={{ borderLeft: step === i ? '3px solid #1ccca4' : '3px solid transparent', paddingLeft: '1rem', marginTop: '1.5rem' }}><h3>{i === 0 ? '核心思路' : `第 ${i} 步`}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{content}</p><Button variant="ghost" onClick={() => { setPlaying(false); setStep(i); narration.retry(); }}>定位到本段</Button></section>)}
    {!!solution.assumptions.length && <><h3>本讲解采用的假设</h3><ul>{solution.assumptions.map((s,i) => <li key={i}>{s}</li>)}</ul></>}
    {!!solution.cautions.length && <><h3>注意事项</h3><ul>{solution.cautions.map((s,i) => <li key={i}>{s}</li>)}</ul></>}
    <details><summary>查看参考代码、输入约定与复杂度</summary><p>{solution.inputContract}</p><pre style={{ overflowX: 'auto', whiteSpace: 'pre', fontSize: '.875rem' }}><code>{solution.code}</code></pre><p>时间：{solution.timeComplexity}；空间：{solution.spaceComplexity}</p></details>
    <details><summary>可选：核对样例并运行验证</summary><VerificationPanel code={solution.code} examples={data.draft.examples} /></details>
    <details><summary>系统对题意的理解与生成信息</summary><p>{data.draft.statement}</p><p>{data.draft.inputDescription}</p><p>{data.draft.outputDescription}</p><p>{data.result.model} · 解法生成{data.result.usage ? ` ${data.result.usage.total_tokens} Token（含格式修复，不含题意解析）` : '用量未返回'}</p><p>这是系统自动整理，不代表人工确认。理解有偏差时修改上方题目重讲。</p></details>
  </section>;
}

export function DirectTeaching({ visible = true }: { visible?: boolean }) {
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<TeachingResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { if (!visible) { active.current?.abort(); active.current = null; setPending(false); } }, [visible]);
  function cancel() { active.current?.abort(); active.current = null; setPending(false); }
  async function teach(nextText = text) {
    cancel();
    const controller = new AbortController(); active.current = controller;
    setPending(true); setError(''); setText(nextText); setRevision(n => n + 1);
    const timer = setTimeout(() => controller.abort(), 150000);
    try {
      const response = await fetch('/api/teach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: nextText }), signal: controller.signal });
      const raw = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(raw.error?.message || '讲解生成失败，请重试。');
      const data = teachingResultSchema.parse(raw);
      if (active.current === controller && !controller.signal.aborted) { setResult(data); setAnswer(''); }
    } catch (cause) {
      if (active.current === controller) setError(controller.signal.aborted ? '等待时间较长，已停止等待。题目保留，可稍后重试。' : cause instanceof Error && cause.name !== 'ZodError' ? cause.message : '讲解格式异常，不是题目输入错误，请重试讲解。');
    } finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setPending(false); } }
  }
  return <section className="intake" aria-label="直接教学">
    <div className="intake-heading"><div><div className="eyebrow">算法互动课堂</div><h1>给我题目，开始讲解。</h1><p>从核心思路到逐步推演，只有关键题意不明确时才向你提问。</p></div></div>
    <section className="intake-card"><label htmlFor="teach-text">你想学哪道题？</label><Textarea id="teach-text" rows={8} maxLength={6000} value={text} onChange={e => { cancel(); setText(e.target.value); setResult(null); setAnswer(''); setError(''); }} placeholder="粘贴题目即可，不必拆成输入、输出、约束表单。" />
      <p className="intake-note">{text.length} / 6000。题目会发送至DeepSeek，请勿包含隐私或密钥。一次开始会自动整理题意并生成讲解，格式异常最多额外修复一次，均消耗模型额度。</p>
      <div className="generation-controls"><Button disabled={pending || text.trim().length < 20} onClick={() => void teach()}>{pending ? '正在理解题目并准备讲解…' : error ? '重试讲解' : '开始讲解'}</Button>{pending && <Button variant="outline" onClick={cancel}>停止等待</Button>}</div>
      <div role="status">{pending && <p>无需确认表单。正在整理思路与推演，完整讲解可能需要 1～2 分钟；修改题目会撤销本次等待，不保证停止上游计费。</p>}</div>{error && <p role="alert" className="generation-error">{error}</p>}
    </section>
    {result?.status === 'clarification' && <section className="intake-card"><h2>还需要明确这一点</h2><p>这些信息会影响对题目的理解；直接补充说明即可，无需填写表单。</p><ul>{result.questions.map((q,i) => <li key={i}>{q}</li>)}</ul><label htmlFor="teach-answer">补充说明</label><Textarea id="teach-answer" value={answer} maxLength={1000} onChange={e => setAnswer(e.target.value)} /><Button disabled={pending || !answer.trim() || text.length + answer.length + 7 > 6000} onClick={() => { setResult(null); void teach(`${text}\n补充说明：${answer}`); }}>补充并继续讲解</Button></section>}
    {visible && !pending && result?.status === 'ready' && <TeachingContent key={revision} data={result} />}
    <details><summary>可选：手动整理题意与分阶段生成</summary><ProblemIntake /></details>
  </section>;
}
