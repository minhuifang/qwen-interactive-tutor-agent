'use client';

import { useState } from 'react';
import { useNarration } from '@/hooks/use-narration';
import { ArrowLeft, ArrowRight, Check, Code2, ExternalLink, Pause, Play, RotateCcw, Sparkles, BookOpen, Hash, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GenerationPanel } from '@/components/generation-panel';
import { StreamTeaching } from '@/components/stream-teaching';
import { AgentStudio } from '@/components/agent-studio';
import { lessons } from '@/lib/lessons';
import { evaluateAnswer } from '../../../packages/lesson-schema/src/assessment';
import type { Diagnosis, LessonId, Lesson } from '../../../packages/lesson-schema/src/index';

export default function Home() {
  const [mode, setMode] = useState<'agent' | 'intake' | 'lessons'>('agent');
  const [lessonId, setLessonId] = useState<LessonId>('two-sum');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [answer, setAnswer] = useState('');
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [completed, setCompleted] = useState<LessonId[]>([]);
  const [generatedLesson, setGeneratedLesson] = useState<Lesson | null>(null);
  const lesson=generatedLesson ?? lessons.find(l=>l.id===lessonId)!;
  const frame=lesson.frames[step];
  const isLast=step===lesson.frames.length-1;

  const narration = useNarration(frame.narration, `${mode}:${lessonId}:${step}`, playing,
    () => { if (isLast) setPlaying(false); else setStep(s => s + 1); },
    () => setPlaying(false));

  function selectLesson(id: LessonId) {
    if (id === lessonId) return;
    setGeneratedLesson(null);
    setLessonId(id); setStep(0); setPlaying(false); setAnswer(''); setDiagnosis(null); setAttempts(0); setReviewing(false);
  }
  function navigate(next: number) { setPlaying(false); narration.retry(); setStep(Math.max(0,Math.min(lesson.frames.length-1,next))); }
  function submit() {
    const feedback=evaluateAnswer(lessonId,answer);
    setDiagnosis(feedback); setPlaying(false); setReviewing(false);
    if(feedback.status!=='invalid') setAttempts(n=>n+1);
    if(feedback.status==='correct') setCompleted(ids=>ids.includes(lessonId)?ids:[...ids,lessonId]);
  }

  return <main className="studio">
    <header className="topbar">
      <a href="/" className="brand"><span className="brand-icon"><Code2 size={23}/></span><span>Algo<span className="brand-light">Studio</span></span></a>
      <span className="top-note">算法互动课堂 / JavaScript</span>
      <span className="prototype"><span/> 本地教学演示</span>
    </header>
    <nav className="mode-switch" aria-label="工作区">
      <Button variant={mode === 'agent' ? 'secondary' : 'ghost'} aria-pressed={mode === 'agent'} onClick={() => { setMode('agent'); setPlaying(false); }}>Agent 解题</Button>
      <Button variant={mode === 'intake' ? 'secondary' : 'ghost'} aria-pressed={mode === 'intake'} onClick={() => { setMode('intake'); setPlaying(false); }}>直接讲题</Button>
      <Button variant={mode === 'lessons' ? 'secondary' : 'ghost'} aria-pressed={mode === 'lessons'} onClick={() => setMode('lessons')}>两道示例课件</Button>
      <span>Agent 自己跑测试直到通过；讲题与课件负责把思路讲清楚</span>
    </nav>
    <div hidden={mode !== 'agent'}><AgentStudio visible={mode === 'agent'} /></div>
    <div hidden={mode !== 'intake'}><StreamTeaching visible={mode === 'intake'} /></div>
    <div className="workspace" hidden={mode !== 'lessons'}>
      <aside className="catalog">
        <div className="section-label">学习路径 <span>01 — 02</span></div>
        <h1>把算法，<br/>一步步看明白。</h1>
        <p className="catalog-intro">从两道 Hot 100 经典题开始，观察状态变化，再检验你的理解。</p>
        <nav aria-label="选择算法题" className="lesson-list">{lessons.map((l,i)=><button key={l.id} onClick={()=>selectLesson(l.id)} aria-current={l.id===lessonId?'page':undefined} className={'lesson-item '+(l.id===lessonId?'selected':'')}>
          <span className="lesson-no">0{i+1}</span><span><strong>{l.title}</strong><small>{l.technique} <span>·</span> {l.difficulty}</small></span>{completed.includes(l.id)?<Check size={16} className="done-icon"/>:<ArrowRight size={16}/>}
        </button>)}</nav>
        <div className="catalog-bottom"><div className="progress-copy"><span>检查点已通过</span><strong>{completed.length} / 2</strong></div><div className="progress-track"><i style={{width:completed.length*50+'%'}}/></div><p>两道示例支持动画与配音。新题使用“直接讲题”，可阅读或收听步骤讲解，并选择运行验证；新题算法动画尚未接入。刷新后进度重置。</p></div>
      </aside>
      <section className="lesson-space" aria-label="算法课件">
        <div className="lesson-heading"><div><div className="eyebrow">LEETCODE #{lesson.number} <span> / </span> HOT 100</div><h2>{lesson.title}</h2></div><a className="source-link" href={lesson.source} target="_blank" rel="noreferrer">查看原题 <ExternalLink size={14}/></a></div>
        <div className="problem"><span className={'difficulty '+(lesson.difficulty==='简单'?'easy':'medium')}>{lesson.difficulty}</span><span className="topic">{lesson.technique}</span><p>{lesson.problem}</p><code>{lesson.inputLabel}</code></div>
        <GenerationPanel key={lessonId} lessonId={lessonId}
          onGenerated={next => { setGeneratedLesson(next); navigate(0); setReviewing(false); }}
          onReset={() => { setGeneratedLesson(null); navigate(0); setReviewing(false); }} />
        <div className="learning-grid">
          <div className="demonstration">
            <section className="visual-card" aria-label="算法状态动画">
              <div className="panel-heading"><span>{lessonId==='two-sum'?<Hash size={17}/>:<ScanLine size={17}/>} 观察算法</span><span className="step-count">步骤 {step+1} / {lesson.frames.length}</span></div>
              <div className="visual-body">
                <div className="variable-row">{Object.entries(frame.variables).map(([name,value])=><span key={name}><small>{name}</small><strong>{value}</strong></span>)}</div>
                <div className="array-row">{lesson.values.map((value,i)=><div key={i} className={'array-item '+(frame.active.includes(i)?'active ':'')+(frame.matched.includes(i)?'matched ':'')+(i===frame.current?'current':'')}>
                  <div className="pointer">{i===frame.current?(lessonId==='two-sum'?'i ↓':'right ↓'):'\u00a0'}</div><div className="array-cell">{value}</div><span className="index">{i}</span>{lessonId==='longest-substring'&&i===frame.variables.left&&<small className="left-pointer">↑ left</small>}
                </div>)}</div>
                <div className="map-panel"><span className="map-label">{lessonId==='two-sum'?'seen':'last'} <small>Map · {lessonId==='two-sum'?'数值 → 下标':'字符 → 最近下标'}</small></span><div className="map-entries">{frame.entries.length?frame.entries.map(([k,v])=><span key={k}>{k}<i>→</i>{v}</span>):<em>空 Map，等待记录</em>}</div></div>
              </div>
              <div className="formula" aria-label="当前推导">{frame.formula}</div>
              <div className="timeline"><div className="timeline-dots">{lesson.frames.map((f,i)=><button key={f.id} onClick={()=>navigate(i)} aria-label={'步骤 '+(i+1)+'：'+f.title} aria-current={i===step?'step':undefined} className={i<=step?'past':''}/>)}</div><div className="player-controls"><Button variant="ghost" size="icon" aria-label="重新开始讲解" onClick={()=>{navigate(0);setReviewing(false);}}><RotateCcw/></Button><Button variant="outline" size="icon" aria-label="上一步" disabled={!step} onClick={()=>navigate(step-1)}><ArrowLeft/></Button><Button className="play-button" onClick={()=>{if(narration.error) narration.retry();setPlaying(p=>!p);}}>{playing?<Pause/>:<Play/>}{playing?'暂停':'播放讲解'}</Button><Button variant="outline" size="icon" aria-label="下一步" disabled={isLast} onClick={()=>navigate(step+1)}><ArrowRight/></Button><small>百炼 TTS · 逐步配音</small></div><p role="status">{narration.status}</p>{narration.error&&<div role="alert"><p>{narration.error}</p><Button variant="outline" onClick={()=>{narration.retry();setPlaying(true);}}>重试语音</Button></div>}</div>
            </section>
            <section className="narration" aria-live="polite"><span className="tutor-avatar"><Sparkles size={19}/></span><div><div className="narration-label">本步讲解</div><h3>{frame.title}</h3><p>{frame.narration}</p></div></section>
            <details className="code-panel"><summary><span><Code2 size={18}/> JavaScript 参考实现</span><span>展开代码</span></summary><div className="code-lines">{lesson.code.split('\n').map((line,i)=><div className={i+1===frame.codeLine?'highlight-line':''} key={i}><span>{i+1}</span><code>{line||' '}</code></div>)}</div><p className="complexity">{lesson.complexity}</p></details>
          </div>
          <aside className="practice">
            <div className="panel-heading"><span><BookOpen size={17}/> 到你了</span><span className="practice-tag">检查点</span></div>
            <div className="practice-body"><h3>不急着写代码，<br/>先验证你的理解。</h3><p className="question" id="checkpoint-question">{lesson.checkpoint.prompt}</p>
              <form onSubmit={e=>{e.preventDefault();submit();}}><label htmlFor="answer">你的答案</label><Input id="answer" aria-describedby="answer-help" aria-invalid={diagnosis?.status==='invalid'} maxLength={200} value={answer} onChange={e=>{setAnswer(e.target.value);setDiagnosis(null);setReviewing(false);}} placeholder={lesson.checkpoint.placeholder} autoComplete="off"/><p id="answer-help" className="help">{lesson.checkpoint.explanation}</p><Button type="submit" className="submit-answer" disabled={!answer.trim()}>检验答案 <ArrowRight size={16}/></Button></form>
              {diagnosis&&<section key={attempts+'-'+diagnosis.errorType} role="status" className={'feedback '+diagnosis.status}>
                {diagnosis.status==='correct'&&<div className="celebration" aria-hidden="true">{Array.from({length:12},(_,i)=><i key={i} style={{left:i*8+'%',animationDelay:i*.035+'s',background:['#1ccca4','#7695ff','#f9c75b'][i%3]}}/>)}</div>}
                <h4>{diagnosis.status==='correct'?<Check size={19}/>:<Sparkles size={18}/>} {diagnosis.title}</h4><p>{diagnosis.feedback}</p>
                {diagnosis.status==='incorrect'&&<Button variant="outline" className="review-button" onClick={()=>{navigate(diagnosis.reviewFrame);setReviewing(true);}}>针对这个误区，再讲一次</Button>}
                {diagnosis.status==='correct'&&<p className="success-note">{diagnosis.remediation[0]}</p>}
              </section>}
              {reviewing&&diagnosis&&<section className="remediation"><h4>换个角度理解</h4><ol>{diagnosis.remediation.map(item=><li key={item}>{item}</li>)}</ol><p>左侧已定位到相关步骤，看完后可以修改答案再试一次。</p></section>}
              <div className="attempts">{attempts?'本题已作答 '+attempts+' 次':'可以多次尝试，每一次都是进步。'}</div>
            </div>
            <div className="practice-footer">本版检验的是步骤答案，暂不执行提交的代码。</div>
          </aside>
        </div>
        <footer className="lesson-footer">自编讲解与演示 · 题目来源 LeetCode Hot 100 <span>用 JavaScript 理解算法</span></footer>
      </section>
    </div>
  </main>;
}
