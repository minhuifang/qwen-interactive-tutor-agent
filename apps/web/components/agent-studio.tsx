'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { AgentTrace } from '@/components/agent-trace';
import { consumeAgentStream, postAgentRun, type AgentCase, type AgentEvent } from '@/lib/agent-stream';
import { Bot, FlaskConical, Play, RotateCcw, Square } from 'lucide-react';

type Row = { input: string; expected: string };

const DEFAULT_ROWS: Row[] = [
  { input: '{"nums":[2,7,11,15],"target":9}', expected: '[0,1]' },
  { input: '{"nums":[3,2,4],"target":6}', expected: '[1,2]' },
  { input: '{"nums":[3,3],"target":6}', expected: '[0,1]' },
];

const DEFAULT_STATEMENT =
  '给定一个整数数组 nums 和一个整数目标值 target，请你在该数组中找出和为目标值 target 的两个整数，并返回它们的数组下标。你可以假设每种输入只会对应一个答案，且不能重复使用同一个元素。';

export function AgentStudio({ visible = true }: { visible?: boolean }) {
  const [statement, setStatement] = useState(DEFAULT_STATEMENT);
  const [inputContract, setInputContract] = useState('input = { nums: number[], target: number }，返回 [i, j]（i < j）。');
  const [rows, setRows] = useState<Row[]>(DEFAULT_ROWS);
  const [maxRounds, setMaxRounds] = useState(4);
  const [acknowledged, setAcknowledged] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'idle' | 'live' | 'replay'>('idle');
  const [error, setError] = useState('');

  const active = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);
  const autoPlayed = useRef(false);

  const stopTimer = () => {
    if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
  };

  const stop = useCallback(() => {
    active.current?.abort();
    active.current = null;
    stopTimer();
    setRunning(false);
  }, []);

  useEffect(() => () => { active.current?.abort(); stopTimer(); }, []);
  useEffect(() => { if (!visible) stop(); }, [visible, stop]);

  const playDemo = useCallback(async () => {
    stop();
    setError('');
    setMode('replay');
    setEvents([]);
    setRunning(true);
    try {
      const response = await fetch('/agent-demo.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('示例轨迹文件缺失。');
      const data = await response.json() as { events?: AgentEvent[] };
      const list = Array.isArray(data.events) ? data.events : [];
      if (!list.length) throw new Error('示例轨迹为空。');
      const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (instant) { setEvents(list); setRunning(false); return; }
      let index = 0;
      timer.current = window.setInterval(() => {
        index += 1;
        setEvents(list.slice(0, index));
        if (index >= list.length) { stopTimer(); setRunning(false); }
      }, 320);
    } catch (cause) {
      setRunning(false);
      setError(cause instanceof Error ? cause.message : '无法载入示例轨迹。');
    }
  }, [stop]);

  useEffect(() => {
    if (!visible || autoPlayed.current) return;
    autoPlayed.current = true;
    void playDemo();
  }, [visible, playDemo]);

  function parseCases(): AgentCase[] | null {
    try {
      return rows.map((row, index) => {
        if (!row.input.trim() || !row.expected.trim()) throw new Error(`样例 ${index + 1} 还没填完。`);
        const parsed = { input: JSON.parse(row.input), expected: JSON.parse(row.expected) } as AgentCase;
        if (JSON.stringify(parsed).length > 8000) throw new Error(`样例 ${index + 1} 过大。`);
        return parsed;
      });
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith('样例') ? cause.message : '样例必须是合法 JSON，例如 {"nums":[2,7],"target":9} 和 [0,1]。');
      return null;
    }
  }

  async function start() {
    if (running) return;
    if (!acknowledged) { setError('请先确认：你已核对题目与样例预期，并同意 Agent 在隔离容器中自动运行它写的代码。'); return; }
    const cases = parseCases();
    if (!cases) return;
    stop();
    setError('');
    setMode('live');
    setEvents([]);
    setRunning(true);
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 300_000);
    try {
      const response = await postAgentRun({
        problem: { title: '两数之和', statement, inputContract },
        cases,
        maxRounds,
      }, controller.signal);
      await consumeAgentStream(response.body!, event => setEvents(old => [...old, event]), controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Agent 运行失败。');
        setEvents(old => [...old, { type: 'error', message: '本次运行未能开始或提前结束。本地接口只在 pnpm dev（localhost:3001）可用；线上部署只能看示例轨迹。' }]);
      } else {
        setError('已停止。已收到的事件保留。');
        setEvents(old => [...old, { type: 'error', message: '已手动停止，已收到的事件保留。' }]);
      }
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setRunning(false); }
    }
  }

  const isDemo = mode === 'replay';

  return (
    <section className="agent-studio" aria-label="Agent 解题工作台">
      <header className="agent-head">
        <div>
          <div className="eyebrow">AGENT LOOP / 自动修复</div>
          <h2>给它一道题，让它自己跑到通过。</h2>
          <p>模型写代码 → 在禁网容器里执行 → 读失败用例 → 改 → 再跑。最多 4 轮，结论只由执行器给出。</p>
        </div>
        <div className="agent-head-actions">
          <Button variant="outline" onClick={() => void playDemo()} disabled={running && isDemo}>
            <FlaskConical size={15} /> 看示例轨迹
          </Button>
          {running && <Button variant="outline" onClick={stop}><Square size={14} /> 停止</Button>}
        </div>
      </header>

      <div className="agent-grid">
        <div className="agent-form">
          <label htmlFor="agent-statement">题目原文</label>
          <Textarea id="agent-statement" rows={5} maxLength={6000} value={statement} onChange={e => setStatement(e.target.value)} disabled={running} />
          <label htmlFor="agent-contract">输入约定（Agent 要靠它解构入参）</label>
          <Textarea id="agent-contract" rows={2} maxLength={1500} value={inputContract} onChange={e => setInputContract(e.target.value)} disabled={running} />

          <div className="agent-rows-head">
            <span>已核对样例（1–8）</span>
            <Button variant="ghost" disabled={running || rows.length >= 8} onClick={() => setRows([...rows, { input: '', expected: '' }])}>添加样例</Button>
          </div>
          {rows.map((row, index) => (
            <div className="agent-row" key={index}>
              <div className="agent-row-no">样例 {index + 1}</div>
              <Textarea rows={2} value={row.input} maxLength={8000} disabled={running} aria-label={`样例 ${index + 1} 输入`} onChange={e => setRows(rows.map((item, i) => i === index ? { ...item, input: e.target.value } : item))} />
              <Textarea rows={1} value={row.expected} maxLength={8000} disabled={running} aria-label={`样例 ${index + 1} 预期输出`} onChange={e => setRows(rows.map((item, i) => i === index ? { ...item, expected: e.target.value } : item))} />
              <Button variant="ghost" disabled={running || rows.length === 1} onClick={() => setRows(rows.filter((_, i) => i !== index))}>移除</Button>
            </div>
          ))}

          <div className="agent-options">
            <label htmlFor="agent-rounds">最多轮次</label>
            <select id="agent-rounds" value={maxRounds} disabled={running} onChange={e => setMaxRounds(Number(e.target.value))}>
              {[2, 3, 4, 5].map(value => <option key={value} value={value}>{value} 轮</option>)}
            </select>
            <span>每轮包含一次模型调用与至多一次容器执行</span>
          </div>

          <label className="agent-ack">
            <Checkbox checked={acknowledged} onCheckedChange={value => setAcknowledged(value === true)} />
            我已核对题目与样例预期，同意 Agent 在隔离容器中自动运行它自己生成的代码。
          </label>

          <div className="agent-controls">
            <Button disabled={running} onClick={() => void start()}><Play size={15} /> {running && mode === 'live' ? '运行中…' : '开始运行'}</Button>
            <Button variant="ghost" onClick={() => void playDemo()} disabled={running && isDemo}><RotateCcw size={14} /> 重播示例</Button>
          </div>
          <p className="agent-note">
            代码只在本地 Docker 沙箱执行（禁网、只读、非 root、128 MB、8 秒/例）。每次运行最多 6 次/小时。
            线上静态部署没有 Docker，所以只能看示例轨迹——这是设计取舍，不是功能缺失。
          </p>
          {error && <p className="generation-error" role="alert">{error}</p>}
        </div>

        <div className="agent-trace-panel">
          <div className="agent-trace-head">
            <span><Bot size={15} /> 执行轨迹</span>
            {mode === 'replay' && <span className="agent-badge demo">演示轨迹 · 脚本化策略 + 模拟执行</span>}
            {mode === 'live' && <span className="agent-badge live">实时运行</span>}
            {mode === 'idle' && <span className="agent-badge">等待运行</span>}
          </div>
          {events.length === 0 && !running
            ? <p className="agent-empty">还没有轨迹。点「开始运行」跑一次真实任务，或「看示例轨迹」先看看交互。</p>
            : <AgentTrace events={events} running={running} />}
        </div>
      </div>
    </section>
  );
}
