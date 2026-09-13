import { randomBytes, timingSafeEqual } from 'node:crypto';
import { validateJob, verifyJob } from './docker-runner.mjs';

const prefix = '/api/local-runner/';
const allowedHosts = new Set(['localhost:3001', '127.0.0.1:3001', '[::1]:3001']);
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0, settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { chunks.length = 0; reject(error); }
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(() => finish(new Error('BODY_TIMEOUT')), 5000);
    req.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > 100000) return finish(new Error('BODY_TOO_LARGE'));
      chunks.push(chunk);
    });
    req.once('end', () => finish());
    req.once('error', () => finish(new Error('BODY_ABORTED')));
    req.once('aborted', () => finish(new Error('BODY_ABORTED')));
  });
}

// Only mounted in Vite's local development server. No new listening port.
// This is CSRF protection for a trusted single-user machine, not remote-user auth.
export function createRunnerMiddleware(run = verifyJob, now = Date.now) {
  const token = randomBytes(32).toString('base64url');
  let busy = false, blocked = false;
  let calls = [];
  return async (req, res, next) => {
    if (!req.url?.startsWith(prefix)) return next();
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    const error = (status, code, message) => json(status, { error: { code, message } });
    if (!loopback.has(req.socket.remoteAddress) || !allowedHosts.has(req.headers.host) || req.headers.origin !== `http://${req.headers.host}` || req.headers['sec-fetch-site'] === 'cross-site') {
      req.resume(); return error(403, 'ORIGIN', '仅允许本机页面同来源访问。');
    }
    if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json' || req.headers['x-tutor-local'] !== '1') {
      req.resume(); return error(403, 'REQUEST', '拒绝非页面验证请求。');
    }
    if (req.url === `${prefix}session`) {
      req.resume(); return json(200, { token });
    }
    if (req.url !== `${prefix}verify`) { req.resume(); return error(404, 'NOT_FOUND', '接口不存在。'); }
    const supplied = req.headers['x-tutor-runner-token'];
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
      req.resume(); return error(403, 'TOKEN', '本地会话已失效，请重新点击运行。');
    }
    if (blocked) { req.resume(); return error(503, 'CLEANUP', '上次容器清理无法确认，请检查本地 Docker 并重启开发服务。'); }
    if (busy) { req.resume(); return error(429, 'BUSY', '已有验证正在运行，请等待结束。'); }
    calls = calls.filter(t => now() - t < 3600000);
    if (calls.length >= 12) { req.resume(); return error(429, 'BUDGET', '本地验证已达到本进程每小时 12 次上限。'); }
    busy = true;
    try {
      let job;
      try { job = validateJob(JSON.parse(await readBody(req))); }
      catch (cause) {
        if (cause?.message === 'BODY_TOO_LARGE') return error(413, 'TOO_LARGE', '请求超过 100 KB。');
        if (cause?.message === 'BODY_TIMEOUT') return error(408, 'TIMEOUT', '请求读取超时。');
        return error(400, 'INVALID_JOB', '请核对代码、JSON 输入和预期输出，并勾选确认；最多 8 个样例，每例最多 8000 字符。');
      }
      if (res.destroyed || req.aborted) return;
      calls.push(now());
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.once('close', cancel);
      try { json(200, await run(job, { signal: controller.signal })); }
      finally { res.off('close', cancel); }
    } catch (cause) {
      // Never reflect stderr, code, file paths, tokens or arbitrary exception text.
      if (cause instanceof Error && cause.message.startsWith('Cleanup could not be confirmed')) blocked = true;
      error(503, 'UNAVAILABLE', blocked ? '容器清理无法确认，已暂停验证，请检查本地 Docker。' : '本地执行器不可用。请确认 tutor-sandbox 已启动、固定镜像存在，再手动重试。');
    } finally { busy = false; }
  };
}
