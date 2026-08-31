import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { timingSafeEqual } from 'node:crypto';

const serverSource = (await fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', '"file:///synthetic/server.mjs"');

// Execute the real request handler with only the listening socket replaced.
// These contract tests also run when localhost sockets require user approval.
function handlerFixture(token) {
  let handler;
  const server = { address: () => ({ port: 8642 }), listen() {} };
  const context = vm.createContext({
    http: { createServer: fn => { handler = fn; return server; } },
    path, url: { fileURLToPath: () => '/synthetic/server.mjs' }, os: { homedir: () => '/synthetic' },
    process: { env: token ? { COVE_TAROT_COMPANION_TOKEN: token } : {} },
    AbortController, URL, Buffer, timingSafeEqual,
  });
  vm.runInContext(serverSource, context);
  return async (pathname, authorization) => {
    const res = new EventEmitter(); res.headers = {};
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.writeHead = (status, headers) => { res.status = status; Object.assign(res.headers, headers); };
    res.end = body => { res.body = JSON.parse(body); };
    await handler({ method: 'GET', url: pathname, headers: { host: '127.0.0.1:8642', authorization } }, res);
    return res;
  };
}

test('handler contract: default companion probe is 404 and original health stays unchanged', async () => {
  const request = handlerFixture();
  assert.equal((await request('/api/companion-health')).status, 404);
  assert.deepEqual((await request('/api/health')).body, { ok: true });
});

test('handler contract: exact ownership token gates the optional engine identity', async () => {
  const request = handlerFixture('synthetic-owner-token');
  assert.equal((await request('/api/companion-health', 'Bearer wrong')).status, 403);
  const res = await request('/api/companion-health', 'Bearer synthetic-owner-token');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { protocol: 'cove-tarot-engine-v1', engine: 'tarot', version: 1 });
});

async function engine(t, token) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tarot-companion-health-'));
  const child = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: '0', TAROT_DSH_DIR: dir,
      ...(token ? { COVE_TAROT_COMPANION_TOKEN: token } : {}) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', c => { logs += c; }); child.stderr.on('data', c => { logs += c; });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic server timeout: ' + logs)), 5000);
    child.stdout.on('data', c => { const match = String(c).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Synthetic server exited: ' + logs)); });
  });
  return { base, logs: () => logs };
}

test('companion health is disabled by default without changing original health', async t => {
  const f = await engine(t);
  assert.equal((await fetch(f.base + '/api/companion-health')).status, 404);
  const original = await fetch(f.base + '/api/health');
  assert.equal(original.status, 200); assert.deepEqual(await original.json(), { ok: true });
  assert.equal(original.headers.get('X-Tarot-Service'), 'tarot-ritual');
});

test('owned engine health requires the exact bearer token and leaks no token in logs or response', async t => {
  const token = 'synthetic-owner-token', f = await engine(t, token);
  for (const authorization of ['', 'Bearer wrong', 'Bearer synthetic-owner-tokem', 'Basic ' + token]) {
    const res = await fetch(f.base + '/api/companion-health', { headers: { Authorization: authorization } });
    assert.equal(res.status, 403); assert.ok(!(await res.text()).includes(token));
  }
  const res = await fetch(f.base + '/api/companion-health', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { protocol: 'cove-tarot-engine-v1', engine: 'tarot', version: 1 });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(!f.logs().includes(token));
  assert.equal((await fetch(f.base + '/api/companion-health', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })).status, 405);
  assert.equal((await fetch(f.base + '/api/companion-health', { headers: { Authorization: 'Bearer ' + token, Origin: 'https://foreign.example' } })).status, 403);
});
