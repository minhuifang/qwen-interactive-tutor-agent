import { z } from 'zod';
import { confirmationIssues, problemDraftSchema, problemInputSchema } from './problem-schema.ts';

export const confirmedProblemSchema = z.object({
  version: z.literal('0.1'), status: z.literal('confirmed'),
  source: z.enum(['manual', 'deepseek']), originalText: problemInputSchema.shape.text,
  problem: problemDraftSchema,
}).strict().superRefine((value, ctx) => {
  for (const message of confirmationIssues(value.problem)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
});
export const preparedProblemSchema = z.object({
  version: z.literal('0.1'), status: z.literal('ready'), source: z.literal('deepseek'),
  originalText: problemInputSchema.shape.text, problem: problemDraftSchema,
}).strict().superRefine((value, ctx) => {
  for (const message of confirmationIssues(value.problem)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
});
export const solutionInputSchema = z.union([
  z.object({ confirmed: confirmedProblemSchema }).strict(),
  z.object({ prepared: preparedProblemSchema }).strict(),
  z.object({ text: z.string().trim().min(1).max(6000), context: z.string().max(30000).optional() }).strict(),
]);
const text = (max: number) => z.string().trim().min(1).max(max);
export const solutionSchema = z.object({
  approach: text(4000),
  steps: z.array(text(600)).min(1).max(12),
  assumptions: z.array(text(300)).max(10),
  timeComplexity: text(500), spaceComplexity: text(500),
  language: z.literal('javascript'), entrypoint: z.literal('solve'),
  inputContract: text(1500), code: text(16000),
  cautions: z.array(text(500)).max(10),
}).strict();
export const solutionResultSchema = z.object({
  solution: solutionSchema, model: z.string(),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative() }).nullable(),
  verification: z.object({ status: z.literal('not_run'), reason: z.string() }).strict(),
}).strict();
export type SolutionResult = z.infer<typeof solutionResultSchema>;

/** Lossless shape repair only: never truncate text, discard assumptions or stringify objects. */
export function normalizeSolution(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const value = { ...raw } as Record<string, unknown>;
  for (const key of ['assumptions', 'cautions']) {
    if (typeof value[key] === 'string' && value[key].trim()) value[key] = [value[key]];
  }
  return value;
}
