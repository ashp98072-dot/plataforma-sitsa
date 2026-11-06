// Prueba explícita. Crea su propia instancia; JAMÁS se conecta a 43306 ni cierra la instancia manual.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import cp from 'node:child_process';import net from 'node:net';import assert from 'node:assert/strict';import mysql from 'mysql2/promise';import {fileURLToPath} from 'node:url';
import {secureDirectory} from './private-directory.mjs';
import {initialize} from './initialize.mjs';import {control} from './control.mjs';import policy from './policy.cjs';import database from './database.cjs';
import {observarServidor,cerrarServidor} from '../c3c1/lifecycle.mjs';
if(process.argv[2]!=='--run-owned-instance')throw Error('C15B_EXPLICIT_TEST');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),id=crypto.randomBytes(16).toString('hex'),dir=path.join(os.tmpdir(),'novalvion-c3c15b-test-'+id);
secureDirectory(path.join(dir,'private'));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const port=await freePort(),httpPort=await freePort();
const basedir=path.join(repo,'.lab-runtime/mariadb-11.8.9-winx64'),binary=path.join(basedir,'bin/mariadbd.exe');
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),'de2c4350e36bcdff6a18b614a21701a8a827509f44f51274411bb52a2849f9e5');
const datadir=path.join(dir,'data'),pipe='c15b-'+id,pid=path.join(dir,'server.pid');
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:dir,TMP:dir,PATH:process.env.PATH};
const ini=path.join(dir,'init.ini');fs.writeFileSync(ini,'[mysqld]\r\nskip-networking=ON\r\nnamed-pipe=ON\r\n');
const init=cp.spawnSync(path.join(basedir,'bin/mariadb-install-db.exe'),[`--datadir=${datadir}`,`--socket=${pipe}`,'--skip-networking',`--config=${ini}`],{cwd:dir,env,windowsHide:true,encoding:'utf8'});
assert.equal(init.status,0,'Instalacion temporal');
const log=fs.openSync(path.join(dir,'server.log'),'wx');
const child=cp.spawn(binary,['--no-defaults',`--basedir=${basedir}`,`--datadir=${datadir}`,`--pid-file=${pid}`,`--socket=${pipe}`,`--port=${port}`,'--bind-address=127.0.0.1','--enable-named-pipe',`--tmpdir=${dir}`,'--innodb-buffer-pool-size=64M','--console'],{cwd:dir,env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
const owned=observarServidor(child,dir);let root,started=false;const evidence={dir,port,httpPort,checks:[],estado:'RUNNING'};
const config={...policy.config(repo),port,httpPort,datadir};const password=crypto.randomBytes(24).toString('hex');const stateDir=path.join(dir,'private'),file=path.join(stateDir,'private.json');
try{
 for(let i=0;i<60;i++){try{root=await mysql.createConnection({socketPath:'\\\\.\\pipe\\'+pipe,user:'root',password:''});break;}catch{await new Promise(r=>setTimeout(r,250));}}
 assert.ok(root,'Servidor temporal');
 const [identity]=await root.query('SELECT @@datadir datadir,@@port port');assert.equal(policy.normal(identity[0].datadir),policy.normal(datadir));assert.equal(Number(identity[0].port),port);
 await root.query('REVOKE ALL PRIVILEGES ON `test`.* FROM PUBLIC');await root.query('REVOKE ALL PRIVILEGES ON `test\\_%`.* FROM PUBLIC');
 await root.query('CREATE DATABASE c3c15_lab');await root.query("CREATE USER 'c3c15_app'@'127.0.0.1' IDENTIFIED BY ?",[password]);await root.query("GRANT ALL PRIVILEGES ON c3c15_lab.* TO 'c3c15_app'@'127.0.0.1'");
 await root.query('CREATE TABLE c3c15_lab.sentinel(id INT)');
 await assert.rejects(initialize(config,password,stateDir),{code:'C15B_DATABASE_NOT_EMPTY'});evidence.checks.push('base no vacia rechazada');
 await root.query('DROP TABLE c3c15_lab.sentinel');
 const result=await initialize(config,password,stateDir);assert.equal(result.estado,'READY');evidence.bootstrap=result;
 const beforeSecret=fs.readFileSync(file);
 await assert.rejects(initialize(config,password,stateDir),{code:'C15B_STATE_EXISTS'});assert.deepEqual(fs.readFileSync(file),beforeSecret);evidence.checks.push('segunda inicializacion rechazada');
 const ctx=JSON.parse(fs.readFileSync(file));const initialRoot=await root.query('SELECT COUNT(*) n FROM c3c15_lab.cont_asientos');
 const badPool=database.verifiedPool({...ctx,token:'0'.repeat(64)});try{await assert.rejects(badPool.getConnection(),{code:'C15B_MARKER'});}finally{await badPool.end();}
 evidence.checks.push('nonce incorrecto rechazado antes de entregar conexion');
 await assert.rejects(database.open({...config,serverPid:config.serverPid+1},password),{code:'C15B_SERVER_PID'});evidence.checks.push('PID de servidor inesperado rechazado');
 const preload=path.join(repo,'scripts/ci/c3c15b/preload.cjs');
 for(const [expression,code]of [
  ["require('node:net').connect({host:'hostinger.com',port:3306})",'C15B_NETWORK_BLOCKED'],
  ["require('node:net').connect({host:'127.0.0.1',port:3306})",'C15B_NETWORK_BLOCKED'],
  ["require('node:fs').readFileSync('.env')",'C15B_ENV_READ_BLOCKED'],
  ["require('mysql2/promise').createConnection({host:'127.0.0.1'})",'C15B_UNEXPECTED_CONNECTION'],
 ]){
  const probe=cp.spawnSync(process.execPath,['--require',preload,'-e',`try{${expression};process.exit(2);}catch(e){console.log(e.code);}`],{cwd:repo,env:{...env,TEMP:process.env.TEMP,TMP:process.env.TMP,C3C15B_PRIVATE:file},encoding:'utf8',windowsHide:true});
  assert.equal(probe.status,0);assert.equal(probe.stdout.trim(),code);
 }
 evidence.checks.push('sondas reales de red externa, MySQL80, .env y conexion inesperada bloqueadas');
 const status=await control('verify',file);assert.equal(status.estado,'READY');
 const startedResult=await control('start',file);started=true;evidence.checks.push('Next iniciado y handshake autenticado');
 const origin=new URL(startedResult.url).origin;
 for(const account of ctx.accounts){
  const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:account.username,password:account.password}),signal:AbortSignal.timeout(90000)});
  assert.equal(login.status,200,'login real '+account.role);const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const selection=await fetch(origin+'/api/auth/select-empresa',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{"empresaId":7}',signal:AbortSignal.timeout(90000)});assert.equal(selection.status,200);
  const current=selection.headers.get('set-cookie')?.split(';')[0]??cookie;
  const selector=await fetch(origin+'/select-empresa',{headers:{Cookie:current},signal:AbortSignal.timeout(90000)});assert.equal(selector.status,200);
  const page=await fetch(origin+'/e/qa-a/contabilidad/calendario',{headers:{Cookie:current},signal:AbortSignal.timeout(90000)});assert.equal(page.status,200);assert.ok((await page.text()).includes('Calendario contable'));
  const r=await fetch(origin+'/api/empresas/qa-a/contabilidad/ejercicios/1/validacion-precontable?entidad=9',{headers:{Cookie:current},signal:AbortSignal.timeout(90000)});assert.equal(r.status,200);const d=await r.json();assert.equal(d.evaluaciones[0].puedeRegistrar,account.role==='revisor');
  const e=d.evaluaciones[0];const post=await fetch(origin+'/api/empresas/qa-a/contabilidad/ejercicios/1/validacion-precontable?entidad=9',{method:'POST',headers:{Cookie:current,'Content-Type':'application/json'},body:JSON.stringify({solicitudId:e.informe.solicitudId,versionEsperada:e.version,huellaIntegral:e.informe.huellaIntegral,justificacion:'Prueba HTTP real del bootstrap local C15B',claveIdempotencia:crypto.randomUUID(),confirmacion:'CONSTANCIA_TECNICA_SIN_APROBACION_FORMAL'}),signal:AbortSignal.timeout(90000)});assert.equal(post.status,account.role==='revisor'?200:403);
  evidence.checks.push('HTTP login/empresa/calendario/permisos '+account.role);
  if(account.role==='lector'){
   const xlsx=await fetch(origin+'/api/empresas/qa-a/contabilidad/ejercicios/1/validacion-precontable?entidad=9&formato=xlsx&solicitud='+e.informe.solicitudId,{headers:{Cookie:current},signal:AbortSignal.timeout(90000)});assert.equal(xlsx.status,200);assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0,2).toString(),'PK');evidence.checks.push('XLSX real recibido por HTTP (no navegador)');
  }
 }
 const blocked=await fetch(origin+'/api/empresas/qa-a/contabilidad/asientos?entidad=9',{method:'POST'});assert.equal(blocked.status,403);evidence.checks.push('ruta de contabilizacion bloqueada por servidor de laboratorio');
 const after=await root.query('SELECT COUNT(*) n FROM c3c15_lab.cont_asientos');assert.equal(after[0][0].n,initialRoot[0][0].n);
 await control('stop',file);started=false;evidence.checks.push('Next detenido; MariaDB sigue respondiendo');await root.query('SELECT 1');
 await control('start',file);started=true;await control('stop',file);started=false;await root.query('SELECT 1');evidence.checks.push('reinicio de Next y segunda parada sin cerrar MariaDB');evidence.estado='APROBADA';
}catch(e){evidence.estado='FALLIDA';evidence.error=String(e.code??'TEST_FAILED');evidence.actualCode=e.actual?.code;evidence.grantShapes=e.actual?.grantShapes;evidence.expectedCode=e.expected?.code;evidence.frames=String(e.stack).split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,4);process.exitCode=1;}
finally{
 if(started)try{await control('stop',file);}catch{evidence.stop='UNCONFIRMED';}
 await root?.end();let closing;
 // Solo handle original de ESTA instancia de prueba, nunca control.mjs ni el servidor manual.
 try{await cerrarServidor(owned,dir,async()=>{closing=await mysql.createConnection({socketPath:'\\\\.\\pipe\\'+pipe,user:'root',password:''});await closing.query('SHUTDOWN');});}finally{closing?.destroy();}
 fs.writeFileSync(path.join(dir,'integration-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({estado:evidence.estado,error:evidence.error??null,evidence:path.join(dir,'integration-evidence.json')}));
}
