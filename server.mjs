// ============================================================================
// 圣仪服务 · 本地服务器（仅绑定 127.0.0.1）
//  - 静态站点
//  - /api/dsh      显式启用后只读导入 DSH；凭据不返回浏览器
//  - /api/chat     多协议流式代理：openai-completions / openai-responses / anthropic-messages
//  - /api/models   模型列表探测
//  - 默认只读 OAuth；可显式委托本机 DSH 共享凭据管理器续期 Codex
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { load as loadYaml } from 'js-yaml';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DSH_DIR = process.env.TAROT_DSH_DIR || path.join(os.homedir(), '.dsh');
const PORT = Number(process.env.PORT ?? 8642);
const HOST = '127.0.0.1';
const MAX_BODY = 4 * 1024 * 1024;
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('PORT must be an integer from 0 to 65535');

function fail(status, message) { return Object.assign(new Error(message), { status, publicMessage: message }); }
function publicError(e) { return e.publicMessage || '请求失败，请检查服务地址、凭据或网络连接。'; }
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function guardRequest(req) {
  const port = server.address().port;
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host)) throw fail(403, '不允许的 Host');
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail(403, '不允许的 Origin');
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) throw fail(403, '不允许的请求来源');
}

function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw fail(415, '需要 application/json');
  if (Number(req.headers['content-length']) > MAX_BODY) throw fail(413, '请求体超过 4 MiB 限制');
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { chunks.length = 0; reject(fail(413, '请求体超过 4 MiB 限制')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch { reject(fail(400, '无效的 JSON 请求')); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(fail(400, '请求已取消')));
  });
}

function validateProvider(provider) {
  if (!provider || !['openai', 'responses', 'anthropic'].includes(provider.kind)) throw fail(400, '无效的协议类型');
  let endpoint;
  try { endpoint = new URL(provider.baseURL); } catch { throw fail(400, '无效的 Base URL'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) throw fail(400, '远程 Base URL 必须使用 HTTPS；HTTP 仅限本机');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw fail(400, 'Base URL 不能包含凭据、查询参数或片段');
  return { ...provider, baseURL: endpoint.href.replace(/\/+$/, '') };
}

function validateMessages(body) {
  if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 256) throw fail(400, '缺少或无效的 model');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100) throw fail(400, '无效的 messages');
  for (const m of body.messages) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role)) throw fail(400, '无效的消息角色');
    if (typeof m.content === 'string') continue;
    if (!Array.isArray(m.content) || !m.content.length) throw fail(400, '无效的消息内容');
    for (const part of m.content) {
      if (part?.type === 'text' && typeof part.text === 'string') continue;
      if (m.role === 'user' && part?.type === 'image_url' && /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(part.image_url?.url || '')) continue;
      throw fail(400, '图片必须是用户消息中的本地 base64 图片');
    }
  }
  if (body.maxTokens != null && (!Number.isInteger(body.maxTokens) || body.maxTokens < 1 || body.maxTokens > 32768)) throw fail(400, '无效的 maxTokens');
  if (body.temperature != null && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2)) throw fail(400, '无效的 temperature');
}

// ---- 工具 -------------------------------------------------------------------
function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function readYamlSafe(p) { try { return loadYaml(fs.readFileSync(p, 'utf8')); } catch { return null; } }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mjs': 'text/javascript',
};

async function serveStatic(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'Method Not Allowed');
    if (pathname.includes('\0')) throw fail(400, '无效的路径');
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(PUBLIC_DIR, rel);
    const inside = (base, name) => name.startsWith(base + path.sep);
    if (!inside(PUBLIC_DIR, file)) throw fail(403, 'Forbidden');
    let real, st;
    try { real = await fs.promises.realpath(file); st = await fs.promises.stat(real); }
    catch { throw fail(404, 'Not Found'); }
    if (!inside(await fs.promises.realpath(PUBLIC_DIR), real)) throw fail(403, 'Forbidden');
    if (!st.isFile() || rel.split(/[\\/]/).some(s => s.startsWith('.'))) throw fail(404, 'Not Found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(real);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
}

function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
}
function sseSend(res, obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }

// ---- DSH 导入 ------------------------------------------------------------------
const API_KIND = {
  'openai-completions': 'openai',
  'openai-responses': 'responses',
  'anthropic-messages': 'anthropic',
};
// Consent can come from startup configuration or the same-origin import button.
// Button consent lives only for this local server process, never in DSH files.
let dshImportEnabled = process.env.TAROT_DSH_IMPORT === '1';
const dshOAuthRefreshEnabled = process.env.TAROT_DSH_OAUTH_REFRESH === '1';
let sharedCodexResolver;

function loadDsh() {
  if (!dshImportEnabled) return { found: false, enabled: false, providers: [] };
  const settings = readYamlSafe(path.join(DSH_DIR, 'settings.yaml'));
  const creds = readYamlSafe(path.join(DSH_DIR, '.credentials.yaml'));
  const oauthFile = readJsonSafe(path.join(DSH_DIR, '.everything-oauth.json'));
  if (!settings && !oauthFile && !creds) return { found: false, enabled: true, providers: [] };

  const refs = creds?.refs || {};
  const providers = [];
  const seen = new Set();

  // 1) settings.yaml 中的 API-key providers
  const sp = settings?.['llm-pi-ai']?.providers || {};
  for (const [key, p] of Object.entries(sp)) {
    if (!p) continue;
    const kind = API_KIND[p.api] || (p.baseURL?.includes('anthropic') ? 'anthropic' : null);
    const keyEnv = p.apiKeyEnv || null;
    let baseURL = p.baseURL || null;
    let note = null;
    if (key === 'kimi-coding' && !baseURL) { baseURL = 'https://api.kimi.com/anthropic'; note = 'Kimi For Coding（Anthropic 兼容端点）'; }
    const effKind = kind || (key === 'kimi-coding' ? 'anthropic' : null);
    if (!baseURL || !effKind) continue;
    const models = (p.models || []).map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean);
    providers.push({
      id: `dsh:${key}`,
      label: p.displayName || key,
      kind: effKind,
      baseURL,
      models,
      keyEnv,
      hasKey: keyEnv ? Boolean(refs[keyEnv]) : false,
      oauth: null,
      note,
      source: 'DSH',
    });
    seen.add(keyEnv);
  }

  // 2) OAuth 登录态（.everything-oauth.json）
  const oc = oauthFile?.credentials || {};
  const routes = oauthFile?.routes || {};
  const codexCred = oc['openai-codex'] || oc['codex-oauth'] || null;
  if (codexCred?.type === 'oauth') {
    const route = routes['codex-oauth'] || {};
    providers.push({
      id: 'dsh:codex-oauth',
      label: 'ChatGPT · Codex (OAuth)',
      kind: 'responses',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      models: route.enabled?.length ? route.enabled : (route.models || []),
      keyEnv: null, hasKey: true, oauth: 'codex',
      note: '复用 DSH 中已登录的 ChatGPT 账户',
      source: 'DSH OAuth',
    });
  }
  if (oc.anthropic?.type === 'oauth') {
    providers.push({
      id: 'dsh:claude-oauth',
      label: 'Claude (OAuth)',
      kind: 'anthropic',
      baseURL: 'https://api.anthropic.com',
      models: [],
      keyEnv: null, hasKey: true, oauth: 'anthropic',
      note: '复用 DSH 中已登录的 Claude 账户',
      source: 'DSH OAuth',
    });
  }
  // gemini-oauth 与 settings 中的 gemini 重复（同一 GEMINI_API_KEY），不重复导入

  return { found: true, enabled: true, oauthRefreshEnabled: dshOAuthRefreshEnabled, providers };
}

function resolveCredential(pid, dsh) {
  const p = dsh.providers.find(x => x.id === pid);
  if (!p) return null;
  if (p.oauth === 'codex') {
    const oc = readJsonSafe(path.join(DSH_DIR, '.everything-oauth.json'));
    const c = oc?.credentials?.['openai-codex'] || oc?.credentials?.['codex-oauth'];
    return c ? { type: 'oauth-codex', cred: c } : null;
  }
  if (p.oauth === 'anthropic') {
    const oc = readJsonSafe(path.join(DSH_DIR, '.everything-oauth.json'));
    const c = oc?.credentials?.anthropic;
    return c ? { type: 'oauth-anthropic', cred: c } : null;
  }
  if (p.keyEnv) {
    const creds = readYamlSafe(path.join(DSH_DIR, '.credentials.yaml'));
    const v = creds?.refs?.[p.keyEnv];
    if (v) return { type: 'api-key', key: String(v).trim() };
  }
  return null;
}

// ---- OAuth 只读复用 ----------------------------------------------------------
async function getAccessToken(kind, cred) {
  if (kind === 'oauth-codex' || kind === 'oauth-anthropic') {
    if (!cred?.access || Number(cred.expires || 0) <= Date.now() + 60000) {
      throw fail(401, 'OAuth 登录已过期，请在 DSH 中刷新或重新登录后重试。');
    }
    return cred.access;
  }
  return cred.key;
}

async function resolveProvider(body) {
  let provider, cred;
  if (body.providerId) {
    const dsh = loadDsh();
    provider = dsh.providers.find(p => p.id === body.providerId);
    if (!provider) throw fail(400, '未找到该 DSH provider，请检查是否已启用导入');
    if (provider.oauth === 'codex' && dshOAuthRefreshEnabled) {
      if (!sharedCodexResolver) {
        const {createDshCodexResolver} = await import('./server/dsh-oauth.mjs');
        sharedCodexResolver = createDshCodexResolver({dshDir:DSH_DIR,modulePath:process.env.TAROT_DSH_OAUTH_MODULE});
      }
      return {provider:validateProvider(provider),cred:await sharedCodexResolver()};
    }
    cred = resolveCredential(body.providerId, dsh);
    if (!cred) throw fail(401, '无法解析该 provider 的凭据');
    cred = { ...cred, token: await getAccessToken(cred.type, cred.cred || cred) };
  } else {
    provider = body.provider;
    cred = { type: 'api-key', token: provider?.apiKey };
  }
  provider = validateProvider(provider);
  if (typeof cred.token !== 'string' || !cred.token.trim() || /[\r\n]/.test(cred.token)) throw fail(401, '缺少或无效的 API Key');
  return { provider, cred };
}

function upstreamURL(provider, resource) {
  const base = provider.baseURL.replace(/\/+$/, '');
  return base + (provider.kind === 'anthropic' && !base.endsWith('/v1') ? '/v1' : '') + '/' + resource;
}

// ---- 消息翻译 --------------------------------------------------------------------
function flattenText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(p => p.type === 'text').map(p => p.text).join('\n');
  }
  return '';
}
function hasImages(content) {
  return Array.isArray(content) && content.some(p => p.type === 'image_url' || p.type === 'image');
}

function toOpenAI(messages) {
  return messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    if (!hasImages(m.content)) return { role: m.role, content: flattenText(m.content) };
    return {
      role: m.role,
      content: m.content.map(p => p.type === 'text'
        ? { type: 'text', text: p.text }
        : { type: 'image_url', image_url: { url: p.image_url?.url || p.url } }),
    };
  });
}

function toResponses(messages) {
  const sys = messages.filter(m => m.role === 'system').map(m => flattenText(m.content)).join('\n');
  const input = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: Array.isArray(m.content)
      ? m.content.map(p => p.type === 'text'
        ? { type: m.role === 'assistant' ? 'output_text' : 'input_text', text: p.text }
        : { type: 'input_image', image_url: p.image_url?.url || p.url })
      : [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: flattenText(m.content) }],
  }));
  return { instructions: sys || undefined, input };
}

function toAnthropic(messages) {
  const sys = messages.filter(m => m.role === 'system').map(m => flattenText(m.content)).join('\n');
  const out = messages.filter(m => m.role !== 'system').map(m => {
    let content;
    if (Array.isArray(m.content)) {
      content = m.content.map(p => {
        if (p.type === 'text') return { type: 'text', text: p.text };
        const durl = p.image_url?.url || p.url || '';
        const mm = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(durl);
        if (!mm) return { type: 'text', text: '[图片无法解析]' };
        return { type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } };
      });
    } else content = [{ type: 'text', text: flattenText(m.content) }];
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
  });
  return { system: sys || undefined, messages: out };
}

// ---- 上游请求与流式归一 ------------------------------------------------------------
async function streamUpstream(res, provider, cred, body, signal) {
  const headers = { 'Content-Type': 'application/json' };
  let endpoint;
  let payload;

  if (provider.kind === 'openai') {
    endpoint = provider.baseURL.replace(/\/+$/, '') + '/chat/completions';
    headers['Authorization'] = `Bearer ${cred.token}`;
    payload = {
      model: body.model, stream: true, messages: toOpenAI(body.messages),
      temperature: body.temperature, max_tokens: body.maxTokens,
      stream_options: { include_usage: false },
    };
  } else if (provider.kind === 'responses') {
    endpoint = provider.baseURL.replace(/\/+$/, '') + '/responses';
    headers['Authorization'] = `Bearer ${cred.token}`;
    if (cred.type === 'oauth-codex') {
      headers['chatgpt-account-id'] = cred.cred.accountId || '';
      headers['OpenAI-Beta'] = 'responses=experimental';
      headers['originator'] = 'tarot-ritual';
      headers['session_id'] = crypto.randomUUID();
    }
    const t = toResponses(body.messages);
    payload = { model: body.model, stream: true, store: false, instructions: t.instructions, input: t.input };
    if (cred.type !== 'oauth-codex') {
      if (body.temperature != null) payload.temperature = body.temperature;
      if (body.maxTokens) payload.max_output_tokens = body.maxTokens;
    }
  } else if (provider.kind === 'anthropic') {
    endpoint = upstreamURL(provider, 'messages');
    if (cred.type === 'oauth-anthropic') {
      headers['Authorization'] = `Bearer ${cred.token}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20';
    } else {
      headers['x-api-key'] = cred.token;
    }
    headers['anthropic-version'] = '2023-06-01';
    const t = toAnthropic(body.messages);
    payload = {
      model: body.model, stream: true, max_tokens: body.maxTokens || 4096,
      system: t.system, messages: t.messages, temperature: body.temperature ?? 0.7,
    };
  } else {
    throw fail(400, '未知的协议类型');
  }

  const up = await fetch(endpoint, {
    method: 'POST', headers, body: JSON.stringify(payload),
    signal, redirect: 'manual',
  });

  if (!up.ok) {
    await up.body?.cancel();
    throw fail(502, `AI 服务返回 HTTP ${up.status}，请检查所选模型、凭据与服务地址。`);
  }
  const contentType = up.headers.get('content-type')?.trim();
  if (contentType && contentType.split(';')[0].trim().toLowerCase() !== 'text/event-stream') {
    await up.body?.cancel();
    throw fail(502, 'AI 服务未返回事件流');
  }
  const reader = up.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  // Some Codex responses omit Content-Type. Verify actual SSE framing and a
  // recognized protocol event before accepting them; never forward raw bodies.
  let verifiedStream = Boolean(contentType), probeBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (!verifiedStream) {
        probeBytes += value.byteLength;
        if (probeBytes > 64 * 1024) throw fail(502, 'AI 服务未返回有效事件流');
      }
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buf))) {
        const event = buf.slice(0, boundary.index);
        buf = buf.slice(boundary.index + boundary[0].length);
        if (!verifiedStream && event.split(/\r?\n/).some(line => line && !/^(?:data:|event:|id:|retry:|:)/.test(line))) {
          throw fail(502, 'AI 服务未返回有效事件流');
        }
        const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data === '[DONE]') {
          if (!verifiedStream) throw fail(502, 'AI 服务未返回有效事件流');
          sseSend(res, { t: 'done' }); return;
        }
        let j; try { j = JSON.parse(data); } catch { throw fail(502, 'AI 服务返回无效的事件数据'); }
        if (!verifiedStream) {
          const recognized = provider.kind === 'responses' ? typeof j?.type === 'string' && j.type.startsWith('response.')
            : provider.kind === 'openai' ? Array.isArray(j?.choices)
              : ['message_start', 'content_block_start', 'content_block_delta', 'message_delta', 'message_stop'].includes(j?.type);
          if (!recognized) throw fail(502, 'AI 服务未返回有效事件流');
          verifiedStream = true;
        }
        if (j.type === 'error' || j.error || ['response.failed', 'response.incomplete'].includes(j.type)) throw fail(502, 'AI 服务返回错误或不完整响应，请重试。');
        const delta = j.choices?.[0]?.delta?.content
          ?? (j.type === 'response.output_text.delta' ? j.delta : undefined)
          ?? (j.type === 'content_block_delta' ? j.delta?.text : undefined);
        if (typeof delta === 'string' && delta) sseSend(res, { t: 'delta', v: delta });
        if (['response.completed', 'message_stop'].includes(j.type)) { sseSend(res, { t: 'done' }); return; }
      }
      if (buf.length > MAX_BODY) throw fail(502, 'AI 事件过大');
    }
    throw fail(502, 'AI 响应提前中断，请重试。');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// ---- 模型列表探测 ------------------------------------------------------------------
async function listModels(provider, cred, signal) {
  const headers = {};
  if (provider.kind === 'anthropic') {
    if (cred.type === 'oauth-anthropic') {
      headers['Authorization'] = `Bearer ${cred.token}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20';
    } else headers['x-api-key'] = cred.token;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${cred.token}`;
  }
  const r = await fetch(upstreamURL(provider, 'models'), { headers, signal, redirect: 'manual' });
  if (!r.ok) { await r.body?.cancel(); throw fail(502, `模型列表请求失败 (HTTP ${r.status})`); }
  const j = await r.json();
  const models = (j.data || j.models || []).map(m => m.id || m.name || m).filter(m => typeof m === 'string');
  return models;
}

// ---- HTTP 服务 --------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.on('close', onClose);
  try {
    guardRequest(req);
    let parsed, pathname;
    try { parsed = new URL(req.url, `http://${req.headers.host}`); pathname = decodeURIComponent(parsed.pathname); }
    catch { throw fail(400, '无效的 URL'); }
    if (pathname === '/api/health' && req.method === 'GET') {
      res.setHeader('X-Tarot-Service', 'tarot-ritual');
      json(res, 200, { ok: true }); return;
    }
    if (pathname.startsWith('/api/')) {
      if (req.headers['x-tarot-request'] !== '1') throw fail(403, '缺少同源请求标记');
      if (pathname === '/api/dsh/import') {
        if (req.method !== 'POST') throw fail(405, 'Method Not Allowed');
        const body = await readBody(req);
        if (body.consent !== true) throw fail(400, '请先确认导入本机 DSH 配置');
        dshImportEnabled = true;
        json(res, 200, loadDsh()); return;
      }
      if (pathname === '/api/dsh') {
        if (req.method !== 'GET') throw fail(405, 'Method Not Allowed');
        json(res, 200, loadDsh()); return;
      }
      if (!['/api/models', '/api/chat'].includes(pathname)) throw fail(404, 'Not Found');
      if (req.method !== 'POST') throw fail(405, 'Method Not Allowed');
      const body = await readBody(req);
      if (pathname === '/api/chat') validateMessages(body);
      const { provider, cred } = await resolveProvider(body);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(pathname === '/api/chat' ? 120000 : 20000)]);
      if (pathname === '/api/models') { json(res, 200, { models: await listModels(provider, cred, signal) }); return; }
      sseInit(res);
      await streamUpstream(res, provider, cred, body, signal);
      res.end(); return;
    }
    await serveStatic(req, res, pathname);
  } catch (e) {
    if (res.destroyed) return;
    if (res.headersSent) {
      sseSend(res, { t: 'error', v: publicError(e) });
      sseSend(res, { t: 'done' });
      res.end();
    } else json(res, e.status || 500, { error: publicError(e) });
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(PORT, HOST, () => {
  console.log(`塔罗圣仪已开启 · http://${HOST}:${server.address().port}`);
});
