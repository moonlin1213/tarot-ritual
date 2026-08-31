import path from 'node:path';
import {pathToFileURL} from 'node:url';

const fail = (status, publicMessage) => Object.assign(new Error(publicMessage), {status, publicMessage});

// Optional local integration: the installed DSH package owns the refresh logic,
// its cross-process lock, and atomic 0600 writes. Never implement a second token
// refresher or return credential material to a browser.
export function createDshCodexResolver({dshDir, modulePath}) {
  let sessionPromise, pending;
  async function session() {
    if (!modulePath || !path.isAbsolute(modulePath)) throw fail(503, '请配置本机 DSH 登录续期组件，或关闭自动续期后重新导入。');
    if (!sessionPromise) sessionPromise = (async () => {
      try {
        const {EverythingOAuthSession, EverythingOAuthStore} = await import(pathToFileURL(modulePath).href);
        const store = new EverythingOAuthStore(path.join(dshDir, '.everything-oauth.json'));
        return {store, manager:new EverythingOAuthSession(store)};
      } catch {
        throw fail(503, '无法加载本机 DSH 登录续期组件，请检查组件是否仍已安装。');
      }
    })().catch(error => { sessionPromise = null; throw error; });
    return sessionPromise;
  }
  async function resolve() {
    const {store, manager} = await session();
    try {
      if (!await store.read('openai-codex')) {
        // Older imports only have an alias. Re-read it while holding the same
        // file lock as DSH and never replace an existing canonical credential.
        await store.modify('openai-codex', async current => {
          if (current) return undefined;
          const alias = (await store.snapshot()).credentials['codex-oauth'];
          return alias?.type === 'oauth' ? alias : undefined;
        });
      }
      const resolved = await manager.models.getAuth('openai-codex');
      const token = resolved?.auth?.apiKey;
      const credential = await store.read('openai-codex');
      let accountId = resolved?.auth?.headers?.['chatgpt-account-id'];
      if (!accountId && token) {
        try { accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())['https://api.openai.com/auth']?.chatgpt_account_id; } catch {}
      }
      accountId ||= credential?.access === token ? credential.accountId : undefined;
      if (typeof token !== 'string' || !token || /[\r\n]/.test(token) || !accountId || /[\r\n]/.test(accountId)) {
        throw new Error('missing usable Codex authorization');
      }
      return {type:'oauth-codex',token,cred:{accountId}};
    } catch {
      // SDK errors may contain tokens, upstream bodies, or private file paths.
      throw fail(401, 'Codex 登录续期失败，请在 DSH 中检查或重新授权后重试；原凭据未被清除。');
    }
  }
  return async () => {
    if (!pending) pending = resolve().finally(() => { pending = null; });
    let timer;
    try {
      return await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail(503, 'DSH 登录续期等待超时，请检查代理或稍后重试。')), 30000);
      })]);
    } finally { clearTimeout(timer); }
  };
}
