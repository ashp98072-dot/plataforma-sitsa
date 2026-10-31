import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';import {fileURLToPath} from 'node:url';
import {secureDirectory} from './private-directory.mjs';
import policy from './policy.cjs';import db from './database.cjs';
export async function verify(file){
 secureDirectory(path.dirname(file));
 const ctx=JSON.parse(fs.readFileSync(file,'utf8'));policy.validateConfig(ctx.config);policy.assertCleanEnvironment(ctx.config.repo);
 const c=await db.open(ctx.config,ctx.password);try{await db.marker(c.query.bind(c),ctx,true);}finally{await c.end();}return ctx;
}
const root=path.dirname(fileURLToPath(import.meta.url));
export async function control(action,file){
 const ctx=await verify(file);
 if(action==='verify')return {estado:'READY',accounts:ctx.accounts.map(a=>({username:a.username,role:a.role}))};
 const origin='http://127.0.0.1:'+ctx.config.httpPort;
 const handshake=async()=>{const r=await fetch(origin+'/_c15b/identity',{headers:{'x-c15b-token':ctx.token},signal:AbortSignal.timeout(3000)});if(!r.ok||(await r.json()).id!==ctx.id)policy.fail('C15B_HTTP_IDENTITY');};
 if(action==='stop'){
  await handshake();const instance=JSON.parse(fs.readFileSync(path.join(path.dirname(file),'next-instance.json'),'utf8'));
  if(instance.id!==ctx.id||instance.port!==ctx.config.httpPort)policy.fail('C15B_PROCESS_IDENTITY');
  await fetch(origin+'/_c15b/stop',{method:'POST',headers:{'x-c15b-token':ctx.token},signal:AbortSignal.timeout(5000)});
  for(let i=0;i<100;i++){try{process.kill(instance.pid,0);}catch{fs.writeFileSync(path.join(path.dirname(file),'next-instance.json'),JSON.stringify({...instance,estado:'STOPPED'}));return {estado:'NEXT_STOPPED',mariadb:'UNTOUCHED'};}await new Promise(r=>setTimeout(r,100));}
  policy.fail('C15B_STOP_UNCONFIRMED');
 }
 if(action!=='start')policy.fail('C15B_ACTION');
 const instanceFile=path.join(path.dirname(file),'next-instance.json');
 const lockFile=path.join(path.dirname(file),'next-start.lock'),lock=fs.openSync(lockFile,'wx');
 try{
 if(fs.existsSync(instanceFile)){const old=JSON.parse(fs.readFileSync(instanceFile,'utf8'));if(old.id!==ctx.id||old.estado!=='STOPPED')policy.fail('C15B_START_ALREADY_ATTEMPTED');}
 const log=fs.openSync(path.join(path.dirname(file),'next-private.log'),'a');
 const preload=path.join(root,'preload.cjs').replaceAll('\\','/');
 const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',C3C15B_PRIVATE:file,NODE_OPTIONS:'--require '+JSON.stringify(preload)};
 const child=cp.fork(path.join(root,'server.mjs'),[],{cwd:ctx.config.repo,env,execArgv:[],windowsHide:true,detached:true,stdio:['ignore',log,log,'ipc']});fs.closeSync(log);
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Object.assign(new Error(),{code:'C15B_START_TIMEOUT'})),90000);child.once('message',m=>{clearTimeout(timer);if(m.ready&&m.id===ctx.id)resolve();else reject(Object.assign(new Error(),{code:'C15B_HANDSHAKE'}));});child.once('exit',()=>{clearTimeout(timer);reject(Object.assign(new Error(),{code:'C15B_SERVER_EXIT'}));});child.once('error',()=>{clearTimeout(timer);reject(Object.assign(new Error(),{code:'C15B_SERVER_SPAWN'}));});});}
 catch(e){if(child.exitCode===null)child.kill();throw e;}
 child.disconnect();child.unref();await handshake();return {estado:'NEXT_READY',url:origin+'/login',pid:child.pid};
 }finally{fs.closeSync(lock);fs.unlinkSync(lockFile);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await control(process.argv[2],process.argv[3])));}catch(e){console.error(String(e.code??'C15B_FAILED'));process.exitCode=1;}
}
