import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import cp from 'node:child_process';import {pathToFileURL} from 'node:url';
import policy from './policy.cjs';import database from './database.cjs';
import {sentencias,aprobarControles} from '../c3c1/safety.mjs';
const read=(repo,file)=>fs.readFileSync(path.join(repo,file),'utf8');
export async function initialize(config,password,stateDir){
 policy.validateConfig(config);policy.assertCleanEnvironment(config.repo);
 if(!password||password.length<12)policy.fail('C15B_PASSWORD');
 if(fs.existsSync(path.join(stateDir,'private.json')))policy.fail('C15B_STATE_EXISTS');
 const c=await database.open(config,password),evidence={contrato:'C3C15B-BOOTSTRAP-1',etapas:[],estado:'INITIALIZING'};
 const server=await database.identity(c.query.bind(c),config);config.serverPid=Number(fs.readFileSync(server.pidFile,'utf8').trim());
 const ctx={config,password,id:crypto.randomUUID(),token:crypto.randomBytes(32).toString('hex'),authSecret:crypto.randomBytes(48).toString('hex'),accounts:[]};
 let own=false;
 try{
  const [objects]=await c.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  const [extra]=await c.query('SELECT ROUTINE_NAME name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() UNION ALL SELECT EVENT_NAME name FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()');
  if(objects.length||extra.length)policy.fail('C15B_DATABASE_NOT_EMPTY');
  const [lock]=await c.query("SELECT GET_LOCK('c3c15b-initialize',0) acquired");if(Number(lock[0].acquired)!==1)policy.fail('C15B_BUSY');
  // Relectura tras exclusión mutua: nunca adoptar un esquema existente.
  const [again]=await c.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');if(again.length)policy.fail('C15B_DATABASE_NOT_EMPTY');
  await database.identity(c.query.bind(c),config);
  await c.query("CREATE TABLE _c3c15_lab(id CHAR(36) PRIMARY KEY,token CHAR(64) NOT NULL,estado VARCHAR(16) NOT NULL) ENGINE=InnoDB");
  await database.identity(c.query.bind(c),config);
  await c.execute("INSERT INTO _c3c15_lab VALUES (?,?,'INITIALIZING')",[ctx.id,ctx.token]);own=true;
  database.guardConnection(c,ctx);
  const run=async(file,control=false,transform=s=>s)=>{
   const text=transform(read(config.repo,file)).replaceAll('^c3c1_lab_[a-f0-9]{32}$','^c3c15_lab$');
   for(const s of sentencias(text)){const [r]=await c.query(s);if(control){aprobarControles(r);evidence.etapas.push({archivo:file,...r[0]});}}
  };
  // DDL mínimo comprobado por C14; semillas se crean una sola vez más abajo.
  for(const s of sentencias(read(config.repo,'scripts/ci/c3c2/fixture.sql')).filter(s=>s.startsWith('CREATE TABLE')))await c.query(s);
  await run('sql/preflight-2026-10-contabilidad-calendario-c3c1.sql',true);
  await run('sql/migrate-2026-10-contabilidad-calendario-c3c1.sql',false,s=>s.replaceAll('{{C3C1_SCHEMA}}',config.database));
  await run('sql/postcheck-2026-10-contabilidad-calendario-c3c1.sql',true);
  await run('sql/preflight-2026-10-contabilidad-periodos-c3c2.sql',true);
  await run('sql/migrate-2026-10-contabilidad-periodos-c3c2.sql');
  await run('sql/postcheck-2026-10-contabilidad-periodos-c3c2.sql',true);
  await c.query('ALTER TABLE cont_asientos ADD COLUMN creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  await c.query("ALTER TABLE cont_cuentas ADD COLUMN nombre VARCHAR(100),ADD COLUMN tipo VARCHAR(40),ADD COLUMN nivel INT DEFAULT 1");
  const schema=read(config.repo,'sql/schema.sql'),start=schema.indexOf('CREATE TABLE IF NOT EXISTS cont_cuentas_rol (');if(start<0)policy.fail('C15B_SCHEMA');
  await c.query(schema.slice(start,schema.indexOf(';',start)+1));
  await run('sql/migrate-2026-10-cuenta-resultado-c3c7.sql');
  await c.query('ALTER TABLE usuario_modulo ADD COLUMN puede_editar TINYINT NOT NULL DEFAULT 0,ADD COLUMN puede_crear TINYINT NOT NULL DEFAULT 0,ADD COLUMN puede_eliminar TINYINT NOT NULL DEFAULT 0');
  for(const name of ['regularizacion-control-c3c9','origen-revisiones-c3c10','politicas-autorizacion-c3c11','expediente-evidencia-c3c12','validacion-precontable-c3c13']){
   await run('sql/preflight-2026-10-'+name+'.sql',true);await run('sql/migrate-2026-10-'+name+'.sql');await run('sql/postcheck-2026-10-'+name+'.sql',true);
  }
  await c.query('ALTER TABLE empresas ADD COLUMN codigo VARCHAR(40),ADD COLUMN nombre VARCHAR(200),ADD COLUMN slug VARCHAR(80),ADD COLUMN logo_url VARCHAR(500)');
  await c.query('ALTER TABLE usuarios ADD COLUMN password_hash VARCHAR(128),ADD COLUMN salt VARCHAR(64),ADD COLUMN nombre VARCHAR(200),ADD COLUMN email VARCHAR(200),ADD UNIQUE KEY uq_c15_username(username)');
  // Columnas de lectura de la página de entrada Contabilidad.
  for(const tabla of ['cont_cxc','cont_cxp'])await c.query(`ALTER TABLE ${tabla} ADD COLUMN ${tabla==='cont_cxc'?'cliente':'proveedor'} VARCHAR(200),ADD COLUMN documento VARCHAR(80),ADD COLUMN fecha DATE,ADD COLUMN vencimiento DATE,ADD COLUMN monto DECIMAL(14,2),ADD COLUMN saldo DECIMAL(14,2),ADD COLUMN estado VARCHAR(40)`);
  for(const [id,name,editar]of [[41,'preparador',1],[42,'revisor',1],[44,'resolutor',1],[45,'lector',0]]){
   const secret=crypto.randomBytes(18).toString('hex'),salt=crypto.randomBytes(32).toString('hex'),hash=crypto.scryptSync(secret,salt,64).toString('hex');
   await c.execute('INSERT INTO usuarios(id,username,rol_global,activo,acceso_todas_empresas,password_hash,salt,nombre) VALUES (?,?,?,1,0,?,?,?)',[id,'qa-'+name,'Contabilidad',hash,salt,'QA '+name]);
   await c.execute("INSERT INTO usuario_modulo VALUES (?,NULL,'contabilidad',1,?,0,0)",[id,editar]);
   for(const modulo of ['contabilidad_calendario_ver','contabilidad_calendario_crear'])await c.execute('INSERT INTO usuario_modulo VALUES (?,NULL,?,1,?, ?,0)',[id,modulo,editar,modulo.endsWith('crear')?editar:0]);
   ctx.accounts.push({id,username:'qa-'+name,password:secret,role:name});
  }
  fs.writeFileSync(path.join(stateDir,'private.json'),JSON.stringify(ctx),{flag:'wx',mode:0o600});
  const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP,PATH:process.env.PATH,NODE_ENV:'test',C3C15B_SEED:path.join(stateDir,'private.json')};
  const result=cp.spawnSync(process.execPath,[path.join(config.repo,'node_modules/vitest/vitest.mjs'),'run','--config','scripts/ci/c3c15b/seed.config.mts'],{cwd:config.repo,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:1024*1024});
  if(result.status!==0)policy.fail('C15B_SEED_FAILED');
  for(const name of ['regularizacion-control-c3c9','origen-revisiones-c3c10','politicas-autorizacion-c3c11','expediente-evidencia-c3c12','validacion-precontable-c3c13'])await run('sql/postcheck-2026-10-'+name+'.sql',true);
  await c.execute("UPDATE _c3c15_lab SET estado='READY' WHERE id=?",[ctx.id]);
  evidence.estado='READY';evidence.accounts=ctx.accounts.map(({id,username,role})=>({id,username,role}));
  return evidence;
 }catch(e){evidence.estado=own?'INCOMPLETE_DO_NOT_REUSE':'REJECTED';evidence.error=String(e.code??'C15B_FAILURE');evidence.errorType=e.name;evidence.frames=String(e.stack).split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,5);throw Object.assign(new Error(evidence.error),{code:evidence.error});}
 finally{if(own)fs.writeFileSync(path.join(stateDir,'bootstrap-evidence.json'),JSON.stringify(evidence,null,2));await c.end();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 let data='';for await(const chunk of process.stdin){data+=chunk;if(data.length>16384)policy.fail('C15B_INPUT_SIZE');}
 try{const input=JSON.parse(data);const result=await initialize(input.config,input.password,input.stateDir);console.log(JSON.stringify(result));}
 catch(e){console.error(String(e.code??'C15B_FAILED'));process.exitCode=1;}
}
