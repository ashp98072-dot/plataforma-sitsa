// Ejecución explícita, única por invocación; jamás servicio Windows o configuración de aplicación.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import cp from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
import {observarServidor,cerrarServidor} from '../c3c1/lifecycle.mjs';
import {sentencias,aprobarControles} from '../c3c1/safety.mjs';
import {conectarC3c2,verificarC3c2} from '../c3c2/connection.mjs';import {sqlC3c2} from '../c3c2/migration.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export async function ensayoC3c2(args){
  if(process.platform!=='win32'||args.length!==2||args[0]!=='--run-isolated'||args[1]!=='--engine=mariadb')throw Error('C3C2_EXPLICIT_MODE_REQUIRED');
  if(process.env.NODE_OPTIONS||process.env.NODE_PATH)throw Error('C3C2_EXTERNAL_NODE_CONFIG');
  const engine=args[1].split('=')[1],repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  const basedir=engine==='mysql'?'C:\\Program Files\\MySQL\\MySQL Server 8.0':path.join(repo,'.lab-runtime/mariadb-11.8.9-winx64');
  const binary=path.join(basedir,'bin',engine==='mysql'?'mysqld.exe':'mariadbd.exe');
  const expected=engine==='mysql'?'1c40b282f3defe814926abb3256790e936b82b62107b1b601eb5b20a5364c366':'de2c4350e36bcdff6a18b614a21701a8a827509f44f51274411bb52a2849f9e5';
  if(crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex')!==expected)throw Error('C3C2_BINARY_HASH');
  if(engine==='mariadb'&&crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,'.lab-runtime/mariadb-11.8.9-winx64.zip'))).digest('hex')!=='830c46727d9278eae212ae3eca44eeb9e71b2a68704e95f344a64fba7b1963f5')throw Error('C3C2_BINARY_DISTRIBUTION');
  const id=crypto.randomUUID().replaceAll('-',''),runDir=path.join(os.tmpdir(),`novalvion-c3c2-${id}`);fs.mkdirSync(runDir);
  const m={id,engine,basedir,runDir,datadir:path.join(runDir,'data'),pidFile:path.join(runDir,'server.pid'),pipe:`c3c2-${id}`,database:`c3c1_lab_${id}`,token:crypto.randomBytes(32).toString('hex'),pid:0};
  console.log('Evidencia C3C2:',runDir);
  const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:os.tmpdir(),TMP:os.tmpdir(),PATH:`${basedir}/bin;${process.env.SystemRoot}/System32`,NODE_ENV:'test'};
  fs.writeFileSync(path.join(runDir,'binary.sha256'),crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'));
  let init;
  if(engine==='mysql')init=cp.spawnSync(binary,['--no-defaults','--initialize-insecure',`--datadir=${m.datadir}`,'--skip-networking','--mysqlx=OFF'],{cwd:runDir,env,encoding:'utf8',windowsHide:true,timeout:120000});
  else{
    const ini=path.join(runDir,'init-template.ini');fs.writeFileSync(ini,'[mysqld]\r\nskip-networking=ON\r\nnamed-pipe=ON\r\n',{flag:'wx'});
    init=cp.spawnSync(path.join(basedir,'bin/mariadb-install-db.exe'),[`--datadir=${m.datadir}`,`--socket=${m.pipe}`,'--skip-networking',`--config=${ini}`],{cwd:runDir,env,encoding:'utf8',windowsHide:true,timeout:120000});
  }
  fs.writeFileSync(path.join(runDir,'init.log'),`${init.stdout}\n${init.stderr}`);if(init.status!==0)throw Error('C3C2_INIT_FAILED');
  const log=fs.openSync(path.join(runDir,'server.log'),'wx');
  const child=cp.spawn(binary,['--no-defaults',`--basedir=${basedir}`,`--datadir=${m.datadir}`,`--pid-file=${m.pidFile}`,`--socket=${m.pipe}`,'--skip-networking','--enable-named-pipe','--sql-mode=STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE','--innodb-buffer-pool-size=64M','--console',...(engine==='mysql'?['--no-monitor','--mysqlx=OFF','--shared-memory=OFF']:[])],{cwd:runDir,env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
  const owned=observarServidor(child,runDir);m.pid=child.pid??0;let c;
  try{
    for(let i=0;i<60;i++){
      if(owned.exited||owned.error)throw Error('C3C2_SERVER_EXITED');
      try{c=await conectarC3c2(m,false);break;}catch(e){if(!['ENOENT','EBUSY'].includes(e.code))throw e;await wait(500);}
    }
    if(!c)throw Error('C3C2_PIPE_TIMEOUT');
    const [existing]=await c.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[m.database]);if(existing.length)throw Error('C3C2_DATABASE_EXISTS');
    await verificarC3c2(c,m,false);await c.query(`CREATE DATABASE \`${m.database}\``);await c.end();
    // Solo tras verificar identidad por conexión, seleccionar el esquema recién creado.
    const mysql=await import('mysql2/promise');c=await mysql.default.createConnection({socketPath:`\\\\.\\pipe\\${m.pipe}`,user:'root',password:'',database:m.database,multipleStatements:false,connectTimeout:3000});
    await verificarC3c2(c,m,false);await c.query('CREATE TABLE _c3c2_identity(token CHAR(64) PRIMARY KEY) ENGINE=InnoDB');await c.execute('INSERT INTO _c3c2_identity VALUES (?)',[m.token]);
    const controls=async name=>{for(const s of sentencias(fs.readFileSync(path.join(repo,`sql/${name}-2026-10-contabilidad-periodos-c3c2.sql`),'utf8'))){await verificarC3c2(c,m);const [r]=await c.query(s);aprobarControles(r);}};
    for(const s of sentencias(fs.readFileSync(path.join(repo,'scripts/ci/c3c2/fixture.sql'),'utf8'))){await verificarC3c2(c,m);await c.query(s);}
    for(const s of sentencias(fs.readFileSync(path.join(repo,'sql/preflight-2026-10-contabilidad-calendario-c3c1.sql'),'utf8'))){await verificarC3c2(c,m);const [r]=await c.query(s);aprobarControles(r);}
    const migration=sqlC3c2(repo,m.database,engine);
    for(const s of migration.slice(0,2)){await verificarC3c2(c,m);await c.query(s);}
    await controls('preflight');
    for(const s of migration.slice(2)){await verificarC3c2(c,m);await c.query(s);}
    await controls('postcheck');await c.end();c=undefined;
    await verificarC3c2(c=await conectarC3c2(m),m);
    await c.query('ALTER TABLE cont_asientos ADD COLUMN creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await c.query("ALTER TABLE cont_cuentas ADD COLUMN nombre VARCHAR(100) DEFAULT 'Cuenta ficticia', ADD COLUMN tipo VARCHAR(40) DEFAULT 'Activo', ADD COLUMN nivel INT DEFAULT 1");
    await c.end();c=undefined;
    const manifest=path.join(runDir,'manifest.json');fs.writeFileSync(manifest,JSON.stringify(m),{flag:'wx'});
    const tests=cp.spawnSync(process.execPath,[path.join(repo,'node_modules/vitest/vitest.mjs'),'run','--config','scripts/ci/c3c4/integration.config.mts','--reporter=json',`--outputFile=${path.join(runDir,'results.json')}`],{cwd:repo,env:{...env,C3C2_MANIFEST:manifest},encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024,windowsHide:true});
    fs.writeFileSync(path.join(runDir,'tests.log'),`${tests.stdout}\n${tests.stderr}`);
    const result=JSON.parse(fs.readFileSync(path.join(runDir,'results.json'),'utf8'));
    if(tests.status!==0||result.numFailedTests||result.numPendingTests||result.numPassedTests<8)throw Error('C3C2_TESTS_FAILED');
  }finally{
    c?.destroy();let closing;
    try{await cerrarServidor(owned,runDir,async()=>{closing=await conectarC3c2(m,false);await closing.query('SHUTDOWN');});}finally{closing?.destroy();}
  }
  console.log('C3C2 pruebas y cierre confirmados:',runDir);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)ensayoC3c2(process.argv.slice(2)).catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
