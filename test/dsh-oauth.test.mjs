import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const sdkPath = process.env.TAROT_TEST_DSH_MODULE;
const helperURL = new URL('../server/dsh-oauth.mjs', import.meta.url);
async function createResolver(options) {
  const module = await import(helperURL.href).catch(() => ({}));
  assert.equal(typeof module.createDshCodexResolver, 'function', 'shared DSH resolver must be implemented');
  return module.createDshCodexResolver(options);
}
async function fixture(t, {canonical = true, expires = 1, fail = false} = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tarot-oauth-'));
  t.after(() => fs.rm(dir, {recursive:true,force:true}));
  const cred = {type:'oauth',access:'old-access',refresh:'private-refresh',expires,accountId:'test-account'};
  const credentials = {'codex-oauth':cred, untouched:{type:'api_key',key:'unrelated-secret'}};
  if (canonical) credentials['openai-codex'] = {...cred};
  const document = {version:1, credentials, routes:{'codex-oauth':{route:'codex-oauth',piProvider:'openai-codex',displayName:'Codex',api:'openai-codex-responses',models:['gpt-5.6-sol'],enabled:['gpt-5.6-sol'],sourceId:'fixture',origin:'fixture'}}};
  const file = path.join(dir, '.everything-oauth.json');
  await fs.writeFile(file, JSON.stringify(document), {mode:0o600});
  const modulePath = path.join(dir,'sdk.mjs');
  await fs.writeFile(modulePath, `
    import {appendFile} from 'node:fs/promises';
    import {EverythingOAuthSession as RealSession, EverythingOAuthStore} from ${JSON.stringify(pathToFileURL(sdkPath).href)};
    export {EverythingOAuthStore};
    export class EverythingOAuthSession extends RealSession {
      constructor(store) {
        super(store);
        this.models.setProvider({id:'openai-codex',name:'fixture',getModels:()=>[],auth:{oauth:{
          async refresh(current) {
            await appendFile(${JSON.stringify(path.join(dir,'refreshes'))}, 'refresh' + String.fromCharCode(10));
            await new Promise(r=>setTimeout(r,40));
            if (${fail}) throw new Error('private-refresh provider failure');
            return {...current, access:'renewed-access', refresh:'rotated-refresh', expires:Date.now()+3600000};
          },
          async toAuth(current) {return {apiKey:current.access,headers:{'chatgpt-account-id':current.accountId}};}
        }}});
      }
    }
  `);
  const fixtureModule = await import(pathToFileURL(modulePath).href);
  new fixtureModule.EverythingOAuthSession(new fixtureModule.EverythingOAuthStore(file));
  return {dir,file,modulePath,document};
}
test('renewal module must be explicitly configured as a local path', async () => {
  for (const modulePath of ['', 'https://invalid.example/sdk.mjs']) {
    const resolve = await createResolver({dshDir:os.tmpdir(),modulePath});
    await assert.rejects(resolve(), e => e.status === 503 && !e.publicMessage.includes('https://'));
  }
});
test('missing DSH module fails closed with a safe actionable error', async () => {
  const resolve = await createResolver({dshDir:os.tmpdir(),modulePath:path.join(os.tmpdir(),'no-such-dsh-sdk.mjs')});
  await assert.rejects(resolve(), e => e.status === 503 && /DSH/.test(e.publicMessage));
});
test('valid canonical credential wins over a stale alias without any write or refresh', {skip:!sdkPath}, async t => {
  const f = await fixture(t,{expires:Date.now()+3600000});
  f.document.credentials['codex-oauth'].access = 'stale-alias';
  f.document.credentials['codex-oauth'].expires = 1;
  await fs.writeFile(f.file,JSON.stringify(f.document));
  const before = await fs.readFile(f.file,'utf8');
  const resolve = await createResolver({dshDir:f.dir,modulePath:f.modulePath});
  const result = await resolve();
  assert.equal(result.token,'old-access');
  assert.equal(result.cred.accountId,'test-account');
  assert.equal(await fs.readFile(f.file,'utf8'),before);
  assert.equal(await fs.stat(path.join(f.dir,'refreshes')).then(()=>true,()=>false),false);
});
test('legacy alias is migrated under the shared store and refresh preserves unrelated settings', {skip:!sdkPath}, async t => {
  const f = await fixture(t,{canonical:false});
  const resolve = await createResolver({dshDir:f.dir,modulePath:f.modulePath});
  const results = await Promise.all(Array.from({length:6},()=>resolve()));
  assert.ok(results.every(r=>r.token==='renewed-access'));
  assert.equal(await fs.readFile(path.join(f.dir,'refreshes'),'utf8'),'refresh\n');
  const final = JSON.parse(await fs.readFile(f.file,'utf8'));
  assert.equal(final.credentials['openai-codex'].refresh,'rotated-refresh');
  assert.deepEqual(final.routes,f.document.routes);
  assert.deepEqual(final.credentials.untouched,f.document.credentials.untouched);
  assert.equal((await fs.stat(f.file)).mode & 0o777,0o600);
});
test('failed refresh does not erase credentials or expose SDK error secrets', {skip:!sdkPath}, async t => {
  const f = await fixture(t,{fail:true});
  const before = await fs.readFile(f.file,'utf8');
  const resolve = await createResolver({dshDir:f.dir,modulePath:f.modulePath});
  await assert.rejects(resolve(), e=>e.status===401 && !e.publicMessage.includes('private-refresh'));
  assert.equal(await fs.readFile(f.file,'utf8'),before);
});
test('separate resolver processes share DSH locking and rotate once globally', {skip:!sdkPath}, async t => {
  const f = await fixture(t);
  const runner = path.join(f.dir,'runner.mjs');
  await fs.writeFile(runner,`import {createDshCodexResolver} from ${JSON.stringify(helperURL.href)};
    const r=await createDshCodexResolver(${JSON.stringify({dshDir:f.dir,modulePath:f.modulePath})})();
    if(r.token!=='renewed-access')process.exit(2);`);
  await Promise.all(Array.from({length:3},()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[runner],{stdio:['ignore','ignore','pipe']});
    let stderr=''; child.stderr.on('data',c=>{stderr+=c;});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(stderr)));
  })));
  assert.equal(await fs.readFile(path.join(f.dir,'refreshes'),'utf8'),'refresh\n');
});
test('real HTTP requests opt into shared renewal, keep secrets server-side and reuse persisted access after restart', {skip:!sdkPath}, async t => {
  const f = await fixture(t);
  const root = fileURLToPath(new URL('..',import.meta.url));
  await fs.copyFile(path.join(root,'server.mjs'),path.join(f.dir,'server.mjs'));
  await fs.cp(path.join(root,'server'),path.join(f.dir,'server'),{recursive:true});
  await fs.symlink(path.join(root,'node_modules'),path.join(f.dir,'node_modules'),'junction');
  const calls=[];
  const upstream=http.createServer(async(req,res)=>{
    req.resume(); calls.push({authorization:req.headers.authorization,account:req.headers['chatgpt-account-id']});
    res.end('data: {"type":"response.output_text.delta","delta":"OK"}\n\ndata: {"type":"response.completed"}\n\n');
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  t.after(()=>{upstream.closeAllConnections();upstream.close();});
  await fs.writeFile(path.join(f.dir,'network.mjs'),`
    const original=globalThis.fetch;
    globalThis.fetch=(url,init)=>{
      if(String(url)!=='https://chatgpt.com/backend-api/codex/responses')throw new Error('Unexpected external request');
      return original('http://127.0.0.1:${upstream.address().port}',init);
    };
  `);
  let child;
  async function stop() {if(child?.pid && child.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
  t.after(stop);
  async function start(refresh = true) {
    child=spawn(process.execPath,['--import',pathToFileURL(path.join(f.dir,'network.mjs')).href,path.join(f.dir,'server.mjs')],{
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:f.dir,PORT:'0',TAROT_DSH_DIR:f.dir,TAROT_DSH_IMPORT:'1',TAROT_DSH_OAUTH_REFRESH:refresh?'1':'0',TAROT_DSH_OAUTH_MODULE:f.modulePath},stdio:['ignore','pipe','pipe'],
    });
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('server start timeout')),5000);
      child.on('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(new Error('server exited'));});
      child.stdout.on('data',c=>{const m=String(c).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});
    });
  }
  const headers={'Content-Type':'application/json','X-Tarot-Request':'1'};
  let base=await start();
  const metadata=await (await fetch(base+'/api/dsh',{headers})).json();
  assert.equal(metadata.oauthRefreshEnabled,true);
  assert.equal(await fs.stat(path.join(f.dir,'refreshes')).then(()=>true,()=>false),false,'startup/import must not refresh');
  async function request() {
    const r=await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({providerId:'dsh:codex-oauth',model:'gpt-5.6-sol',messages:[{role:'user',content:'test'}]})});
    const text=await r.text(); assert.match(text,/"v":"OK"/); assert.ok(!text.includes('"t":"error"'));assert.ok(!text.includes('access'));
  }
  await Promise.all([request(),request()]);
  await stop();base=await start();await request();
  await stop();base=await start(false);await request();
  assert.equal(await fs.readFile(path.join(f.dir,'refreshes'),'utf8'),'refresh\n');
  assert.deepEqual(calls,Array.from({length:4},()=>({authorization:'Bearer renewed-access',account:'test-account'})));
});
