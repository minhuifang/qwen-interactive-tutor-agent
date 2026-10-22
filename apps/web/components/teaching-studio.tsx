'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { consumeTeach, postTeach, parseTeachEvent, type TeachEvent, type TeachStep } from '@/lib/teach-stream';
import { ArrowRight, Eye, GraduationCap, Lightbulb, Mic, Play, RotateCcw, Send, Sparkles, Square, Volume2, VolumeX } from 'lucide-react';

type Bubble = {
  id: number;
  role: 'tutor' | 'student' | 'system';
  kind: 'teach' | 'ask' | 'hint' | 'answer' | 'reveal' | 'question' | 'note';
  step: number;
  text: string;
  code?: string;
};

type Status = 'idle' | 'teaching' | 'paused' | 'answering' | 'done';

const DEFAULT_STATEMENT =
  '给定一个整数数组 nums 和一个整数目标值 target，请你在该数组中找出和为目标值 target 的两个整数，并返回它们的数组下标。你可以假设每种输入只会对应一个答案，且不能重复使用同一个元素。';

type RecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

export function TeachingStudio({ visible = true }: { visible?: boolean }) {
  const [statement, setStatement] = useState(DEFAULT_STATEMENT);
  const [title, setTitle] = useState('两数之和');
  const [mode, setMode] = useState<'guide' | 'explain'>('guide');
  const [steps, setSteps] = useState<TeachStep[]>([]);
  const [current, setCurrent] = useState(0);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [runMode, setRunMode] = useState<'idle' | 'live' | 'replay'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState<'off' | 'in' | 'out' | 'both'>('off');
  const [voiceNote, setVoiceNote] = useState('');

  const active = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);
  const seq = useRef(0);
  const streaming = useRef<number | null>(null);
  const pendingSpeech = useRef('');
  const serverVoice = useRef<boolean | null>(null);
  const serverVoiceNoteShown = useRef(false);
  const autoPlayed = useRef(false);
  const speakEnabled = useRef(false);
  const recognition = useRef<RecognitionLike | null>(null);

  const nextId = () => (seq.current += 1);

  const addBubble = useCallback((bubble: Omit<Bubble, 'id'>) => {
    const id = nextId();
    setBubbles(old => [...old, { ...bubble, id }]);
    return id;
  }, []);

  const appendText = useCallback((text: string) => {
    pendingSpeech.current += text;
    setBubbles(old => old.map(item => (item.id === streaming.current ? { ...item, text: item.text + text } : item)));
  }, []);

  /**
   * Two-tier narration: the server voice (configured TTS) when it answers, else
   * the browser's built-in speech. Either way teaching works without a key.
   */
  const speakText = useCallback(async (text: string) => {
    if (!speakEnabled.current) return;
    const value = text.trim();
    if (!value) return;
    if (serverVoice.current !== false) {
      try {
        const response = await fetch('/api/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: value }),
        });
        const data = await response.json() as { url?: string; error?: { message?: string } };
        if (response.ok && data.url) {
          serverVoice.current = true;
          const audio = new Audio(data.url);
          audio.onended = () => setSpeaking(false);
          setSpeaking(true);
          await audio.play();
          if (!serverVoiceNoteShown.current) {
            serverVoiceNoteShown.current = true;
            setVoiceNote('朗读使用服务端语音；未配置时自动改用浏览器内置语音。');
          }
          return;
        }
        serverVoice.current = false;
      } catch {
        serverVoice.current = false;
      }
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.lang = 'zh-CN';
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const applyEvent = useCallback((event: TeachEvent) => {
    switch (event.type) {
      case 'meta':
        setSessionId(event.sessionId);
        setRunMode(event.kind === 'scripted' ? 'replay' : 'live');
        break;
      case 'plan':
        setSteps(event.steps);
        setCurrent(0);
        setBubbles([]);
        setHintLevel(0);
        setRevealed(false);
        break;
      case 'step_start':
        setStatus('teaching');
        streaming.current = addBubble({ role: 'tutor', kind: 'teach', step: event.index, text: '' });
        break;
      case 'delta':
        appendText(event.text);
        break;
      case 'ask':
        addBubble({ role: 'tutor', kind: 'ask', step: event.index, text: event.text });
        break;
      case 'step_end':
        streaming.current = null;
        void speakText(pendingSpeech.current);
        pendingSpeech.current = '';
        setStatus('paused');
        break;
      case 'hint_start':
        setStatus('teaching');
        streaming.current = addBubble({ role: 'tutor', kind: 'hint', step: event.index, text: '' });
        break;
      case 'hint_delta':
        appendText(event.text);
        break;
      case 'hint_end':
        streaming.current = null;
        void speakText(pendingSpeech.current);
        pendingSpeech.current = '';
        setHintLevel(event.level);
        setStatus('paused');
        break;
      case 'answer_start':
        setStatus('answering');
        streaming.current = addBubble({ role: 'tutor', kind: 'answer', step: event.index, text: '' });
        break;
      case 'answer_delta':
        appendText(event.text);
        break;
      case 'answer_end':
        streaming.current = null;
        void speakText(pendingSpeech.current);
        pendingSpeech.current = '';
        setStatus('paused');
        break;
      case 'reveal':
        setRevealed(true);
        addBubble({ role: 'tutor', kind: 'reveal', step: event.index, text: event.explanation, code: event.code });
        break;
      case 'reveal_start':
        setRevealed(true);
        streaming.current = addBubble({ role: 'tutor', kind: 'reveal', step: event.index, text: '' });
        break;
      case 'reveal_delta':
        appendText(event.text);
        break;
      case 'reveal_end':
        streaming.current = null;
        void speakText(pendingSpeech.current);
        pendingSpeech.current = '';
        break;
      case 'notice':
        addBubble({ role: 'system', kind: 'note', step: -1, text: event.message });
        break;
      case 'resume':
        setCurrent(event.index);
        if (event.interrupted) setStatus('paused');
        break;
      case 'error':
        setError(event.message);
        addBubble({ role: 'system', kind: 'note', step: -1, text: event.message });
        break;
      case 'done':
        break;
    }
  }, [addBubble, appendText, speakText]);

  const stopTimer = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  };

  const stop = useCallback(() => {
    active.current?.abort();
    active.current = null;
    stopTimer();
    setBusy(false);
  }, []);

  useEffect(() => () => { active.current?.abort(); stopTimer(); }, []);
  useEffect(() => { if (!visible) stop(); }, [visible, stop]);

  const send = useCallback(async (request: Parameters<typeof postTeach>[0]) => {
    stop();
    setError('');
    setBusy(true);
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await postTeach({ ...request, sessionId }, controller.signal);
      await consumeTeach(response.body!, applyEvent, controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) {
        const message = cause instanceof Error ? cause.message : '教学会话失败。';
        setError(message);
        addBubble({ role: 'system', kind: 'note', step: -1, text: `${message}（线上部署只能看示例会话；本地 pnpm dev 才能真的对话。）` });
      }
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }, [applyEvent, sessionId, addBubble, stop]);

  const playDemo = useCallback(async () => {
    stop();
    setError('');
    setRunMode('replay');
    setBubbles([]);
    setSteps([]);
    setCurrent(0);
    setHintLevel(0);
    setRevealed(false);
    setStatus('idle');
    setSessionId(null);
    try {
      const response = await fetch('/teach-demo.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('示例会话文件缺失。');
      const data = await response.json() as { events?: unknown[] };
      const list = (data.events ?? []).map(item => parseTeachEvent(JSON.stringify(item))).filter((item): item is TeachEvent => item !== null);
      if (!list.length) throw new Error('示例会话为空。');
      const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (instant) { list.forEach(applyEvent); setStatus('paused'); return; }
      setBusy(true);
      // Text arrives fast, everything else pauses long enough to read.
      const step = (index: number) => {
        if (index >= list.length) { timer.current = null; setBusy(false); setStatus('paused'); return; }
        const event = list[index];
        const flowing = event.type === 'delta' || event.type.endsWith('_delta');
        timer.current = window.setTimeout(() => {
          applyEvent(event);
          step(index + 1);
        }, flowing ? 70 : 320);
      };
      step(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法载入示例会话。');
    }
  }, [applyEvent, stop]);

  useEffect(() => {
    if (!visible || autoPlayed.current) return;
    autoPlayed.current = true;
    void playDemo();
  }, [visible, playDemo]);

  async function startLive() {
    setRunMode('live');
    setSessionId(null);
    setBubbles([]);
    setSteps([]);
    setCurrent(0);
    setHintLevel(0);
    setRevealed(false);
    await send({ problem: { title, statement }, mode, action: 'plan' });
    await send({ problem: { title, statement }, mode, action: 'teach', step: 0 });
  }

  function teachStep(index: number) {
    void send({ problem: { title, statement }, mode, action: 'teach', step: index });
  }

  function ask() {
    const value = question.trim();
    if (!value) return;
    addBubble({ role: 'student', kind: 'question', step: current, text: value });
    setQuestion('');
    void send({ problem: { title, statement }, mode, action: 'answer', step: current, question: value });
  }

  function moreHint() {
    void send({ problem: { title, statement }, mode, action: 'hint', step: current, level: Math.min(hintLevel + 1, 3) });
  }

  function reveal() {
    void send({ problem: { title, statement }, mode, action: 'reveal', step: current });
  }

  function toggleVoice() {
    if (voice === 'off') {
      const supported = typeof window !== 'undefined' && ('speechSynthesis' in window || 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
      if (!supported) { setVoiceNote('当前浏览器不支持语音接口，已保持文字模式。'); return; }
      setVoiceNote('语音用浏览器内置接口：点麦克风说话提问，讲解会自动朗读。');
      setVoice('both');
      speakEnabled.current = true;
      return;
    }
    setVoice('off');
    speakEnabled.current = false;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeaking(false);
    setVoiceNote('');
  }

  function startListening() {
    if (typeof window === 'undefined') return;
    const scope = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
    const Ctor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    if (!Ctor) { setVoiceNote('这个浏览器没有语音识别接口，请用键盘输入。'); return; }
    if (recognition.current) { recognition.current.stop(); recognition.current = null; setListening(false); return; }
    const instance = new Ctor();
    instance.lang = 'zh-CN';
    instance.continuous = false;
    instance.interimResults = true;
    instance.onresult = event => {
      const transcript = Array.from(event.results).map(result => result[0]?.transcript ?? '').join('');
      setQuestion(transcript);
    };
    instance.onerror = () => { setListening(false); setVoiceNote('语音识别失败，请检查麦克风权限。'); };
    instance.onend = () => { setListening(false); recognition.current = null; };
    recognition.current = instance;
    instance.start();
    setListening(true);
  }

  const atLastStep = steps.length > 0 && current >= steps.length - 1;
  const canAsk = !!steps.length && !busy;
  const demo = runMode === 'replay';

  return (
    <section className="teach-studio" aria-label="实时教学工作台">
      <header className="teach-head">
        <div>
          <div className="eyebrow">LIVE TUTORING / 可打断 · 可引导</div>
          <h2>讲题讲到一半，随时插话。</h2>
          <p>按步骤讲解，学生可以在任意时刻打断提问，答完回到原来那一步继续——不重讲、不跳步。引导模式下先反问提示，学生说要答案才给完整解法。</p>
        </div>
        <div className="teach-head-actions">
          <Button variant="outline" onClick={toggleVoice} aria-pressed={voice !== 'off'}>
            {voice === 'off' ? <VolumeX size={15} /> : <Volume2 size={15} />} {voice === 'off' ? '开启语音' : '关闭语音'}
          </Button>
          <Button variant="outline" onClick={() => void playDemo()} disabled={busy && demo}>
            <RotateCcw size={14} /> 看示例会话
          </Button>
        </div>
      </header>

      <div className="teach-grid">
        <div className="teach-side">
          <label htmlFor="teach-title">题目标题</label>
          <input id="teach-title" className="teach-input" value={title} maxLength={200} disabled={busy} onChange={event => setTitle(event.target.value)} />
          <label htmlFor="teach-statement">题目原文</label>
          <Textarea id="teach-statement" rows={5} maxLength={6000} value={statement} disabled={busy} onChange={event => setStatement(event.target.value)} />

          <div className="teach-mode">
            <span>教学模式</span>
            <div className="teach-mode-switch" role="group" aria-label="教学模式">
              <Button variant={mode === 'guide' ? 'secondary' : 'ghost'} aria-pressed={mode === 'guide'} disabled={busy}
                onClick={() => { if (mode === 'guide') return; setMode('guide'); setSessionId(null); setSteps([]); setBubbles([]); setStatus('idle'); }}>
                引导（先反问）
              </Button>
              <Button variant={mode === 'explain' ? 'secondary' : 'ghost'} aria-pressed={mode === 'explain'} disabled={busy}
                onClick={() => { if (mode === 'explain') return; setMode('explain'); setSessionId(null); setSteps([]); setBubbles([]); setStatus('idle'); }}>
                直接讲
              </Button>
            </div>
          </div>

          <div className="teach-outline">
            <div className="teach-outline-head"><span><GraduationCap size={15} /> 讲解板书</span><span className="step-count">{steps.length ? `第 ${current + 1} / ${steps.length} 步` : '未开始'}</span></div>
            {steps.length === 0
              ? <p className="teach-empty">点「开始讲解」建立板书；线上只能看示例会话。</p>
              : <ol className="teach-steps">
                {steps.map(step => (
                  <li key={step.index} className={`teach-step ${step.index === current ? 'active' : ''} ${step.index < current ? 'done' : ''}`}>
                    <span className="teach-step-no">{step.index + 1}</span>
                    <span><strong>{step.title}</strong><small>{step.goal}</small></span>
                  </li>
                ))}
              </ol>}
          </div>

          <div className="teach-controls">
            {status === 'idle' && <Button onClick={() => void startLive()} disabled={busy}><Play size={15} /> 开始讲解</Button>}
            {busy && <Button variant="outline" onClick={stop}><Square size={14} /> 打断</Button>}
            {!busy && steps.length > 0 && status !== 'idle' && (
              <>
                <Button variant="outline" onClick={() => teachStep(current)}><RotateCcw size={14} /> 再讲这一步</Button>
                {!atLastStep && <Button onClick={() => teachStep(current + 1)}>继续下一步 <ArrowRight size={15} /></Button>}
              </>
            )}
          </div>

          {mode === 'guide' && steps.length > 0 && !busy && (
            <div className="teach-hints">
              <Button variant="outline" onClick={moreHint} disabled={hintLevel >= 3}><Lightbulb size={14} /> {hintLevel ? `再提示一点（${hintLevel}/3）` : '给点提示'}</Button>
              <Button variant="outline" onClick={reveal} disabled={revealed}><Eye size={14} /> 直接告诉我</Button>
              <p>提示分三级，只升不降；点「直接告诉我」才会给出完整代码。</p>
            </div>
          )}

          <p className="teach-note">
            真实对话需要本地服务与模型密钥：pnpm dev 后访问 localhost:3001。线上静态部署播放的是示例会话，页面会明确标注。
          </p>
          {error && <p className="generation-error" role="alert">{error}</p>}
        </div>

        <div className="teach-main">
          <div className="teach-stream-head">
            <span><Sparkles size={15} /> 讲解过程</span>
            {runMode === 'replay' && <span className="agent-badge demo">示例会话 · 脚本化策略</span>}
            {runMode === 'live' && <span className="agent-badge live">实时对话</span>}
            {runMode === 'idle' && <span className="agent-badge">等待开始</span>}
            {speaking && <span className="agent-badge">朗读中…</span>}
          </div>

          <div className="teach-bubbles" aria-live="polite">
            {bubbles.length === 0 && <p className="teach-empty">还没有对话。点「开始讲解」，或先看示例会话。</p>}
            {bubbles.map(bubble => (
              <div key={bubble.id} className={`teach-bubble ${bubble.role} ${bubble.kind}`}>
                {bubble.kind === 'ask' && <div className="teach-bubble-tag">引导提问</div>}
                {bubble.kind === 'hint' && <div className="teach-bubble-tag">提示 {hintLevel}/3</div>}
                {bubble.kind === 'answer' && <div className="teach-bubble-tag">针对这一步的回答</div>}
                {bubble.kind === 'reveal' && <div className="teach-bubble-tag">完整解法</div>}
                {bubble.kind === 'note' && <div className="teach-bubble-tag">说明</div>}
                <p>{bubble.text}</p>
                {bubble.code && <pre className="teach-code"><code>{bubble.code}</code></pre>}
              </div>
            ))}
          </div>

          <div className="teach-composer">
            <label htmlFor="teach-question">想问就问，也可以说说你的思路</label>
            <div className="teach-composer-row">
              <Textarea id="teach-question" rows={2} maxLength={600} value={question} placeholder="例如：为什么这里要用哈希表？" onChange={event => setQuestion(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); ask(); } }} />
              <div className="teach-composer-actions">
                <Button variant="outline" size="icon" aria-label="语音输入" onClick={startListening} disabled={!canAsk} className={listening ? 'listening' : ''}><Mic size={15} /></Button>
                <Button onClick={ask} disabled={!canAsk || !question.trim()}><Send size={15} /> 提问</Button>
              </div>
            </div>
            {voiceNote && <p className="teach-voice-note">{voiceNote}</p>}
            <p className="teach-composer-hint">
              {busy ? '讲解中：点「打断」或直接提问，答完会回到刚才那一步。' : `提问只针对第 ${current + 1} 步；Cmd/Ctrl + Enter 发送。`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
