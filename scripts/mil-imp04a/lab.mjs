// Laboratorio EXCLUSIVO: datadir nuevo, pipe aleatorio, sin TCP, nunca carga .env.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import cp from 'node:child_process'; import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
if(process.platform!=='win32'||process.argv[2]!=='--run-isolated') throw Error('Usar --run-isolated en Windows');
const repo=process.cwd(),basedir=path.resolve(repo,'../../.lab-runtime/mariadb-11.8.9-winx64');
const binary=path.join(basedir,'bin/mariadbd.exe');
if(crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex')!=='de2c4350e36bcdff6a18b614a21701a8a827509f44f51274411bb52a2849f9e5')throw Error('Binario no verificado');
const id=crypto.randomBytes(16).toString('hex'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mil04a-')),datadir=path.join(dir,'data'),pipe=`mil04a-${id}`,database=`mil04a_${id}`;
const config=path.join(dir,'init.ini');fs.writeFileSync(config,'[mysqld]\r\nskip-networking=ON\r\nnamed-pipe=ON\r\n');
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:os.tmpdir(),TMP:os.tmpdir(),PATH:`${basedir}/bin;${process.env.SystemRoot}/System32`};
const init=cp.spawnSync(path.join(basedir,'bin/mariadb-install-db.exe'),[`--datadir=${datadir}`,`--socket=${pipe}`,'--skip-networking',`--config=${config}`],{cwd:dir,env,windowsHide:true,encoding:'utf8',timeout:120000});
fs.writeFileSync(path.join(dir,'init.log'),init.stdout+init.stderr);if(init.status!==0)throw Error(`Inicialización fallida: ${dir}`);
const log=fs.openSync(path.join(dir,'server.log'),'w');
const child=cp.spawn(binary,['--no-defaults',`--basedir=${basedir}`,`--datadir=${datadir}`,`--socket=${pipe}`,'--skip-networking','--enable-named-pipe','--innodb-buffer-pool-size=64M','--console'],{env,cwd:dir,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
let c;
async function verificar(){const [r]=await c.query('SELECT @@datadir d,@@socket s,@@skip_networking n,@@version v');if(path.resolve(r[0].d)!==path.resolve(datadir)||r[0].s!==pipe||Number(r[0].n)!==1||!r[0].v.startsWith('11.8.9-MariaDB'))throw Error('Identidad de laboratorio inválida');}
try {
 for(let i=0;i<100;i++){try{c=await mysql.createConnection({socketPath:`\\\\.\\pipe\\${pipe}`,user:'root',password:'',connectTimeout:1000});break;}catch{await new Promise(r=>setTimeout(r,200));}}
 if(!c)throw Error('No arrancó laboratorio');await verificar();
 await c.query(`CREATE DATABASE ${database}`);
 const manifest=path.join(dir,'manifest.json');fs.writeFileSync(manifest,JSON.stringify({dir,datadir,pipe,database,pid:child.pid}));
 const result=await new Promise(resolve=>{
   const p=cp.spawn(process.execPath,[path.resolve(repo,'../../node_modules/vitest/vitest.mjs'),'run','src/lib/facturacion/credito.db.test.ts','--maxWorkers=1','--reporter=json',`--outputFile=${path.join(dir,'vitest.json')}`],{cwd:repo,env:{...env,NODE_ENV:'test',AUTH_SECRET:crypto.randomBytes(32).toString('hex'),MIL04A_LAB_MANIFEST:manifest},windowsHide:true,stdio:['ignore','pipe','pipe']});
   let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('close',code=>{fs.writeFileSync(path.join(dir,'vitest.log'),output);resolve(code);});
 });
 console.log(JSON.stringify({evidencia:dir,exit:result}));process.exitCode=result??1;
}finally{
 if(c){await verificar();try{await c.query('SHUTDOWN');}catch(e){if(!['PROTOCOL_CONNECTION_LOST','ECONNRESET'].includes(e.code))throw e;}await c.end().catch(()=>{});}
 await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill();resolve();},5000).unref();});
 // No DROP de esquemas externos ni limpieza de directorios; evidencia y datadir aislado se conservan.
}
