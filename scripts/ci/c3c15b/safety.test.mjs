import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import policy from './policy.cjs';
import {secureDirectory} from './private-directory.mjs';
import cp from 'node:child_process';
const cfg=policy.config(process.cwd());
test('ACL privada real restringida a operador y SYSTEM en PowerShell 5.1',()=>{
 const dir=path.join(os.tmpdir(),'novalvion-c3c15b-test-'+crypto.randomBytes(16).toString('hex'),'private');
 secureDirectory(dir);
 const result=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$a=Get-Acl -LiteralPath $env:C3C15B_ACL_PATH; $s=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if(-not $a.AreAccessRulesProtected){exit 2}; foreach($r in $a.Access){if($r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($s,'S-1-5-18') -or $r.AccessControlType -ne 'Allow'){exit 3}}; if($a.Access.Count -ne 2){exit 4}"],{env:{...process.env,C3C15B_ACL_PATH:dir},windowsHide:true,encoding:'utf8'});
 assert.equal(result.status,0);
 assert.throws(()=>secureDirectory(path.join(os.tmpdir(),'other-lab/private')),{code:'C15B_PRIVATE_SCOPE'});
});
test('destino fijo: remoto, producción, puerto habitual y laboratorio ajeno rechazados',()=>{
 for(const patch of [{host:'hostinger.com'},{host:'localhost'},{database:'plataforma'},{user:'root'},{port:3306},{datadir:path.join(os.tmpdir(),'novalvion-c3c8/data')}])assert.throws(()=>policy.validateConfig({...cfg,...patch}));
 policy.validateConfig(cfg);
});
test('grants no permiten privilegios globales, otras bases o grant option',()=>{
 const ok=[{g:'GRANT USAGE ON *.* TO `c3c15_app`@`127.0.0.1`'},{g:'GRANT ALL PRIVILEGES ON `c3c15_lab`.* TO `c3c15_app`@`127.0.0.1`'}];policy.validateGrants(ok,cfg);
 policy.validateGrants([{g:'GRANT SELECT ON `c3c15\\_lab`.* TO `c3c15_app`@`127.0.0.1`'}],cfg);
 for(const grant of ['GRANT ALL PRIVILEGES ON *.* TO `c3c15_app`@`%`','GRANT SELECT ON `otra`.* TO `c3c15_app`@`localhost`','GRANT ALL PRIVILEGES ON `c3c15_lab`.* TO x WITH GRANT OPTION'])assert.throws(()=>policy.validateGrants([...ok,{g:grant}],cfg));
});
test('se rechazan env operativos y todos los candidatos de load-env y Next',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'c15b-policy-'));
 for(const env of [{DB_HOST:'127.0.0.1'},{AUTH_SECRET:'x'},{NODE_OPTIONS:'x'},{FEL_TOKEN:'x'}])assert.throws(()=>policy.assertCleanEnvironment(dir,env));
 for(const name of ['.env','.env.local','.env.production','app.env']){
  const target=name==='app.env'?path.join(dir,'../config/app.env'):path.join(dir,name);
  if(name==='app.env')continue; // Candidato de ancestro comprobado sin escribir fuera del directorio propio.
  fs.writeFileSync(target,'NO_SECRET');assert.throws(()=>policy.assertCleanEnvironment(dir,{}));fs.unlinkSync(target);
 }
 assert.ok(policy.envCandidates(dir).includes(path.resolve(dir,'../config/app.env')));
});
test('version, bind remoto, usuario, base y checks forman parte de identidad',()=>{
 const dir=path.join(os.tmpdir(),'novalvion-c3c15b-test-'+crypto.randomBytes(16).toString('hex'));
 fs.mkdirSync(dir);fs.mkdirSync(path.join(dir,'data'));
 const c={...cfg,port:43307,datadir:path.join(dir,'data')};
 const pidFile=path.join(dir,'own.pid');fs.writeFileSync(pidFile,String(process.pid));
 const identity={version:'11.8.9-MariaDB',port:c.port,datadir:c.datadir,bind:'127.0.0.1',db:c.database,account:c.user+'@127.0.0.1',login:c.user+'@localhost',fk:1,checks:1,pidFile};
 policy.validateIdentity(identity,c);
 for(const patch of [{version:'11.8.8-MariaDB'},{port:3306},{bind:'0.0.0.0'},{db:'otra'},{fk:0},{checks:0},{account:'root@localhost'},{login:'root@localhost'}])assert.throws(()=>policy.validateIdentity({...identity,...patch},c),{code:'C15B_IDENTITY'});
 assert.throws(()=>policy.validateIdentity(identity,{...c,serverPid:process.pid+1}),{code:'C15B_SERVER_PID'});
});
