import { z } from 'zod';

export const problemInputSchema = z.object({ text: z.string().trim().min(20, '请至少输入 20 个字符的题目描述。').max(6000, '题目最多 6000 个字符。') }).strict();
export const problemDraftSchema = z.object({
  title: z.string().trim().max(120),
  statement: z.string().trim().max(6000),
  inputDescription: z.string().trim().max(1500),
  outputDescription: z.string().trim().max(1500),
  constraints: z.array(z.string().trim().min(1).max(300)).max(20),
  examples: z.array(z.object({ input: z.string().max(1000), output: z.string().max(1000) }).strict()).max(8),
  missingInformation: z.array(z.string().trim().min(1).max(300)).max(10),
}).strict();
export type ProblemDraft = z.infer<typeof problemDraftSchema>;
export const parsedProblemSchema = z.object({
  draft: problemDraftSchema,
  source: z.literal('deepseek'), model: z.string(),
  usage: z.object({ prompt_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative(), total_tokens: z.number().nonnegative() }).nullable(),
}).strict();

/** An empty field cannot be hidden by an optimistic model response. */
export function confirmationIssues(raw: unknown): string[] {
  const result = problemDraftSchema.safeParse(raw);
  if (!result.success) return result.error.issues.map(i => `${i.path.join('.')}：${i.message}`);
  const draft = result.data;
  return [
    ...(!draft.title ? ['请补充题目标题。'] : []),
    ...(!draft.statement ? ['请补充题目描述。'] : []),
    ...(!draft.inputDescription ? ['请说明输入数据和类型。'] : []),
    ...(!draft.outputDescription ? ['请说明应返回的结果。'] : []),
    ...(draft.examples.some(e => !e.input.trim() || !e.output.trim()) ? ['样例的输入和输出需成对填写；不需要的空样例请删除。'] : []),
    ...draft.missingInformation.map(q => `待澄清：${q}`),
  ];
}

export function confirmProblem(draft: unknown, originalText: string, source: 'deepseek' | 'manual', acknowledged: boolean) {
  const issues = confirmationIssues(draft);
  if (!acknowledged || issues.length) throw new Error(issues[0] || '请先确认已核对题意。');
  return { version: '0.1' as const, status: 'confirmed' as const, source, originalText: problemInputSchema.parse({ text: originalText }).text, problem: problemDraftSchema.parse(draft) };
}
