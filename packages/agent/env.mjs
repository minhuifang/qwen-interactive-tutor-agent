// Minimal .env reader for the Node-side runner. The Worker gets its bindings
// from the platform, but the Vite middleware is plain Node, so we parse the same
// `.env.local` file ourselves to keep one source of truth for local setup.

import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

export function loadLocalEnv(files = ['apps/web/.env.local', 'apps/web/.env', '.env.local', '.env']) {
  const values = {};
  for (const file of [...files].reverse()) {
    try { Object.assign(values, parseEnv(readFileSync(new URL(file, repoRoot), 'utf8'))); }
    catch { /* missing file is the normal case */ }
  }
  return { ...values, ...process.env };
}

/**
 * Same allow-list as the Worker-side reader: only the official HTTPS endpoint,
 * so a mis-set base URL cannot leak the key to another host.
 */
export function readModelConfig(env = loadLocalEnv()) {
  const apiKey = (env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) throw Object.assign(new Error('未配置 DEEPSEEK_API_KEY。请在 apps/web/.env.local 填写后重启 pnpm dev。'), { code: 'NOT_CONFIGURED' });
  const model = (env.DEEPSEEK_MODEL || '').trim() || 'deepseek-chat';
  if (!/^deepseek-[a-z0-9.-]{1,80}$/.test(model)) throw Object.assign(new Error('DeepSeek 模型 ID 不合法。'), { code: 'BAD_CONFIG' });
  let base;
  try { base = new URL((env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').trim()); }
  catch { throw Object.assign(new Error('DEEPSEEK_BASE_URL 格式不正确。'), { code: 'BAD_CONFIG' }); }
  if (base.hostname !== 'api.deepseek.com' || base.protocol !== 'https:' || base.port || base.username || base.password || base.search || base.hash || !['', '/v1'].includes(base.pathname.replace(/\/$/, ''))) {
    throw Object.assign(new Error('只允许 DeepSeek 官方 HTTPS 地址（根路径或 /v1）。'), { code: 'BAD_CONFIG' });
  }
  return { apiKey, model, url: base.href.replace(/\/$/, '') + '/chat/completions' };
}
