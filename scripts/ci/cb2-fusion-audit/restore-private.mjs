import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
const root=path.resolve('../..'), home=path.join(root,'.lab-runtime/mariadb-11.8.9-winx64');
const manifest=JSON.parse(fs.readFileSync('scripts/ci/pricesmart-api06a/engine-manifest.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
if(hash(fs.readFileSync(home+'.zip'))!==manifest.zipSha256)throw Error('Unverified engine archive');
for(const n of ['mariadb.exe','mariadbd.exe','mariadb-install-db.exe'])if(hash(fs.readFileSync(path.join(home,'bin',n)))!==manifest.files['bin/'+n])throw Error('Unverified engine binary');
const run=path.join(root,'.lab-runtime','cb2-audit-'+randomUUID());fs.mkdirSync(run,{recursive:true});
const pipe='cb2-audit-'+randomUUID(), data=path.join(run,'data'), bin=n=>path.join(home,'bin',n+'.exe');
const exec=(n,args,input='')=>cp.spawnSync(bin(n),args,{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
const init=exec('mariadb-install-db',[`--datadir=${data}`,`--socket=${pipe}`,'--skip-networking']);if(init.status!==0)throw Error(init.stderr+init.stdout);
const fd=fs.openSync(path.join(run,'server.log'),'w');const server=cp.spawn(bin('mariadbd'),['--no-defaults',`--basedir=${home}`,`--datadir=${data}`,'--skip-networking','--enable-named-pipe',`--socket=${pipe}`,'--innodb-buffer-pool-size=64M','--console'],{windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);
const sql=s=>exec('mariadb',['--no-defaults','--protocol=PIPE','--host=.',`--socket=${pipe}`,'-uroot','--batch','--raw','--skip-column-names'],s);
const check=(name,s)=>{const r=sql(s);fs.writeFileSync(path.join(run,name+'.json'),JSON.stringify(r));console.log(name,r.status,r.stderr.slice(0,1800));return r;};
try{
for(let i=0;i<60;i++){if(sql('SELECT 1').status===0)break;await new Promise(r=>setTimeout(r,500));}
const identity=sql('SELECT VERSION(),@@skip_networking,@@socket;');if(!identity.stdout.startsWith('11.8.9-MariaDB')||!identity.stdout.includes(pipe))throw Error('Isolation failed');
console.log('PRIVATE laboratory',run,identity.stdout.trim());
const backup=fs.readFileSync(process.argv[2] ?? (()=>{throw Error('Provide private pre-CB2 backup path');})(),'utf8');
if(check('restore',backup).status!==0)throw Error('Restore failed');
const use='USE u611730801_Plataforma;\n';
if(check('cb2',use+fs.readFileSync('sql/migrate-2026-11-cb2-terceros-directos.sql','utf8')).status!==0)throw Error('CB2 failed');
check('fusion-original',use+fs.readFileSync('sql/migrate-2026-11-flota-fusiones.sql','utf8'));
const test=cp.spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/lib/flota/vehiculos-fusion-private.db.test.ts','--maxWorkers=1'],{env:{...process.env,CB2_PRIVATE_PIPE:pipe},encoding:'utf8',windowsHide:true,timeout:120000}); console.log(test.stdout,test.stderr); if(test.status!==0)throw Error('Private integration failed');
const post=check('postcheck',use+fs.readFileSync('sql/postcheck-2026-11-flota-fusiones.sql','utf8'));if(post.status!==0||post.stdout.trim()!=='4\n0')throw Error('Postcheck mismatch');
// A second private schema demonstrates non-transactional DDL failure with restricted grants.
const partial='cb2_partial';
if(check('partial-restore',backup.replaceAll('u611730801_Plataforma',partial)).status!==0)throw Error('Partial restore failed');
if(check('partial-cb2','USE '+partial+';\n'+fs.readFileSync('sql/migrate-2026-11-cb2-terceros-directos.sql','utf8')).status!==0)throw Error('Partial CB2 failed');
const [partialHead,partialTail]=fs.readFileSync('sql/migrate-2026-11-flota-fusiones.sql','utf8').split('DELIMITER //');
if(check('partial-table','USE '+partial+';\n'+partialHead).status!==0)throw Error('Partial table failed');
const grants="CREATE USER 'lab_ddl'@'localhost'; GRANT SELECT,INSERT,UPDATE,CREATE,DROP,ALTER,INDEX,REFERENCES,CREATE ROUTINE,ALTER ROUTINE,EXECUTE ON cb2_partial.* TO 'lab_ddl'@'localhost'; GRANT TRIGGER ON cb2_partial.flota_vehiculos TO 'lab_ddl'@'localhost'; GRANT TRIGGER ON cb2_partial.flota_vehiculos_fusiones TO 'lab_ddl'@'localhost';";
if(check('partial-grants',grants).status!==0)throw Error('Restricted grants failed');
const denied=exec('mariadb',['--no-defaults','--protocol=PIPE','--host=.',`--socket=${pipe}`,'-ulab_ddl','--batch','--raw','--skip-column-names'],'USE '+partial+';\nDELIMITER //\n'+partialTail);
fs.writeFileSync(path.join(run,'partial-failure.json'),JSON.stringify(denied));
if(denied.status===0||!denied.stderr.includes('TRIGGER command denied'))throw Error('Expected restricted TRIGGER failure');
const partialPost=check('partial-postcheck','USE '+partial+';\n'+fs.readFileSync('sql/postcheck-2026-11-flota-fusiones.sql','utf8'));
if(partialPost.status!==0||!partialPost.stdout.includes('ffi_')||!partialPost.stdout.includes('ffu_'))throw Error('Partial install was not detected');
console.log('PASS: restricted privilege failure leaves partial DDL, detected by postcheck');
check('schema-check',use+"SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE(); SELECT COUNT(*) FROM flota_vehiculos_fusiones;");
}finally{sql('SHUTDOWN;');for(let i=0;i<50&&server.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));if(server.exitCode===null)server.kill();}
