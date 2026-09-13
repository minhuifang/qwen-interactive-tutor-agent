import { env } from 'cloudflare:workers';
import { createSpeechService } from '@/lib/server/speech';
const speech = createSpeechService();
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return speech(request, env); }
