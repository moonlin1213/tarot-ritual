import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

function checkHealth(port) {
  return new Promise(resolve=>{
    const req=http.get({hostname:'127.0.0.1',port,path:'/api/health',timeout:1000},res=>{
      res.resume();resolve(res.statusCode===200 && res.headers['x-tarot-service']==='tarot-ritual');
    });
    req.on('timeout',()=>req.destroy());req.on('error',()=>resolve(false));
  });
}

export async function openTarot({port=8765,uid=os.userInfo().uid,label='com.moonlin.tarot-ritual',
  plist=path.join(os.homedir(),'Library','LaunchAgents',`${label}.plist`),
  run=promisify(execFile),health=checkHealth,pause=ms=>new Promise(r=>setTimeout(r,ms)),waitMs=20000}={}) {
  if (!Number.isInteger(port) || port<1 || port>65535) throw new Error('无效的塔罗端口');
  const target=`gui/${uid}/${label}`;
  if (!await health(port)) {
    try {
      try {await run('/bin/launchctl',['print',target]);}
      catch {await run('/bin/launchctl',['bootstrap',`gui/${uid}`,plist]);}
      // No -k: a second click must never interrupt a reading or token refresh.
      await run('/bin/launchctl',['kickstart',target]);
    } catch {throw new Error('塔罗后台启动失败，请检查登录启动项是否已安装。');}
    const deadline=Date.now()+waitMs;
    let ready=false;
    while (Date.now()<deadline) {
      if (await health(port)) {ready=true;break;}
      await pause(250);
    }
    if (!ready) throw new Error('塔罗后台未就绪，请检查端口占用和 Library/Logs/TarotRitual 日志。');
  }
  await run('/usr/bin/open',[`http://127.0.0.1:${port}/`]);
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.platform!=='darwin') throw new Error('此打开入口仅用于已安装登录启动项的 macOS。');
    await openTarot({port:Number(process.env.PORT || 8765)});
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
