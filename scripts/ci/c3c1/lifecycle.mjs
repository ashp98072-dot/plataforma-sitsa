import fs from 'node:fs';
import path from 'node:path';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function observarServidor(child,dir){
  const record={child,pid:child.pid,exited:false,code:null,signal:null,error:null};
  child.once('exit',(code,signal)=>{record.exited=true;record.code=code;record.signal=signal;});
  child.once('error',error=>{record.error=error.code||'SPAWN_ERROR';});
  fs.appendFileSync(path.join(dir,'shutdown.jsonl'),JSON.stringify({event:'owned-spawn',pid:record.pid})+'\n');
  return record;
}
export async function cerrarServidor(record,dir,request,timeoutMs=15000){
  const audit=(event,details={})=>fs.appendFileSync(path.join(dir,'shutdown.jsonl'),JSON.stringify({time:new Date().toISOString(),event,pid:record.pid,...details})+'\n');
  const wait=async ms=>{const until=Date.now()+ms;while(!record.exited&&Date.now()<until)await delay(10);};
  if(record.exited||record.error)throw Error('C3C1_SERVER_EXITED_BEFORE_SHUTDOWN');
  audit('shutdown-request');
  let timer,requestError;
  const deadline=Date.now()+timeoutMs;
  try{await Promise.race([Promise.resolve().then(request),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('REQUEST_TIMEOUT')),timeoutMs);})]);}
  catch(error){requestError=error.code||'REQUEST_FAILED';audit('shutdown-request-error',{code:requestError});}
  finally{clearTimeout(timer);}
  await wait(Math.max(0,deadline-Date.now()));
  if(!record.exited){
    // Únicamente el handle original conservado, nunca búsqueda o terminación por PID.
    if(record.child.pid===record.pid&&record.child.exitCode===null&&record.child.signalCode===null&&record.child.kill(0)){
      audit('forced-stop');record.child.kill();await wait(2000);
    }
    audit('shutdown-unconfirmed',{exited:record.exited});throw Error('C3C1_SHUTDOWN_UNCONFIRMED');
  }
  const confirmed=record.code===0&&record.signal===null&&!record.error&&!requestError&&
    /Shutdown complete(?:d)?\b/i.test(fs.readFileSync(path.join(dir,'server.log'),'utf8'));
  audit(confirmed?'shutdown-confirmed':'shutdown-failed',{code:record.code,signal:record.signal});
  if(!confirmed)throw Error('C3C1_SHUTDOWN_UNCONFIRMED');
}
