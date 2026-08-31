import test from 'node:test';
import assert from 'node:assert/strict';
import { chat } from '../public/js/ai.js';

const mod = await import('../public/js/companion-adapter.js').catch(() => ({}));
const config = { protocol: 'cove-tarot-companion-v1', sessionId: 'synthetic-session', apiBase: '/companion/v1' };
const draw = { question: 'Synthetic question', spread_id: 'single', draws: [{ position: 0, card_id: 'M00', reversed: true }] };
const blank = () => ({ id: config.sessionId, conversation_id: 'synthetic-conversation', revision: 0, phase: 'accepted', question: '', spread_id: null, draws: [], reading: null });
function fixture() {
  const values = new Map(), calls = [];
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  let session = blank(), loseAck = false;
  const receipts = new Map();
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, ...init });
    const body = init.body && JSON.parse(init.body);
    if (init.method !== 'POST') return Response.json({ session, csrf_token: 'synthetic-csrf' });
    if (url.endsWith('/draw') || url.endsWith('/reveal')) {
      if (!receipts.has(body.event_id)) {
        session = { ...session, revision: session.revision + 1 };
        if (url.endsWith('/draw')) session = { ...session, ...draw, draws: body.draws.map(d => ({ ...d, revealed: false })) };
        receipts.set(body.event_id, { session_id: session.id, event_id: body.event_id, revision: session.revision });
      }
      if (loseAck) { loseAck = false; throw new Error('synthetic lost ACK'); }
      return Response.json(receipts.get(body.event_id));
    }
    return Response.json({ ok: true });
  };
  const create = () => { assert.equal(typeof mod.createCompanionAdapter, 'function'); return mod.createCompanionAdapter(config, { fetchImpl }); };
  return { create, calls, values, loseAck: () => { loseAck = true; }, setSession: s => { session = s; } };
}

test('no config leaves standalone inactive; untrusted bases and session IDs fail closed', () => {
  assert.equal(typeof mod.createCompanionAdapter, 'function');
  assert.equal(mod.createCompanionAdapter(null), null);
  for (const apiBase of ['https://foreign.example/companion/v1', '//foreign.example/companion/v1', '/companion/v1/', '/api', '/companion/v1?x']) {
    assert.throws(() => mod.createCompanionAdapter({ ...config, apiBase }));
  }
  for (const sessionId of ['', '../escape', 'a/b', 'é', 'x'.repeat(129), 123]) assert.throws(() => mod.createCompanionAdapter({ ...config, sessionId }));
  assert.throws(() => mod.createCompanionAdapter({ ...config, protocol: 'other' }));
});

test('lost draw ACK survives reload and replays byte-identically before reveal', async () => {
  const f = fixture(), first = f.create();
  await first.restore(); f.loseAck();
  await assert.rejects(first.commitDraw(draw), /ACK/);
  assert.ok([...f.values.values()].some(v => v.includes('M00')));
  const original = f.calls.find(c => c.url.endsWith('/draw'));
  const restored = await f.create().restore();
  const posts = f.calls.filter(c => c.method === 'POST');
  assert.equal(posts.length, 2); assert.equal(posts[1].body, original.body);
  assert.equal(restored.draws[0].reversed, true);
  assert.equal(restored.revision, 1);
  assert.ok(![...f.values.values()].some(v => v.includes('M00')));
  assert.equal(original.credentials, 'same-origin'); assert.equal(original.cache, 'no-store');
  assert.equal(original.headers['X-Companion-CSRF'], 'synthetic-csrf');
});

test('an unacknowledged draw rejects replacement and reveal; session outboxes cannot bleed', async () => {
  const f = fixture(), a = f.create(); await a.restore(); f.loseAck();
  await assert.rejects(a.commitDraw(draw));
  await assert.rejects(a.commitDraw({ ...draw, question: 'Replacement' }));
  await assert.rejects(a.reveal({ positions: [0] }));
  const other = mod.createCompanionAdapter({ ...config, sessionId: 'another-session' }, { fetchImpl: async () => Response.json({ session: { ...blank(), id: 'another-session' }, csrf_token: 'other-csrf' }) });
  assert.deepEqual((await other.restore()).draws, []);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});

test('reveal waits for draw ACK even when requested concurrently', async () => {
  const f = fixture(); let release;
  const calls = [];
  const a = mod.createCompanionAdapter(config, { fetchImpl: async (url, init = {}) => {
    calls.push(url);
    if (url.endsWith('/draw')) await new Promise(r => { release = r; });
    if (init.method === 'POST') return Response.json({ session_id: config.sessionId, event_id: JSON.parse(init.body).event_id, revision: calls.length });
    return Response.json({ session: blank(), csrf_token: 'synthetic-csrf' });
  } });
  await a.restore();
  const committed = a.commitDraw(draw), revealed = a.reveal({ positions: [0] });
  await new Promise(r => setImmediate(r));
  assert.equal(calls.some(u => u.endsWith('/reveal')), false);
  release(); await committed; await revealed;
  assert.equal(calls.at(-1).endsWith('/reveal'), true);
});

test('storage failure or mismatched receipt cannot pretend a draw is durable', async () => {
  const f = fixture(), a = f.create(); await a.restore();
  globalThis.localStorage.setItem = () => { throw new Error('storage blocked'); };
  await assert.rejects(a.commitDraw(draw));
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  fixture();
  const b = mod.createCompanionAdapter(config, { fetchImpl: async (url, init) => init?.method === 'POST'
    ? Response.json({ session_id: 'wrong', event_id: 'wrong', revision: 1 })
    : Response.json({ session: blank(), csrf_token: 'synthetic-csrf' }) });
  await b.restore(); await assert.rejects(b.commitDraw(draw), /receipt/i);
});

test('reading drops messages, forwards custom provider only ephemerally and resumes GET-only', async () => {
  const f = fixture(), calls = [];
  const a = mod.createCompanionAdapter(config, { fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    if (url.endsWith('/sessions/synthetic-session')) return Response.json({ session: blank(), csrf_token: 'synthetic-csrf' });
    return new Response('data: {"t":"done"}\n\n');
  } });
  await a.restore();
  const signal = new AbortController().signal;
  const result = await a.read({ action_id: 'synthetic-action', provider: { apiKey: 'synthetic-secret', kind: 'openai', baseURL: 'https://example.invalid/v1' }, model: 'synthetic-model', messages: [{ role: 'user', content: 'must not send' }], temperature: 0.8, maxTokens: 4096 }, { signal });
  assert.ok(result instanceof Response);
  const body = JSON.parse(calls.at(-1).body);
  assert.equal(body.messages, undefined); assert.equal(body.action_id, 'synthetic-action');
  assert.equal(body.provider.apiKey, 'synthetic-secret'); assert.equal(calls.at(-1).signal, signal);
  assert.ok(!JSON.stringify([...f.values]).includes('synthetic-secret'));
  await a.read({ attempt_id: 'synthetic-attempt', provider: { apiKey: 'do-not-send' } });
  assert.equal(calls.at(-1).url, '/companion/v1/sessions/synthetic-session/reading?attempt_id=synthetic-attempt');
  assert.equal(calls.at(-1).method, 'GET'); assert.equal(calls.at(-1).body, undefined);
});

test('return refreshes server revision, stop carries an empty JSON object', async () => {
  const f = fixture(), a = f.create(); await a.restore();
  f.setSession({ ...blank(), revision: 9 }); await a.returnToChat();
  assert.equal(f.calls.at(-2).method, 'GET');
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { revision: 9 });
  assert.ok(f.calls.at(-1).url.endsWith('/return'));
  await a.stop(); assert.ok(f.calls.at(-1).url.endsWith('/stop'));
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), {});
});

test('custom chat transport keeps the original SSE callbacks and never falls through to /api/chat', async () => {
  const deltas = [], done = [], errors = [], requests = [];
  globalThis.fetch = async () => { throw new Error('unexpected original transport'); };
  await chat({ model: 'synthetic', messages: [{ role: 'user', content: 'fixture' }], transport: async (body, { signal }) => {
    requests.push({ body, signal });
    return new Response('data: {"t":"delta","v":"saved"}\r\n\r\ndata: {"t":"error","v":"interrupted"}\n\ndata: {"t":"done"}\n\n');
  }, onDelta: v => deltas.push(v), onDone: v => done.push(v), onError: v => errors.push(v) });
  assert.deepEqual(deltas, ['saved']); assert.deepEqual(errors, ['interrupted']); assert.deepEqual(done, [false]);
  assert.equal(requests[0].body.model, 'synthetic');
});

test('restoring a terminal session preserves its pending outbox without replaying mutations', async () => {
  const f = fixture(), a = f.create(); await a.restore(); f.loseAck();
  await assert.rejects(a.commitDraw(draw));
  f.setSession({ ...blank(), phase: 'stopped', revision: 2 });
  const restored = await f.create().restore();
  assert.equal(restored.phase, 'stopped');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.ok([...f.values.values()].some(v => v.includes('M00')));
});

test('return and stop receipts immediately prevent a new paid reading in the same adapter', async () => {
  for (const action of ['returnToChat', 'stop']) {
    const f = fixture(), a = f.create(); await a.restore(); await a[action]();
    const count = f.calls.length;
    await assert.rejects(a.read({ action_id: 'new-paid-action', model: 'synthetic' }), /read-only/);
    assert.equal(f.calls.length, count);
  }
});

test('reading IDs must be strings, never coerced numbers or null', async () => {
  const f = fixture(), a = f.create(); await a.restore();
  for (const body of [{ action_id: 123 }, { attempt_id: 123 }, { attempt_id: null }]) await assert.rejects(a.read(body));
  assert.equal(f.calls.length, 1);
});
