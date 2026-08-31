import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';

const root = fileURLToPath(new URL('..', import.meta.url));
let dir, child, base, upstream, upstreamBase, calls = [], mode = 'normal';
const headers = { 'Content-Type': 'application/json', 'X-Tarot-Request': '1' };
const post = (route, body, extra = {}) => fetch(base + route, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
const chatBody = (kind = 'openai') => ({ provider: { kind, baseURL: upstreamBase, apiKey: 'test-secret' }, model: 'fixture', messages: [{ role: 'user', content: 'hello' }] });

before(async () => {
  upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    calls.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    if (mode === 'redirect') { res.writeHead(307, { Location: upstreamBase + '/stolen' }); res.end(); return; }
    if (mode === 'error') { res.writeHead(401); res.end(JSON.stringify({ error: { message: 'leaked test-secret' } })); return; }
    if (req.url.endsWith('/models')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixture' }] })); return; }
    if (mode === 'missing-html') { res.end('<html>test-secret error page</html>'); return; }
    if (mode === 'missing-json') { res.end('{"error":"test-secret"}'); return; }
    if (mode === 'missing-garbage') { res.end('not SSE\n\ndata: {"type":"response.output_text.delta","delta":"bad"}\n\n'); return; }
    if (mode === 'missing-oversize') { res.end(':' + ' '.repeat(70000)); return; }
    if (mode === 'missing-unknown') { res.end('data: {"secret":"test-secret"}\n\n'); return; }
    if (!mode.startsWith('missing-')) res.setHeader('Content-Type', mode === 'wrong-type' ? 'text/html' : 'text/event-stream');
    if (mode === 'missing-fragmented') {
      res.write(': keepalive\r\n\r\nevent: response.created\r\ndata: {"type":"response.created"}\r\n\r\nda');
      await new Promise(r => setTimeout(r, 5));
      res.write('ta: {"type":"response.output_text.delta","delta":"hello"}\r\n\r\n');
      res.end('data: {"type":"response.completed"}\r\n\r\n'); return;
    }
    const events = req.url.endsWith('/responses')
      ? [{ type: 'response.output_text.delta', delta: 'hello' }, { type: 'response.completed' }]
      : req.url.endsWith('/messages')
        ? [{ type: 'content_block_delta', delta: { text: 'hello' } }, { type: 'message_stop' }]
        : [{ choices: [{ delta: { content: 'hello' } }] }, '[DONE]'];
    for (const e of events) res.write(`data: ${typeof e === 'string' ? e : JSON.stringify(e)}\r\n\r\n`);
    res.end();
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tarot-test-'));
  await fs.mkdir(path.join(dir, 'public'));
  await fs.writeFile(path.join(dir, 'public', 'index.html'), '<!doctype html><title>fixture</title>');
  await fs.writeFile(path.join(dir, 'private.txt'), 'PRIVATE FIXTURE');
  await fs.mkdir(path.join(dir, 'public-private'));
  await fs.writeFile(path.join(dir, 'public-private', 'private.txt'), 'PRIVATE FIXTURE');
  await fs.symlink(path.join(dir, 'public-private'), path.join(dir, 'public', 'outside'), 'junction');
  await fs.symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  await fs.mkdir(path.join(dir, '.dsh'));
  await fs.writeFile(path.join(dir, '.dsh', 'settings.yaml'), 'llm-pi-ai:\n  providers:\n    fixture:\n      api: openai-completions\n      baseURL: ' + upstreamBase + '\n      apiKeyEnv: FIXTURE_KEY\n      models: [fixture]\n');
  await fs.writeFile(path.join(dir, '.dsh', '.credentials.yaml'), 'refs:\n  FIXTURE_KEY: test-secret\n');
  await fs.copyFile(path.join(root, 'server.mjs'), path.join(dir, 'server.mjs'));
  child = spawn(process.execPath, [path.join(dir, 'server.mjs')], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: dir, USERPROFILE: dir, PORT: '0', TAROT_DSH_DIR: path.join(dir, '.dsh') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 5000);
    child.stdout.on('data', c => { const m = String(c).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('server exited during startup')); });
  });
});
after(async () => {
  if (child?.pid && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; }
  upstream?.closeAllConnections(); await new Promise(r => upstream?.close(r));
  if (dir) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('rejects DNS rebinding hosts', async () => {
  const status = await new Promise((resolve, reject) => {
    http.get(base + '/api/dsh', { headers: { ...headers, Host: 'attacker.example' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
});
test('rejects cross-origin requests before loading credentials', async () => {
  const r = await fetch(base + '/api/dsh', { headers: { ...headers, Origin: 'https://attacker.example' } });
  assert.equal(r.status, 403);
});
test('requires an explicit request header on credential-bearing API routes', async () => {
  const r = await fetch(base + '/api/dsh'); assert.equal(r.status, 403);
});
test('DSH discovery is disabled before explicit import', async () => {
  const r = await fetch(base + '/api/dsh', { headers }); const j = await r.json();
  assert.equal(j.found, false); assert.deepEqual(j.providers, []);
});
test('DSH import rejects missing consent, cross-origin requests and missing request markers', async () => {
  assert.equal((await fetch(base + '/api/dsh/import', { headers })).status, 405);
  assert.equal((await post('/api/dsh/import', {})).status, 400);
  assert.equal((await post('/api/dsh/import', { consent: true }, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await fetch(base + '/api/dsh/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"consent":true}' })).status, 403);
  const state = await (await fetch(base + '/api/dsh', { headers })).json();
  assert.equal(state.enabled, false);
});
test('explicit import enables DSH metadata and credential use without restarting or editing DSH files', async () => {
  const credentialFile = path.join(dir, '.dsh', '.credentials.yaml');
  const before = await fs.readFile(credentialFile, 'utf8');
  const count = calls.length;
  const r = await post('/api/dsh/import', { consent: true });
  assert.equal(r.status, 200);
  const metadata = await r.text();
  const imported = JSON.parse(metadata);
  assert.equal(imported.enabled, true);
  assert.equal(imported.providers[0].id, 'dsh:fixture');
  assert.ok(!metadata.includes('test-secret'));
  assert.equal(calls.length, count, 'import itself must not contact a provider');
  assert.equal((await (await fetch(base + '/api/dsh', { headers })).json()).enabled, true);
  const models = await post('/api/models', { providerId: 'dsh:fixture' });
  assert.deepEqual((await models.json()).models, ['fixture']);
  assert.equal(calls.at(-1).headers.authorization, 'Bearer test-secret');
  assert.equal(await fs.readFile(credentialFile, 'utf8'), before);
  const again = await (await post('/api/dsh/import', { consent: true })).json();
  assert.equal(again.providers.length, 1, 'reimport must not duplicate providers');
});
test('static files cannot escape through sibling prefixes or symlinks', async () => {
  for (const name of ['/..%2fpublic-private/private.txt', '/outside/private.txt']) {
    const r = await fetch(base + name); assert.equal(r.status, 403, name);
    assert.ok(!(await r.text()).includes('PRIVATE FIXTURE'));
  }
});
test('custom model discovery uses POST and rejects legacy key-bearing URLs', async () => {
  const r = await post('/api/models', { provider: chatBody().provider });
  assert.equal(r.status, 200); assert.deepEqual((await r.json()).models, ['fixture']);
  const legacy = await fetch(base + '/api/models?custom=' + encodeURIComponent(JSON.stringify(chatBody().provider)), { headers });
  assert.equal(legacy.status, 405);
});
test('rejects non-JSON and oversized request bodies', async () => {
  const bad = await post('/api/chat', {}, { 'Content-Type': 'text/plain' }); assert.equal(bad.status, 415);
  const large = await post('/api/chat', { padding: 'x'.repeat(5 * 1024 * 1024) }); assert.equal(large.status, 413);
});
for (const kind of ['openai', 'responses', 'anthropic']) {
  test(`${kind}: CRLF event streams preserve deltas`, async () => {
    const r = await post('/api/chat', chatBody(kind)); const text = await r.text();
    assert.match(text, /"v":"hello"/); assert.match(text, /"t":"done"/);
  });
}
test('Responses assistant history uses output_text content', async () => {
  const b = chatBody('responses'); b.messages.push({ role: 'assistant', content: 'earlier answer' });
  await (await post('/api/chat', b)).text();
  assert.equal(calls.at(-1).body.input[1].content[0].type, 'output_text');
});
test('missing Content-Type still accepts bounded, fragmented valid Responses events', async () => {
  mode = 'missing-fragmented';
  try {
    const text = await (await post('/api/chat', chatBody('responses'))).text();
    assert.match(text, /"v":"hello"/);
    assert.ok(!text.includes('"t":"error"'), text);
    assert.match(text, /"t":"done"/);
  } finally { mode = 'normal'; }
});
for (const invalid of ['missing-html', 'missing-json', 'missing-garbage', 'missing-oversize', 'missing-unknown', 'wrong-type']) {
  test(`untyped-stream validation rejects ${invalid} without leaking raw errors`, async () => {
    mode = invalid;
    try {
      const text = await (await post('/api/chat', chatBody('responses'))).text();
      assert.match(text, /"t":"error"/);
      assert.ok(!text.includes('test-secret'));
      assert.ok(!text.includes('"t":"delta"'));
    } finally { mode = 'normal'; }
  });
}
test('Anthropic base URLs ending /v1 do not duplicate the segment', async () => {
  const b = chatBody('anthropic'); b.provider.baseURL += '/v1';
  await (await post('/api/chat', b)).text(); assert.equal(calls.at(-1).url, '/v1/messages');
});
test('never follows upstream redirects with credentials', async () => {
  mode = 'redirect'; const start = calls.length;
  try { await (await post('/api/chat', chatBody())).text(); assert.equal(calls.length - start, 1); } finally { mode = 'normal'; }
});
test('upstream errors cannot echo a secret into the browser', async () => {
  mode = 'error';
  try { const r = await post('/api/chat', chatBody()); assert.ok(!(await r.text()).includes('test-secret')); } finally { mode = 'normal'; }
});
test('malformed URL returns 400 and leaves the server healthy', async () => {
  let status;
  try { status = (await fetch(base + '/%E0%A4%A')).status; } catch { status = 0; }
  assert.equal(status, 400); assert.equal((await fetch(base + '/api/health')).status, 200);
});
test('health identifies this service so the launcher cannot open another app on the port', async()=>{
  const r=await fetch(base+'/api/health');assert.equal(r.headers.get('x-tarot-service'),'tarot-ritual');
  assert.deepEqual(await r.json(),{ok:true});
});

test('DSH opt-in imports metadata and uses keys without exposing or refreshing credentials', async () => {
  const oauthPath = path.join(dir, '.dsh', '.everything-oauth.json');
  const fixture = JSON.stringify({ credentials: { 'codex-oauth': { type: 'oauth', access: 'test-access', refresh: 'test-refresh', expires: 1 } } });
  await fs.writeFile(oauthPath, fixture);
  await fs.writeFile(path.join(dir, 'guard.mjs'), `
    import fs from 'node:fs';
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      if (new URL(input).hostname !== '127.0.0.1') {
        fs.writeFileSync(${JSON.stringify(path.join(dir, 'unexpected-network.txt'))}, 'unexpected network attempt');
        throw new Error('External requests blocked by test');
      }
      return original(input, init);
    };
  `);
  // ESM interprets a Windows drive letter as a URL scheme; use a file URL.
  const enabled = spawn(process.execPath, ['--import', pathToFileURL(path.join(dir, 'guard.mjs')).href, path.join(dir, 'server.mjs')], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: dir, USERPROFILE: dir, PORT: '0', TAROT_DSH_DIR: path.join(dir, '.dsh'), TAROT_DSH_IMPORT: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let startupError = '';
  enabled.stderr.on('data', c => { startupError += c; });
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('opt-in startup timeout')), 5000);
      enabled.on('error', e => { clearTimeout(timer); reject(e); });
      enabled.once('exit', () => { clearTimeout(timer); reject(new Error('opt-in server exited: ' + startupError)); });
      enabled.stdout.on('data', c => { const m = String(c).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    });
    const metadata = await (await fetch(address + '/api/dsh', { headers })).text();
    assert.equal(JSON.parse(metadata).found, true);
    for (const secret of ['test-secret', 'test-access', 'test-refresh']) assert.ok(!metadata.includes(secret));
    const r = await fetch(address + '/api/models', { method: 'POST', headers, body: JSON.stringify({ providerId: 'dsh:fixture' }) });
    assert.deepEqual((await r.json()).models, ['fixture']);
    assert.equal(calls.at(-1).headers.authorization, 'Bearer test-secret');
    const expired = await fetch(address + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ ...chatBody(), providerId: 'dsh:codex-oauth' }) });
    assert.equal(expired.status, 401);
    assert.equal(await fs.readFile(oauthPath, 'utf8'), fixture);
    assert.equal(await fs.stat(path.join(dir, 'unexpected-network.txt')).then(() => true, () => false), false);
  } finally {
    if (enabled.pid && enabled.exitCode === null) { const done = once(enabled, 'exit'); enabled.kill(); await done; }
  }
});
