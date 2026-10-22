'use client';
import { useEffect, useRef } from 'react';
import { AlertTriangle, Check, FileCode2, Flag, GitBranch, Play, Terminal, X } from 'lucide-react';
import { CASE_LABELS, FINAL_LABELS, type AgentCase, type AgentEvent, type AgentSolution, type CaseResult } from '@/lib/agent-stream';

function CaseChips({ results }: { results: CaseResult[] }) {
  return (
    <div className="trace-cases">
      {results.map(item => (
        <span key={item.index} className={`trace-case ${item.status}`}>
          {item.status === 'passed' ? <Check size={12} /> : <X size={12} />}
          样例 {item.index} · {CASE_LABELS[item.status] ?? item.status}
          {item.status !== 'passed' && item.actual !== undefined && <em>实际 {item.actual}</em>}
        </span>
      ))}
    </div>
  );
}

function CodeBlock({ code, label, defaultOpen = false }: { code: string; label: string; defaultOpen?: boolean }) {
  const lines = code.split('\n');
  return (
    <details className="trace-code" open={defaultOpen}>
      <summary>
        <span><FileCode2 size={14} /> {label}</span>
        <span>{lines.length} 行</span>
      </summary>
      <pre>{lines.map((line, index) => <div key={index}><i>{index + 1}</i><code>{line || ' '}</code></div>)}</pre>
    </details>
  );
}

function SolutionCard({ solution, status, reason }: { solution: AgentSolution; status: string; reason: string }) {
  return (
    <section className="trace-solution" aria-label="最终解法">
      <header>
        <span className={`trace-final-badge ${status}`}>{FINAL_LABELS[status] ?? status}</span>
        <p>{reason}</p>
      </header>
      {solution.approach && <p className="trace-approach">{solution.approach}</p>}
      {!!solution.steps?.length && <ol className="trace-steps">{solution.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
      <div className="trace-facts">
        {solution.timeComplexity && <span><b>时间</b>{solution.timeComplexity}</span>}
        {solution.spaceComplexity && <span><b>空间</b>{solution.spaceComplexity}</span>}
      </div>
      {!!solution.cautions?.length && <ul className="trace-cautions">{solution.cautions.map(item => <li key={item}>{item}</li>)}</ul>}
      {solution.code && <CodeBlock code={solution.code} label="最终代码" defaultOpen />}
    </section>
  );
}

export function AgentTrace({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [events.length]);

  const rounds = new Map<number, AgentEvent[]>();
  let final: Extract<AgentEvent, { type: 'final' }> | null = null;
  const errors: string[] = [];
  for (const event of events) {
    if (event.type === 'final') { final = event; continue; }
    if (event.type === 'error') { errors.push(event.message); continue; }
    if (event.type === 'meta' || event.type === 'done') continue;
    const round = 'round' in event ? event.round : 0;
    const list = rounds.get(round) ?? [];
    list.push(event);
    rounds.set(round, list);
  }

  return (
    <div className="trace" role="log" aria-live="polite">
      {[...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([round, list]) => {
        const verdict = list.find(event => event.type === 'round_end') as Extract<AgentEvent, { type: 'round_end' }> | undefined;
        return (
          <section className="trace-round" key={round}>
            <div className="trace-round-head">
              <span className="trace-round-no">{String(round).padStart(2, '0')}</span>
              <span>第 {round} 轮</span>
              {verdict && <span className={`trace-verdict ${verdict.verdict}`}>{
                verdict.verdict === 'passed' ? '样例通过'
                  : verdict.verdict === 'failed' ? '仍有失败'
                    : verdict.verdict === 'submitted' ? '已提交'
                      : verdict.verdict === 'invalid_arguments' ? '调用不合法'
                        : '未调用工具'
              }</span>}
            </div>
            {list.map((event, index) => {
              if (event.type === 'round_start' || event.type === 'round_end') return null;
              if (event.type === 'thought') {
                return (
                  <div className="trace-thought" key={`t${index}`}>
                    <span className="trace-label"><GitBranch size={13} /> 思考</span>
                    <p>{event.text}</p>
                  </div>
                );
              }
              if (event.type === 'tool_call') {
                const isFinish = event.tool === 'finish';
                const note = typeof event.args.note === 'string' ? event.args.note : '';
                return (
                  <div className={`trace-call ${isFinish ? 'finish' : ''}`} key={`c${index}`}>
                    <span className="trace-label">
                      {isFinish ? <Flag size={13} /> : <Terminal size={13} />}
                      {isFinish ? 'finish' : 'run_tests'}
                      {event.auto && <em>自动验证</em>}
                    </span>
                    {note && <p className="trace-note">{note}</p>}
                    {event.code && <CodeBlock code={event.code} label={isFinish ? '提交的代码' : '本轮代码'} />}
                  </div>
                );
              }
              if (event.type === 'tool_result') {
                return (
                  <div className={`trace-result ${event.status}`} key={`r${index}`}>
                    <span className="trace-label">
                      {event.status === 'examples_passed' ? <Check size={13} /> : <AlertTriangle size={13} />}
                      执行结果 · {event.passed}/{event.total} 通过
                    </span>
                    {event.note && <p className="trace-note">{event.note}</p>}
                    {event.results.length > 0 && <CaseChips results={event.results} />}
                    {event.status === 'unavailable' && <p className="trace-note">隔离执行器不可用，本次没有产生任何执行结果。</p>}
                  </div>
                );
              }
              return null;
            })}
          </section>
        );
      })}

      {errors.map((message, index) => (
        <p className="trace-error" key={`e${index}`}><AlertTriangle size={14} /> {message}</p>
      ))}

      {final && (
        <>
          <div className="trace-final-meta">
            <span><b>{final.rounds}</b> 轮</span>
            <span><b>{final.verification.passed}/{final.verification.total}</b> 样例通过</span>
            {final.usage?.total_tokens ? <span><b>{final.usage.total_tokens}</b> tokens</span> : null}
            {final.durationMs ? <span><b>{(final.durationMs / 1000).toFixed(1)}</b>s</span> : null}
            <span className={`trace-verified ${final.verification.status}`}>
              {final.verification.status === 'examples_passed' ? '执行器已确认' : final.verification.status === 'not_passed' ? '执行器判定未通过' : '未经执行器验证'}
            </span>
          </div>
          {final.solution ? <SolutionCard solution={final.solution} status={final.status} reason={final.reason} /> : <p className="trace-error">本次没有产出解法。</p>}
          <p className="trace-notice">{final.verification.notice}</p>
        </>
      )}

      {running && (
        <p className="trace-pending"><Play size={13} /> Agent 正在运行，轨迹会逐条到达…</p>
      )}
      <div ref={endRef} />
    </div>
  );
}

export function TraceLegend({ cases }: { cases: AgentCase[] }) {
  return (
    <p className="trace-legend">
      本次共 {cases.length} 个样例，全部来自你核对过的输入与预期。Agent 只能执行、不能修改它们。
    </p>
  );
}
