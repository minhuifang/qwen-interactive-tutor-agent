import { parse } from './parse-problem.ts';
import { generate } from './generate-solution.ts';
import { assertLocalRequest } from './generation-api.ts';
import { confirmationIssues, problemInputSchema } from '../problem-schema.ts';
import { GenerationError, readLimitedText, type ModelEnvironment } from './generate-lesson.ts';

export function createTeacher(parser = parse, generator = generate) {
  return async (request: Request, env: ModelEnvironment) => {
    const headers = { 'Cache-Control': 'no-store' };
    try {
      assertLocalRequest(request, true);
      const input = problemInputSchema.safeParse(JSON.parse(await readLimitedText(request.body, 40000)));
      if (!input.success) throw new GenerationError(400, 'INVALID_INPUT', '请提供 20～6000 字符的题目描述。');
      const { draft } = await parser(input.data, env);
      if (request.signal.aborted) throw new GenerationError(499, 'CANCELLED', '已停止本次讲解。');
      const questions = confirmationIssues(draft);
      if (questions.length) return Response.json({ status: 'clarification', questions, draft }, { headers });
      // Machine-prepared is explicitly not human confirmation, and never authorizes code execution.
      const result = await generator({ prepared: { version: '0.1', status: 'ready', source: 'deepseek', originalText: input.data.text, problem: draft } }, env);
      return Response.json({ status: 'ready', draft, result }, { headers });
    } catch (error) {
      const safe = error instanceof GenerationError ? error : new GenerationError(502, 'TEACHING_FAILED', '暂时无法整理讲解，题目已保留，请重试。');
      return Response.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status, headers });
    }
  };
}
