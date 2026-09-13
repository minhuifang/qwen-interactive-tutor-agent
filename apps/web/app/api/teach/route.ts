import { env } from 'cloudflare:workers';
import { createStreamingTeacher } from '@/lib/server/stream-teacher';
const teach = createStreamingTeacher();
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return teach(request, env); }
