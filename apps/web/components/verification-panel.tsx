'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

const reportSchema = z.object({
  status: z.enum(['examples_passed', 'not_passed']),
  results: z.array(z.object({ status: z.enum(['passed', 'failed', 'timeout', 'runtime_error', 'output_limit', 'invalid_output', 'unavailable']), actual: z.unknown().optional() }).strict()).max(8),
  notice: z.string(),
}).strict();
type Report = z.infer<typeof reportSchema>;
const labels = { passed: '通过', failed: '答案不符', timeout: '超时，已终止', runtime_error: '运行异常 / 资源限制', output_limit: '输出超限，已终止', invalid_output: '输出不是有效结果', unavailable: '执行环境不可用' };

export function VerificationPanel({ code, examples }: { code: string; examples: { input: string; output: string }[] }) {
  const [cases, setCases] = useState(() => examples.length ? examples.map(e => ({ input: e.input, expected: e.output })) : [{ input: '', expected: '' }]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  function update(next: typeof cases) { setCases(next); setAcknowledged(false); setReport(null); setError(''); }
  let parsed: { input: unknown; expected: unknown }[] = [];
  let invalid = '';
  try {
    parsed = cases.map((item, i) => {
      try {
        const pair = { input: JSON.parse(item.input), expected: JSON.parse(item.expected) };
        if (JSON.stringify(pair).length > 8000) throw new Error();
        return pair;
      } catch { throw new Error(`样例 ${i + 1}：输入与预期输出须是合法 JSON，每例合计最多 8000 字符。`); }
    });
  } catch (cause) { invalid = cause instanceof Error ? cause.message : '请核对样例。'; }

  async function verify() {
    if (active.current || invalid || !acknowledged) return;
    const controller = new AbortController(); active.current = controller;
    const timer = setTimeout(() => controller.abort(), 110000);
    setPending(true); setError(''); setReport(null);
    try {
      const headers = { 'Content-Type': 'application/json', 'X-Tutor-Local': '1' };
      const session = await fetch('/api/local-runner/session', { method: 'POST', headers, body: '{}', signal: controller.signal });
      if (!session.ok) throw new Error('本地验证接口不可用，请使用 localhost:3001 的开发服务。');
      const { token } = z.object({ token: z.string().min(32).max(100) }).parse(await session.json());
      const response = await fetch('/api/local-runner/verify', {
        method: 'POST', headers: { ...headers, 'X-Tutor-Runner-Token': token },
        body: JSON.stringify({ code, cases: parsed, acknowledged: true }), signal: controller.signal,
      });
      const raw = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.object({ message: z.string() }) }).safeParse(raw);
        throw new Error(failure.success ? failure.data.error.message : '本地验证失败。');
      }
      const next = reportSchema.parse(raw);
      if (!controller.signal.aborted) setReport(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '本地验证失败。');
      else setError('已停止等待，本次不显示结果；当前容器会在受限时间内结束并清理。');
    } finally { clearTimeout(timer); active.current = null; setPending(false); }
  }

  return <section className="verification-panel" aria-label="本地运行验证" style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
    <h2>04 / 本地运行验证</h2>
    <p>对照上方输入约定，将样例改成传给 solve(input) 的单个 JSON 值。预期答案请按原题核对，不由模型自动计算。</p>
    <p className="intake-note">例如数组写 [1,2]，字符串写 "abc"；不要写 nums = [1,2]。按 JSON 精确比较，数组顺序会影响结果。验证仅在你的 Mac 容器中运行，不调用百炼。</p>
    <fieldset disabled={pending} className="intake-fields">
      {cases.map((item, i) => <div className="intake-example" key={i}>
        <label htmlFor={`run-input-${i}`}>样例 {i + 1} · JSON 输入</label><Textarea id={`run-input-${i}`} rows={3} maxLength={8000} value={item.input} onChange={e => update(cases.map((c, j) => j === i ? { ...c, input: e.target.value } : c))} />
        <label htmlFor={`run-expected-${i}`}>预期输出</label><Textarea id={`run-expected-${i}`} rows={2} maxLength={8000} value={item.expected} onChange={e => update(cases.map((c, j) => j === i ? { ...c, expected: e.target.value } : c))} />
        <Button variant="ghost" disabled={cases.length === 1} onClick={() => update(cases.filter((_, j) => i !== j))}>删除样例 {i + 1}</Button>
      </div>)}
      <Button variant="outline" disabled={cases.length >= 8} onClick={() => update([...cases, { input: '', expected: '' }])}>添加测试样例</Button>
      {invalid && <p className="generation-error">{invalid}</p>}
      <label className="intake-ack"><Checkbox checked={acknowledged} onCheckedChange={checked => { setAcknowledged(checked); setReport(null); }} />我已核对上方代码、输入约定和这些预期答案，同意在本机隔离容器中运行。</label>
    </fieldset>
    <Button disabled={pending || !!invalid || !acknowledged} onClick={verify}>{pending ? '本地验证中…' : '运行这些样例'}</Button>
    <p className="intake-note">每例 8 秒、128 MB 内存、禁网、只读、无宿主目录与密钥。修改题意、解法或测试数据会撤销验证结果；不是完整正确性证明。</p>
    <div role="status">{pending && <p>逐例创建隔离容器并比较结果，请等待；发生超时或输出超限会停止后续样例。</p>}{error && <p className="generation-error">{error}</p>}</div>
    {report && <div className={report.status === 'examples_passed' ? 'intake-confirmed' : 'intake-issues'}>
      <strong>{report.status === 'examples_passed' ? '已通过本次全部样例' : '本次未全部通过'}</strong>
      {cases.map((_, i) => <div key={i}><p>样例 {i + 1}：{report.results[i] ? labels[report.results[i].status] : '未执行'}</p>{report.results[i] && Object.hasOwn(report.results[i], 'actual') && <pre style={{ maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>实际输出：{JSON.stringify(report.results[i].actual)}</pre>}</div>)}
      <p>仅验证以上人工核对的样例，不代表所有输入都正确。</p>
    </div>}
  </section>;
}
