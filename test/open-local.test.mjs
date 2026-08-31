import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

async function launcher() {
  const module=await import('../scripts/open-local.mjs').catch(()=>({}));
  assert.equal(typeof module.openTarot,'function','health-aware local launcher must exist');
  return module.openTarot;
}
async function service(t, identity='tarot-ritual') {
  const server=http.createServer((req,res)=>{res.setHeader('X-Tarot-Service',identity);res.end('{"ok":true}');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  return server.address().port;
}
test('opening a healthy tarot service never starts or restarts a second backend',async t=>{
  const openTarot=await launcher();const port=await service(t);const calls=[];
  await openTarot({port,run:async(file,args)=>{calls.push({file,args});}});
  assert.deepEqual(calls,[{file:'/usr/bin/open',args:[`http://127.0.0.1:${port}/`]}]);
});
test('an unloaded service is registered and started without killing existing processes',async t=>{
  const openTarot=await launcher();const port=await service(t);const calls=[];let checks=0;
  await openTarot({port,uid:501,plist:'/tmp/fixture.plist',health:async()=>++checks>2,
    run:async(file,args)=>{calls.push(args);if(args[0]==='print')throw new Error('not registered');},pause:async()=>{}});
  assert.deepEqual(calls,[['print','gui/501/com.moonlin.tarot-ritual'],['bootstrap','gui/501','/tmp/fixture.plist'],['kickstart','gui/501/com.moonlin.tarot-ritual'],[`http://127.0.0.1:${port}/`]]);
});
test('the launcher will not open an unrelated service occupying the same port',async t=>{
  const openTarot=await launcher();const port=await service(t,'another-app');const calls=[];
  await assert.rejects(openTarot({port,waitMs:5,pause:async()=>{},run:async(file,args)=>{calls.push(args);}}),/未就绪/);
  assert.ok(calls.every(args=>args[0]!=='-k' && !String(args[0]).startsWith('http')));
});
test('service startup errors are reported without opening the browser or leaking command output',async()=>{
  const openTarot=await launcher();
  await assert.rejects(openTarot({health:async()=>false,run:async()=>{throw new Error('private process environment');}}),e=>/启动/.test(e.message)&&!e.message.includes('private'));
});
