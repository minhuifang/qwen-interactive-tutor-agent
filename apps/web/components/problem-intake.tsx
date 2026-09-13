'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { SolutionPanel } from '@/components/solution-panel';
import { confirmationIssues, confirmProblem, parsedProblemSchema, problemInputSchema, type ProblemDraft } from '@/lib/problem-schema';

const example = '题目：有效的括号\n给定一个只包含字符 ( ) [ ] { } 的字符串 s，判断括号是否合法。左括号必须由同类型的右括号闭合，且必须按正确顺序闭合。\n输入：字符串 s。输出：布尔值，合法为 true，否则为 false。\n样例：s = "()[]{}"，输出 true；s = "(]"，输出 false。\n约束：1 <= s.length <= 10000，s 仅由以上六种字符组成。';

export function ProblemIntake() {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<ProblemDraft | null>(null);
  const [source, setSource] = useState<'deepseek' | 'manual'>('manual');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [modelInfo, setModelInfo] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmed, setConfirmed] = useState<ReturnType<typeof confirmProblem> | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  function clearReview() { setAcknowledged(false); setConfirmed(null); }
  function changeText(value: string) { setText(value); setDraft(null); setError(''); setModelInfo(''); clearReview(); }
  function edit(patch: Partial<ProblemDraft>) { setDraft(current => current ? { ...current, ...patch } : null); clearReview(); }
  function manual() {
    const input = problemInputSchema.safeParse({ text });
    if (!input.success) { setError(input.error.issues[0].message); return; }
    setDraft({ title: '', statement: text.trim(), inputDescription: '', outputDescription: '', constraints: [], examples: [], missingInformation: [] });
    setSource('manual'); setModelInfo('手动整理，未调用 AI。'); setError(''); clearReview();
  }
  async function parse() {
    if (active.current) return;
    const input = problemInputSchema.safeParse({ text });
    if (!input.success) { setError(input.error.issues[0].message); return; }
    const controller = new AbortController(); active.current = controller;
    setPending(true); setError(''); clearReview();
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetch('/api/problems/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.data), signal: controller.signal });
      const raw = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.object({ message: z.string() }) }).safeParse(raw);
        throw new Error(failure.success ? failure.data.error.message : '解析失败，原文已保留。');
      }
      const result = parsedProblemSchema.parse(raw);
      if (controller.signal.aborted) return;
      setDraft(result.draft); setSource('deepseek');
      setModelInfo(`${result.model} · ${result.usage ? `本次 ${result.usage.total_tokens} Token` : '用量未返回'} · AI 草稿，尚未人工确认`);
    } catch (cause) {
      setError(controller.signal.aborted ? '已停止等待，服务端请求可能仍在结束中；原文已保留。' : cause instanceof Error ? cause.message : '解析失败，原文已保留。');
    } finally { clearTimeout(timer); active.current = null; setPending(false); }
  }
  const issues = draft ? confirmationIssues(draft) : [];
  return <section className="intake" aria-label="新题解析">
    <div className="intake-heading"><div><div className="eyebrow">新题工作流 / 第一步</div><h1>先把题目说清楚。</h1><p>粘贴你想学的算法题，整理输入、输出和边界，再确认题意。</p></div><span>文本输入 → 解析草稿 → 人工确认</span></div>
    <div className="intake-grid">
      <section className="intake-card"><h2>01 / 输入题目</h2><label htmlFor="problem-text">题目原文</label>
        <Textarea id="problem-text" rows={14} maxLength={6000} value={text} disabled={pending} onChange={e => changeText(e.target.value)} placeholder="粘贴题目描述、输入输出、样例和约束。当前支持文本，不支持图片、PDF 或链接抓取。" aria-describedby="problem-help" />
        <p id="problem-help" className="intake-note">{text.length} / 6000 字符。点击 AI 解析会将题目文本发送至已配置的DeepSeek模型，请勿粘贴密钥或隐私信息。</p>
        <div className="generation-controls"><Button disabled={pending || text.trim().length < 20} onClick={parse}>{pending ? '解析并校验中…' : '用 AI 解析题目'}</Button><Button variant="outline" disabled={pending || text.trim().length < 20} onClick={manual}>手动整理</Button><Button variant="ghost" disabled={pending || !!text} onClick={() => changeText(example)}>填入示例文本</Button></div>
        <p className="intake-note">“填入示例”仅演示输入格式，不限制题库。修改原文会清除旧草稿与确认状态；所有内容只保存在本页内存中，刷新会丢失。</p>
        <div role="status">{pending && <p>正在等待 DeepSeek 返回 JSON；不生成解法，也不执行任何代码。</p>}{error && <p className="generation-error">{error}</p>}</div>
      </section>
      <section className="intake-card" aria-label="核对解析草稿"><h2>02 / 核对题意</h2>
        {!draft ? <div className="intake-empty"><h3>解析结果会显示在这里</h3><p>AI 将整理题目描述、输入输出、约束和样例，并列出需要你补充的问题。</p><p>网络或密钥不可用时，可使用“手动整理”，不会冒充 AI 解析成功。</p></div> : <>
          <p className="intake-note">{modelInfo}</p>
          <fieldset disabled={pending} className="intake-fields">
            <label htmlFor="draft-title">题目标题</label><Input id="draft-title" value={draft.title} maxLength={120} onChange={e => edit({ title: e.target.value })} />
            <label htmlFor="draft-statement">题意描述</label><Textarea id="draft-statement" rows={4} maxLength={6000} value={draft.statement} onChange={e => edit({ statement: e.target.value })} />
            <label htmlFor="draft-input">输入数据与类型</label><Textarea id="draft-input" maxLength={1500} value={draft.inputDescription} onChange={e => edit({ inputDescription: e.target.value })} />
            <label htmlFor="draft-output">期望输出</label><Textarea id="draft-output" maxLength={1500} value={draft.outputDescription} onChange={e => edit({ outputDescription: e.target.value })} />
            <label htmlFor="draft-constraints">约束与边界（每行一条，未提供可留空）</label><Textarea id="draft-constraints" maxLength={6020} value={draft.constraints.join('\n')} onChange={e => edit({ constraints: e.target.value.split('\n') })} onBlur={() => edit({ constraints: draft.constraints.map(s => s.trim()).filter(Boolean) })} />
            <h3>样例（未提供可留空，不会自动计算答案）</h3>
            {draft.examples.map((item, i) => <div className="intake-example" key={i}><label htmlFor={`example-in-${i}`}>样例 {i + 1} 输入</label><Textarea id={`example-in-${i}`} maxLength={1000} value={item.input} onChange={e => edit({ examples: draft.examples.map((old, j) => i === j ? { ...old, input: e.target.value } : old) })} /><label htmlFor={`example-out-${i}`}>样例 {i + 1} 输出</label><Textarea id={`example-out-${i}`} maxLength={1000} value={item.output} onChange={e => edit({ examples: draft.examples.map((old, j) => i === j ? { ...old, output: e.target.value } : old) })} /><Button variant="ghost" onClick={() => edit({ examples: draft.examples.filter((_, j) => j !== i) })}>删除样例 {i + 1}</Button></div>)}
            <Button variant="outline" disabled={draft.examples.length >= 8} onClick={() => edit({ examples: [...draft.examples, { input: '', output: '' }] })}>添加样例</Button>
            <h3>需要澄清的问题</h3>
            {draft.missingInformation.length === 0 ? <p className="intake-note">无待处理问题，仍请对照原文核对。</p> : draft.missingInformation.map((question, i) => <div className="intake-question" key={i}><p>{question}</p><Button variant="outline" onClick={() => edit({ missingInformation: draft.missingInformation.filter((_, j) => j !== i) })}>已补充到上方字段 / 确认无需补充</Button></div>)}
            <p className="intake-note">先补充或修正相关字段，再处理澄清项。格式校验不代表语义正确，也不代表样例已经过运行验证。</p>
          </fieldset>
          {issues.length > 0 && <div className="intake-issues"><strong>确认前还需处理：</strong><ul>{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></div>}
          <label className="intake-ack"><Checkbox className="mt-1" checked={acknowledged} disabled={pending} onCheckedChange={checked => { setAcknowledged(checked); setConfirmed(null); }} />我已核对题意、样例及缺失约束，接受以上内容作为后续解题输入。</label>
          <Button disabled={pending || !acknowledged || issues.length > 0} onClick={() => { try { setConfirmed(confirmProblem(draft, text, source, acknowledged)); } catch (cause) { setError(cause instanceof Error ? cause.message : '请核对草稿。'); } }}>确认题意</Button>
          {confirmed && <div className="intake-confirmed" role="status"><strong>题意已确认</strong><p>来源：{confirmed.source === 'deepseek' ? 'AI 草稿，经人工核对' : '人工整理'}。可在下方生成解法草稿；修改题意将清除旧解法。</p><details><summary>查看确认后的 Problem JSON</summary><pre>{JSON.stringify(confirmed, null, 2)}</pre></details></div>}
        </>}
      </section>
    </div>
    {confirmed && <SolutionPanel key={JSON.stringify(confirmed)} confirmed={confirmed} />}
  </section>;
}
