import { z } from 'zod';
import { problemDraftSchema } from './problem-schema.ts';
import { solutionResultSchema } from './solution-schema.ts';
export const teachingResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('clarification'), questions: z.array(z.string()).min(1), draft: problemDraftSchema }),
  z.object({ status: z.literal('ready'), draft: problemDraftSchema, result: solutionResultSchema }),
]);
export type TeachingResult = z.infer<typeof teachingResultSchema>;
