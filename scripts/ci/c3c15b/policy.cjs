/* eslint-disable @typescript-eslint/no-require-imports -- Pol?tica y guard s?ncronos del preload Node --require. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const normal=p=>path.resolve(p).replace(/[\\/]+$/,'').toLowerCase();
function config(repo){return {host:'127.0.0.1',port:43306,database:'c3c15_lab',user:'c3c15_app',httpPort:4315,
 datadir:path.join(os.tmpdir(),'novalvion-c3c15-manual/data'),repo:path.resolve(repo)};}
function validateConfig(c){
 if(!c||c.host!=='127.0.0.1'||c.database!=='c3c15_lab'||c.user!=='c3c15_app'||!Number.isInteger(c.port)||c.port<1025||[3306,33060].includes(c.port)||!Number.isInteger(c.httpPort)||c.httpPort<1025||c.httpPort===c.port)fail('C15B_TARGET');
 const parent=path.dirname(path.resolve(c.datadir));
 if(normal(path.dirname(parent))!==normal(os.tmpdir())||!/^novalvion-c3c15(?:-manual|b-test-[a-f0-9]{32})$/i.test(path.basename(parent))||path.basename(c.datadir)!=='data')fail('C15B_DATADIR_SCOPE');
 if(path.basename(parent)==='novalvion-c3c15-manual'&&c.port!==43306)fail('C15B_PORT');
}
function validateIdentity(r,c){
 validateConfig(c);
 if(!r||!/^11\.8\.9-MariaDB/.test(String(r.version))||Number(r.port)!==c.port||normal(r.datadir)!==normal(c.datadir)||String(r.bind)!=='127.0.0.1'||r.db!==c.database||!String(r.account).startsWith(c.user+'@')||!String(r.login).startsWith(c.user+'@')||Number(r.fk)!==1||Number(r.checks)!==1)fail('C15B_IDENTITY');
 const pid=normal(r.pidFile),parent=normal(path.dirname(c.datadir));
 if(!pid.startsWith(parent+path.sep)||!fs.existsSync(r.pidFile))fail('C15B_PIDFILE');
 if(normal(fs.realpathSync(c.datadir))!==normal(c.datadir))fail('C15B_REPARSE_DATADIR');
 const actualPid=Number(fs.readFileSync(r.pidFile,'utf8').trim());
 if(!Number.isInteger(actualPid)||actualPid<=0||(c.serverPid&&c.serverPid!==actualPid))fail('C15B_SERVER_PID');
}
function validateGrants(rows,c){
 for(const r of rows){const g=String(Object.values(r)[0]);
  if(/^GRANT USAGE ON \*\.\* TO /i.test(g)&&!/WITH GRANT OPTION/i.test(g))continue;
  const match=g.match(/^GRANT (.+) ON `([^`]+)`\.\* TO /i);
  if(!match||match[2].replaceAll('\\_','_')!==c.database||/WITH GRANT OPTION/i.test(g))fail('C15B_GRANTS');
 }
 if(!rows.some(r=>String(Object.values(r)[0]).replaceAll('\\_','_').includes('`'+c.database+'`.*')))fail('C15B_GRANTS');
}
function envCandidates(root){
 const p=(...s)=>path.resolve(root,...s);
 return [...[1,2,3].flatMap(n=>['.env','app.env'].map(f=>p(...Array(n).fill('..'),'config',f))),
  ...['.env','.env.local','.env.production','.env.production.local','.env.development','.env.development.local','.env.test','.env.test.local'].map(f=>p(f))];
}
function assertCleanEnvironment(root,env=process.env){
 if(env.NODE_OPTIONS||env.NODE_PATH||Object.keys(env).some(k=>/^(DB_|MYSQL_|MARIADB_|AUTH_SECRET$|SMTP_|FEL_)/i.test(k)))fail('C15B_INHERITED_ENV');
 if(envCandidates(root).some(p=>fs.existsSync(p)))fail('C15B_ENV_FILE');
 if(fs.readdirSync(root).some(n=>/^\.env(?:\.|$)/.test(n)&&n!=='.env.example'))fail('C15B_ENV_FILE');
}
module.exports={config,validateConfig,validateIdentity,validateGrants,envCandidates,assertCleanEnvironment,normal,fail};
