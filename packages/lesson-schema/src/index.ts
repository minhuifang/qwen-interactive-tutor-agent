/** v0.1: portable data contract. No DOM, model client, or framework dependency. */
export type LessonId = 'two-sum' | 'longest-substring';
export type Frame = {
  id: string;
  title: string;
  narration: string;
  formula: string;
  current: number;
  active: number[];
  matched: number[];
  entries: [string, number][];
  variables: Record<string, string | number>;
  codeLine: number;
};
export type Checkpoint = { prompt: string; placeholder: string; explanation: string };
export type Lesson = {
  version: '0.1';
  id: LessonId;
  number: number;
  title: string;
  difficulty: '简单' | '中等';
  technique: string;
  source: string;
  problem: string;
  inputLabel: string;
  values: (number | string)[];
  output: string;
  complexity: string;
  code: string;
  frames: Frame[];
  checkpoint: Checkpoint;
};
export type Diagnosis = {
  status: 'correct' | 'incorrect' | 'invalid';
  errorType: string;
  title: string;
  feedback: string;
  remediation: string[];
  reviewFrame: number;
};

/** Boundary checks used on fixtures now, and model output later. */
export function assertLesson(value: unknown): asserts value is Lesson {
  if (!value || typeof value !== 'object') throw new Error('课件必须为对象');
  const l = value as Lesson;
  if (l.version !== '0.1' || !['two-sum', 'longest-substring'].includes(l.id)) throw new Error('不支持的课件版本或题目');
  if (!Array.isArray(l.values) || !l.values.length || !l.values.every(v => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))) throw new Error('缺少有效演示输入');
  for (const key of ['title', 'source', 'problem', 'inputLabel', 'output', 'complexity', 'code'] as const) {
    if (typeof l[key] !== 'string' || !l[key]) throw new Error(`缺少 ${key}`);
  }
  if (!Number.isInteger(l.number) || !['简单', '中等'].includes(l.difficulty) || typeof l.technique !== 'string') throw new Error('题目元数据无效');
  if (!l.checkpoint || !['prompt', 'placeholder', 'explanation'].every(k => typeof l.checkpoint[k as keyof Checkpoint] === 'string')) throw new Error('缺少检查点');
  if (!Array.isArray(l.frames) || !l.frames.length) throw new Error('缺少教学步骤');
  const ids = new Set<string>();
  const indexValid = (n: number) => Number.isInteger(n) && n >= 0 && n < l.values.length;
  for (const frame of l.frames) {
    if (!frame || typeof frame !== 'object') throw new Error('步骤格式无效');
    if (typeof frame.id !== 'string' || !frame.id || ids.has(frame.id)) throw new Error('步骤 ID 必须唯一');
    ids.add(frame.id);
    if (!['title', 'narration', 'formula'].every(k => typeof frame[k as 'title'] === 'string')) throw new Error('讲解内容无效');
    if (!indexValid(frame.current) || ![frame.active, frame.matched].every(a => Array.isArray(a) && a.every(indexValid))) throw new Error('动画索引越界');
    if (!Number.isInteger(frame.codeLine) || frame.codeLine < 1 || frame.codeLine > l.code.split('\n').length) throw new Error('代码行号越界');
    if (!Array.isArray(frame.entries) || !frame.entries.every(e => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && indexValid(e[1]))) throw new Error('Map 数据无效');
    if (!frame.variables || typeof frame.variables !== 'object' || !Object.values(frame.variables).every(v => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))) throw new Error('变量数据无效');
  }
}
