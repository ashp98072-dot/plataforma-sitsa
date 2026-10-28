import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import mysql from 'mysql2/promise';
export function manifestC3c2(file){
  const dir=path.dirname(path.resolve(file));const m=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!/^[a-f0-9]{32}$/.test(m.id)||dir!==path.join(os.tmpdir(),`novalvion-c3c2-${m.id}`)||fs.realpathSync(dir)!==dir||path.basename(file)!=='manifest.json'||m.runDir!==dir||m.datadir!==path.join(dir,'data')||m.pidFile!==path.join(dir,'server.pid')||m.database!==`c3c1_lab_${m.id}`||m.pipe!==`c3c2-${m.id}`||!['mysql','mariadb'].includes(m.engine)||!Number.isSafeInteger(m.pid)||m.pid<=0||!/^[a-f0-9]{64}$/.test(m.token))throw Error('C3C2_MANIFEST_INVALID');
  return m;
}
export const opcionesC3c2=(m,base=true)=>({socketPath:`\\\\.\\pipe\\${m.pipe}`,user:'root',password:'',...(base?{database:m.database}:{}),multipleStatements:false,connectTimeout:3000});
export async function verificarC3c2(c,m,base=true){
  const [r]=await c.query('SELECT @@datadir datadir,@@pid_file pidFile,@@socket pipe,@@skip_networking sinRed,@@version version,@@foreign_key_checks fk,@@basedir basedir');
  const norm=v=>path.resolve(String(v)).toLowerCase();
  if(norm(r[0].datadir)!==norm(m.datadir)||norm(r[0].pidFile)!==norm(m.pidFile)||norm(r[0].basedir)!==norm(m.basedir)||r[0].pipe!==m.pipe||Number(r[0].sinRed)!==1||Number(r[0].fk)!==1||Number(fs.readFileSync(m.pidFile,'utf8').trim())!==m.pid)throw Error('C3C2_IDENTITY_FAILED');
  process.kill(m.pid,0); // Existencia solo después de verificar identidad completa, nunca terminación por PID.
  if(m.engine==='mysql'){
    if(!String(r[0].version).startsWith('8.0.46'))throw Error('C3C2_ENGINE_VERSION');
    const [x]=await c.query("SELECT COUNT(*) n FROM information_schema.PLUGINS WHERE PLUGIN_NAME='mysqlx' AND PLUGIN_STATUS='ACTIVE'");if(Number(x[0].n))throw Error('C3C2_X_ACTIVE');
  }else{
    if(!String(r[0].version).startsWith('11.8.9-MariaDB'))throw Error('C3C2_ENGINE_VERSION');
    const [checks]=await c.query('SELECT @@check_constraint_checks checks');if(Number(checks[0].checks)!==1)throw Error('C3C2_CHECKS_DISABLED');
  }
  if(base){
    const [d]=await c.query('SELECT DATABASE() nombre');if(d[0].nombre!==m.database)throw Error('C3C2_DATABASE_FAILED');
    const [t]=await c.query('SELECT token FROM _c3c2_identity LOCK IN SHARE MODE');if(t.length!==1||t[0].token!==m.token)throw Error('C3C2_TOKEN_FAILED');
  }
}
export async function conectarC3c2(m,base=true){const c=await mysql.createConnection(opcionesC3c2(m,base));try{await verificarC3c2(c,m,base);return c;}catch(e){c.destroy();throw e;}}
export function poolC3c2(m){
  const pool=mysql.createPool({...opcionesC3c2(m),connectionLimit:6});
  return {async getConnection(){const c=await pool.getConnection();try{await verificarC3c2(c,m);}catch(e){c.destroy();throw e;}
    return new Proxy(c,{get(t,k){if(['query','execute','beginTransaction','commit','rollback'].includes(String(k)))return async(...args)=>{
      await verificarC3c2(c,m);
      if(typeof args[0]==='string'&&/^\s*(USE|SHUTDOWN|DROP|ALTER|CREATE|TRUNCATE|SET)\b/i.test(args[0])&&args[0]!=='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')throw Error('C3C2_TEST_SQL_SCOPE');
      return t[k](...args);
    };const v=t[k];return typeof v==='function'?v.bind(t):v;}});
  },end:()=>pool.end()};
}
