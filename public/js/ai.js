// ============================================================================
// 神谕链路 · provider 状态与流式聊天客户端
// ============================================================================

const LS_CUSTOM = 'arcana.customProviders.v1';
const LS_SELECTED = 'arcana.selectedProvider.v1';

export const providerState = {
  dsh: { found: false, providers: [] },
  custom: [],            // {id,label,kind,baseURL,apiKey,models}
  selectedId: null,      // 'dsh:xxx' | 'custom:xxx'
  modelByProvider: {},   // pid -> model
};

export function initProviderState() {
  providerState.custom = [];
  try {
    // Remove legacy plaintext credentials. Custom providers live in memory only.
    localStorage.removeItem(LS_CUSTOM);
    const s = JSON.parse(localStorage.getItem(LS_SELECTED) || 'null');
    if (s && s.id) { providerState.selectedId = s.id; providerState.modelByProvider = s.models || {}; }
  } catch { /* 忽略坏档 */ }
}

function persist() {
  try {
    localStorage.removeItem(LS_CUSTOM);
    localStorage.setItem(LS_SELECTED, JSON.stringify({
      id: providerState.selectedId, models: providerState.modelByProvider,
    }));
  } catch { /* Storage can be disabled; the current session remains usable. */ }
}

export async function loadDsh() {
  const r = await fetch('/api/dsh', { headers: { 'X-Tarot-Request': '1' }, cache: 'no-store' });
  if (!r.ok) throw new Error('无法读取 DSH 配置');
  providerState.dsh = await r.json();
  return providerState.dsh;
}

export async function importDsh() {
  const r = await fetch('/api/dsh/import', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Tarot-Request': '1' },
    body: JSON.stringify({ consent: true }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('DSH 导入失败，请检查本地服务后重试');
  providerState.dsh = await r.json();
  return providerState.dsh;
}

export function allProviders() {
  const dsh = providerState.dsh.providers || [];
  const custom = providerState.custom.map(c => ({ ...c, id: 'custom:' + c.id, source: '手动' }));
  return [...dsh, ...custom];
}

export function getProvider(pid) {
  return allProviders().find(p => p.id === pid) || null;
}

export function addCustomProvider(p) {
  p.id = crypto.randomUUID();
  providerState.custom.push(p);
  persist();
  return p;
}

export function removeCustomProvider(pid) {
  providerState.custom = providerState.custom.filter(c => 'custom:' + c.id !== pid);
  if (providerState.selectedId === pid) providerState.selectedId = null;
  persist();
}

export function selectProvider(pid, model = null) {
  providerState.selectedId = pid;
  if (model) providerState.modelByProvider[pid] = model;
  persist();
}

export function setModel(pid, model) {
  providerState.modelByProvider[pid] = model;
  persist();
}

export function currentModel(pid) {
  return providerState.modelByProvider[pid] || null;
}

export async function fetchModels(pid) {
  const p = getProvider(pid);
  if (!p) throw new Error('provider 不存在');
  const body = p.id.startsWith('custom:')
    ? { provider: { kind: p.kind, baseURL: p.baseURL, apiKey: p.apiKey } }
    : { providerId: pid };
  const r = await fetch('/api/models', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tarot-Request': '1' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `服务返回 ${r.status}`);
  return j.models;
}

// ---- 流式对话 ------------------------------------------------------------------
export async function chat({ providerId, provider, model, messages, temperature, maxTokens, onDelta, onDone, onError, signal, transport }) {
  const body = { providerId, provider, model, messages, temperature, maxTokens };
  let reader;
  let errored = false;
  try {
    const res = await (transport ? transport(body, { signal }) : fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tarot-Request': '1' },
      body: JSON.stringify(body), signal,
    }));
    if (!res.ok || !res.body) {
      const error = await res.json().catch(() => null);
      throw new Error(error?.error || `服务返回 ${res.status}`);
    }
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('响应提前中断，请重试');
      if (signal?.aborted) return;
      buf += decoder.decode(chunk.value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buf))) {
        const event = buf.slice(0, boundary.index); buf = buf.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const j = JSON.parse(data);
        if (j.t === 'delta') onDelta?.(j.v);
        else if (j.t === 'error') { errored = true; onError?.(j.v); }
        else if (j.t === 'done') { onDone?.(!errored); return; }
      }
    }
  } catch (e) {
    if (signal?.aborted) return;
    if (!errored) onError?.(e.message || '无法连接本地服务');
    onDone?.(false);
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
