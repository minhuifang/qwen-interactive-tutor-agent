'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { compileTeachingPlan, type GenerationResult } from '@/lib/teaching-plan';
import { lessons } from '@/lib/lessons';
import type { Lesson, LessonId } from '../../../packages/lesson-schema/src/index';

const responseSchema = z.object({
  source: z.literal('deepseek'), model: z.string(), cached: z.boolean(), objective: z.string(),
  stages: z.array(z.string()).max(10),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number(), total_tokens: z.number() }).nullable(),
  lesson: z.object({ id: z.string(), frames: z.array(z.object({ id: z.string(), title: z.string(), narration: z.string() })).length(6) }),
});

export function GenerationPanel({ lessonId, onGenerated, onReset }: {
  lessonId: LessonId; onGenerated: (lesson: Lesson) => void; onReset: () => void;
}) {
  const [config, setConfig] = useState<{ configured: boolean; message?: string; model?: string } | null>(null);
  const [style, setStyle] = useState<'beginner' | 'interview'>('beginner');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GenerationResult | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/lessons/generate', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('无法读取生成服务配置。');
        setConfig(await response.json());
      })
      .catch(() => { if (!controller.signal.aborted) setConfig({ configured: false, message: '无法连接生成服务，请检查本地服务后刷新。' }); });
    return () => { controller.abort(); active.current?.abort(); };
  }, []);

  async function generate() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true); setError('');
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetch('/api/lessons/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId, style }), signal: controller.signal,
      });
      const raw = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.object({ message: z.string() }) }).safeParse(raw);
        throw new Error(failure.success ? failure.data.error.message : '生成失败，原课件仍可使用。');
      }
      const data = responseSchema.parse(raw);
      // Validate the prose again and use client-owned algorithm state, never generated code.
      const canonical = lessons.find(l => l.id === lessonId)!;
      if (data.lesson?.id !== lessonId || data.source !== 'deepseek') throw new Error('返回的课件与当前题目不一致。');
      const { lesson } = compileTeachingPlan({
        objective: data.objective,
        steps: data.lesson.frames.map((frame: { id: string; title: string; narration: string }) => ({ id: frame.id, title: frame.title, narration: frame.narration })),
      }, canonical);
      if (controller.signal.aborted) return;
      onGenerated(lesson); setResult({ ...data, lesson });
    } catch (cause) {
      if (controller.signal.aborted) setError('已停止等待。服务端调用可能仍在结束中，原课件仍可使用。');
      else setError(cause instanceof Error ? cause.message : '生成失败，原课件仍可使用。');
    } finally {
      clearTimeout(timer); active.current = null; setPending(false);
    }
  }

  return <section className="generation-panel" aria-label="DeepSeek 课件生成" aria-busy={pending}>
    <div className="generation-heading"><strong>DeepSeek 教学工作流</strong><span>{result ? '正在使用 AI 讲解' : '正在使用固定课件'}</span></div>
    <p>为当前题目生成提纲与六步讲解。动画状态、参考代码和判题保持已验证版本。</p>
    <div className="generation-controls">
      <Button variant={style === 'beginner' ? 'secondary' : 'outline'} aria-pressed={style === 'beginner'} disabled={pending} onClick={() => setStyle('beginner')}>初学者讲解</Button>
      <Button variant={style === 'interview' ? 'secondary' : 'outline'} aria-pressed={style === 'interview'} disabled={pending} onClick={() => setStyle('interview')}>面试复习</Button>
      <Button disabled={pending || !config?.configured} onClick={generate}>{pending ? '生成并校验中…' : '用 DeepSeek 生成课件'}</Button>
      {result && <Button variant="ghost" disabled={pending} onClick={() => { onReset(); setResult(null); setError(''); }}>恢复固定课件</Button>}
    </div>
    <div className="generation-status" role="status">
      {!config ? '正在检查服务端配置…' : !config.configured ? config.message : `服务端模型：${config.model} · 单次输出上限 4096 Token · 不自动重试`}
      {pending && <p>正在请求 DeepSeek；收到结果后将校验并装配。原课件仍可操作，切换题目会停止本页等待。</p>}
      {error && <p className="generation-error">{error}</p>}
    </div>
    {result && <div className="generation-result"><strong>学习目标：{result.objective}</strong><p>{result.stages.join(' → ')}</p>
      <small>{result.cached ? '命中 10 分钟进程缓存，本次未调用模型。' : '本次由 DeepSeek 生成。'}{result.usage ? `${result.cached ? '原生成' : '本次'}用量：输入 ${result.usage.prompt_tokens} / 输出 ${result.usage.completion_tokens} / 合计 ${result.usage.total_tokens} Token。` : '服务商未返回完整用量。'} 校验保障结构和步骤映射，讲解准确性仍需人工复核。</small>
    </div>}
  </section>;
}
