import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('npm start command runs without shell-specific syntax from a Unicode path with spaces', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tarot 空间 '));
  let child;
  try {
    await fs.copyFile(path.join(root, 'server.mjs'), path.join(dir, 'server.mjs'));
    await fs.symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const [exe, ...args] = pkg.scripts.start.split(' ');
    child = spawn(exe === 'node' ? process.execPath : exe, args, {
      cwd: dir, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: '0', HOME: dir, USERPROFILE: dir }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('startup timeout')), 5000);
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('startup exited')); });
      child.stdout.on('data', c => { const m = String(c).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    });
    assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true });
  } finally {
    if (child?.pid && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; }
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
