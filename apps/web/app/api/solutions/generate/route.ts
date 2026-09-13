import { env } from 'cloudflare:workers';
import { solutionResponse } from '@/lib/server/generate-solution';
import type { ModelEnvironment } from '@/lib/server/generate-lesson';

export const dynamic = 'force-dynamic';
export function POST(request: Request) { return solutionResponse(request, env as ModelEnvironment); }
