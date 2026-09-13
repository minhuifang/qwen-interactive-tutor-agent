import { env } from 'cloudflare:workers';
import { problemResponse } from '@/lib/server/parse-problem';
import type { ModelEnvironment } from '@/lib/server/generate-lesson';

export const dynamic = 'force-dynamic';
export function POST(request: Request) { return problemResponse(request, env as ModelEnvironment); }
