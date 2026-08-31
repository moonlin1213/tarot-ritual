// Optional same-origin protocol. Importing this module performs no I/O.
const PROTOCOL = 'cove-tarot-companion-v1';
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function createCompanionAdapter(config, { fetchImpl = globalThis.fetch } = {}) {
  if (config == null) return null;
  if (config.protocol !== PROTOCOL || config.apiBase !== '/companion/v1' || typeof config.sessionId !== 'string' || !ID.test(config.sessionId)) {
    throw new Error('Invalid companion configuration');
  }
  const endpoint = `${config.apiBase}/sessions/${config.sessionId}`;
  const key = `${PROTOCOL}.outbox.${config.sessionId}`;
  let session, csrf, blocked = false, chain = Promise.resolve();
  const serial = fn => {
    const next = chain.then(fn);
    chain = next.catch(() => {});
    return next;
  };
  function outbox() {
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(entries) || entries.some(e => !['draw', 'reveal'].includes(e.route) || typeof e.body !== 'string')) {
      throw new Error('Invalid companion outbox; keep this session frozen');
    }
    return entries;
  }
  function persist(entries) {
    if (entries.length) localStorage.setItem(key, JSON.stringify(entries));
    else localStorage.removeItem(key);
  }
  function request(route, body, signal) {
    return fetchImpl(endpoint + route, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Companion-CSRF': csrf },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  }
  async function json(response) {
    const value = await response.json();
    if (!response.ok) throw new Error(value?.error || `Companion request failed (${response.status})`);
    return value;
  }
  async function bootstrap() {
    const value = await json(await request(''));
    if (value.session?.id !== config.sessionId || !Number.isInteger(value.session.revision) || typeof value.csrf_token !== 'string' || !value.csrf_token) {
      throw new Error('Invalid companion session');
    }
    session = value.session; csrf = value.csrf_token;
    return session;
  }
  async function flush() {
    const entries = outbox();
    while (entries.length) {
      const entry = entries[0], body = JSON.parse(entry.body);
      const receipt = await json(await request('/' + entry.route, entry.body));
      if (receipt.session_id !== config.sessionId || receipt.event_id !== body.event_id || !Number.isInteger(receipt.revision) || receipt.revision < 0) {
        throw new Error('Invalid companion receipt');
      }
      session.revision = Math.max(session.revision, receipt.revision);
      if (entry.route === 'draw') session.draws = body.draws;
      entries.shift(); persist(entries);
    }
  }
  async function restoreNow() {
    await bootstrap();
    if (outbox().length && !['returned', 'stopped', 'deleted'].includes(session.phase)) { await flush(); await bootstrap(); }
    blocked = false;
    return session;
  }
  function durable(route, facts) {
    // Capture caller data now, not after awaiting another event.
    const body = JSON.stringify({ event_id: facts.event_id || crypto.randomUUID(), ...facts });
    return serial(async () => {
      if (blocked) throw new Error('Companion ACK pending; restore this session before continuing');
      if (!session) await restoreNow();
      if (['returned', 'stopped', 'deleted'].includes(session.phase)) throw new Error('Companion session is read-only');
      if (route === 'draw' && session.draws?.length) throw new Error('Companion draw is already committed');
      if (route === 'reveal' && !session.draws?.length) throw new Error('Draw ACK required before reveal');
      try {
        if (outbox().length) throw new Error('Companion ACK pending');
        persist([{ route, body }]);
        await flush();
        return { session_id: config.sessionId, event_id: JSON.parse(body).event_id, revision: session.revision };
      } catch (error) { blocked = true; throw error; }
    });
  }
  return {
    restore: () => serial(async () => {
      try { return await restoreNow(); } catch (error) { blocked = true; throw error; }
    }),
    commitDraw: body => durable('draw', { question: body.question, spread_id: body.spread_id, draws: body.draws, ...(body.event_id ? { event_id: body.event_id } : {}) }),
    reveal: body => durable('reveal', { positions: body.positions, ...(body.event_id ? { event_id: body.event_id } : {}) }),
    read: (body, { signal } = {}) => serial(async () => {
      if (blocked || outbox().length) throw new Error('Companion ACK pending');
      if (!session) await restoreNow();
      if (body.attempt_id !== undefined) {
        if (typeof body.attempt_id !== 'string' || !ID.test(body.attempt_id)) throw new Error('Invalid reading attempt');
        return request('/reading?attempt_id=' + body.attempt_id, undefined, signal);
      }
      if (['returned', 'stopped', 'deleted'].includes(session.phase)) throw new Error('Companion session is read-only');
      const { action_id, providerId, provider, model, temperature, maxTokens } = body;
      if (typeof action_id !== 'string' || !ID.test(action_id)) throw new Error('A stable reading action_id is required');
      return request('/reading', { action_id, providerId, provider, model, temperature, maxTokens }, signal);
    }),
    returnToChat: () => serial(async () => {
      await restoreNow();
      const receipt = await json(await request('/return', { revision: session.revision }));
      session.phase = 'returned';
      return receipt;
    }),
    stop: () => serial(async () => {
      if (!csrf) await bootstrap();
      const result = await json(await request('/stop', {}));
      session.phase = 'stopped';
      return result;
    }),
  };
}
