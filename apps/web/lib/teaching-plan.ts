import { z } from 'zod';
import { assertLesson, type Lesson } from '../../../packages/lesson-schema/src/index.ts';

export const generationInput = z.object({
  lessonId: z.enum(['two-sum', 'longest-substring']),
  style: z.enum(['beginner', 'interview']),
}).strict();
export type GenerationInput = z.infer<typeof generationInput>;
export const teachingPlanSchema = z.object({
  objective: z.string().trim().min(1).max(300),
  steps: z.array(z.object({
    id: z.string().min(1).max(40),
    title: z.string().trim().min(1).max(60),
    narration: z.string().trim().min(10).max(700),
  }).strict()).length(6),
}).strict();
export type TeachingPlan = z.infer<typeof teachingPlanSchema>;

/** Only approved prose fields cross the model boundary. Code/state/answers stay trusted. */
export function compileTeachingPlan(raw: unknown, canonical: Lesson) {
  const plan = teachingPlanSchema.parse(raw);
  if (plan.steps.some((step, i) => step.id !== canonical.frames[i]?.id)) {
    throw new Error('步骤 ID 或顺序与算法状态不一致');
  }
  const lesson: Lesson = {
    ...canonical,
    frames: canonical.frames.map((frame, i) => ({
      ...frame, title: plan.steps[i].title, narration: plan.steps[i].narration,
    })),
  };
  assertLesson(lesson);
  return { plan, lesson };
}

export type GenerationResult = {
  lesson: Lesson;
  objective: string;
  source: 'deepseek';
  model: string;
  cached: boolean;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  stages: string[];
};
