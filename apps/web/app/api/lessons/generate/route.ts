import { env } from 'cloudflare:workers';
import { configurationResponse, generationResponse } from '@/lib/server/generation-api';
import type { ModelEnvironment } from '@/lib/server/generate-lesson';

export const dynamic = 'force-dynamic';
export function GET(request: Request) { return configurationResponse(request, env as ModelEnvironment); }
export function POST(request: Request) { return generationResponse(request, env as ModelEnvironment); }
