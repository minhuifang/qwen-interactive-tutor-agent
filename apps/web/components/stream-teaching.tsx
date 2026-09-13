'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ProblemIntake } from '@/components/problem-intake';
import { SolutionPanel } from '@/components/solution-panel';
import { consumeTeaching } from '@/lib/teaching-stream';
import { useNarration } from '@/hooks/use-narration';

// Plain React text, never model HTML. Small Markdown subset; incomplete streaming blocks remain readable.
function Prose({ text }: { text: string }) {
  return <div style={{ overflowWrap: 'anywhere', lineHeight: 1.85, fontSize: '1rem' }}>{text.split(/\n\s*\n/).map((block, i) => {
    const lines = block.split('\n');
    if (/^#{1,4} /.test(block)) return <section key={i}><h3>{lines[0].replace(/^#+\s*/, '').replace(/\*\*/g, '')}</h3>{lines.length > 1 && <p style={{ whiteSpace: 'pre-wrap' }}>{lines.slice(1).join('\n')}</p>}</section>;
    return <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{block.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((s,j) => s.startsWith('**') && s.endsWith('**') ? <strong key={j}>{s.slice(2,-2)}</strong> : s.startsWith('`') && s.endsWith('`') ? <code key={j}>{s.slice(1,-1)}</code> : s)}</p>;
  })}</div>;
}
function TeachingText({ text }: { text: string }) {
  return <>{text.split(/(```[\s\S]*?(?:```|$))/g).map((part,i) => part.startsWith('```')
    ? <pre key={i} style={{ overflowX: 'auto', whiteSpace: 'pre', padding: '1rem', background: '#f3f5f9', borderRadius: '.5rem', fontSize: '.875rem' }}><code>{part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre>
    : <Prose key={i} text={part} />)}</>;
}
function Listen({ text }: { text: string }) {
  const segments = text.replace(/```[\s\S]*?```/g, '（代码请参阅页面）').replace(/[#*`]/g, '').split(/\n\s*\n/).filter(s => s.trim());
  const [step, setStep] = useState(0); const [playing, setPlaying] = useState(false);
  const narration = useNarration(segments[step] || text, String(step), playing, () => { if (step + 1 < segments.length) setStep(s => s + 1); else setPlaying(false); }, () => setPlaying(false));
  return <div><div className="generation-controls"><Button onClick={() => { if (narration.error) narration.retry(); setPlaying(p => !p); }}>{playing ? '暂停收听' : '收听讲解（TTS 按段计费）'}</Button><Button variant="ghost" onClick={() => { setPlaying(false); setStep(0); narration.retry(); }}>从头收听</Button></div><p role="status">第 {step + 1} / {Math.max(1,segments.length)} 段 · {narration.status}</p>{narration.error && <p role="alert">{narration.error} 点击收听可重试。</p>}</div>;
}
type Turn = { id: number; question: string; content: string; state: 'streaming' | 'complete' | 'partial'; model: string; tokens?: number };
export function StreamTeaching({ visible = true }: { visible?: boolean }) {
  const [text, setText] = useState(''); const [followUp, setFollowUp] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const active = useRef<AbortController | null>(null); const sequence = useRef(0);
  function stop() {
    active.current?.abort(); active.current = null; setPending(false);
    setTurns(old => old.map(t => t.state === 'streaming' ? { ...t, state: 'partial' } : t));
  }
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { if (!visible) stop(); }, [visible]);
  async function teach(question = '') {
    if (active.current) return;
    const previous = turns.filter(t => t.content).map(t => `${t.question ? '用户补充：' + t.question + '\n' : ''}${t.content}`).join('\n\n').slice(-30000);
    const controller = new AbortController(); active.current = controller;
    const id = ++sequence.current;
    setPending(true); setError(''); setFollowUp(''); setCodeOpen(false);
    setTurns(old => [...old, { id, question, content: '', state: 'streaming', model: '' }]);
    const update = (patch: Partial<Turn>) => setTurns(old => old.map(t => t.id === id ? { ...t, ...patch } : t));
    const timer = setTimeout(() => controller.abort(), 100000);
    let content = '';
    try {
      const response = await fetch('/api/teach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...(question ? { followUp: question, previous } : {}) }), signal: controller.signal });
      if (!response.ok) {
        const raw = await response.json() as { error?: { message?: string } };
        throw new Error(raw.error?.message || '暂时无法开始讲解，请重试。');
      }
      if (!response.body) throw new Error('未收到讲解内容，请重试。');
      await consumeTeaching(response.body, event => {
        if (active.current !== controller || controller.signal.aborted) return;
        if (event.type === 'meta') update({ model: event.model });
        if (event.type === 'delta') { content += event.text; update({ content }); }
        if (event.type === 'done') update({ state: 'complete', tokens: event.usage?.total_tokens });
      });
    } catch (cause) {
      if (active.current === controller) {
        update({ state: 'partial' });
        setError(controller.signal.aborted ? '已停止等待，收到的讲解已保留。' : cause instanceof Error && cause.name !== 'ZodError' ? cause.message : '连接异常，已收到的讲解保留，请稍后重试。');
        if (question) setFollowUp(question);
      }
    } finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setPending(false); } }
  }
  return <section className="intake" aria-label="直接教学">
    <div className="intake-heading"><div><div className="eyebrow">算法互动课堂</div><h1>给我题目，开始讲解。</h1><p>先讲思路，再一步步推演。无需填写题意表单。</p></div></div>
    <section className="intake-card"><label htmlFor="teach-text">你想学哪道题？</label><Textarea id="teach-text" rows={7} maxLength={6000} value={text} onChange={e => { stop(); setText(e.target.value); setTurns([]); setError(''); setFollowUp(''); setCodeOpen(false); }} placeholder="粘贴题目即可。没有样例或范围，也可以先学习通用解法。" />
      <p className="intake-note">{text.length} / 6000。题目会发送至DeepSeek，请勿包含隐私或密钥。点击后直接讲解并逐段显示；不自动生成或执行代码。</p>
      <div className="generation-controls"><Button disabled={pending || !text.trim()} onClick={() => void teach()}>{pending ? '正在讲解…' : turns.length ? '重新讲解（消耗额度）' : '开始讲解'}</Button>{pending && <Button variant="outline" onClick={stop}>停止生成</Button>}</div>
      <p role="status">{pending ? '讲解正在逐段到达，可以边看边学。停止后保留已收到的内容。' : ''}</p>{error && <p role="alert" className="generation-error">{error}</p>}
    </section>
    {turns.map(t => <section className="intake-card" key={t.id} aria-label="题目讲解">{t.question && <p><strong>你的问题：</strong>{t.question}</p>}<h2>{t.question ? '继续讲解' : '思路与推演'}</h2>{t.content ? <TeachingText text={t.content} /> : <p>{t.state === 'streaming' ? '老师正在组织思路…' : '本次未收到讲解，可以重试。'}</p>}<p className="intake-note">{t.state === 'partial' ? '本段未完整生成，已保留收到的内容。' : t.state === 'streaming' ? '讲解中…' : '本段讲解结束。'} {t.model}{t.tokens !== undefined ? ` · ${t.tokens} Token` : ''} · AI 讲解，未运行验证。</p>{visible && !pending && t.id === turns[turns.length - 1]?.id && t.content && <Listen text={t.content} />}</section>)}
    {!!turns.length && <section className="intake-card"><label htmlFor="follow-up">哪里没听懂？也可以在这里回答老师的问题</label><Textarea id="follow-up" value={followUp} maxLength={1500} onChange={e => setFollowUp(e.target.value)} placeholder="例如：为什么排序后可以用双指针？请再用一组数据演示去重。" /><Button disabled={pending || !followUp.trim()} onClick={() => void teach(followUp)}>继续讲解（消耗额度）</Button></section>}
    <details onToggle={e => setCodeOpen(e.currentTarget.open)}><summary>可选：生成参考代码与运行样例</summary>{codeOpen && visible && !pending && !!text.trim() && <SolutionPanel key={text + turns.length} text={text} context={turns.map(t => `${t.question}\n${t.content}`).join("\n\n").slice(-30000)} />}</details>
    <details><summary>可选：手动整理题意与分阶段生成</summary><ProblemIntake /></details>
  </section>;
}
