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

function aclFixture(){const dir=path.join(os.tmpdir(),'novalvion-c3c15b-test-'+crypto.randomBytes(16).toString('hex'),'private');secureDirectory(dir);fs.rmdirSync(dir);return dir;}
function ps(dir,script){return cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $p=$env:C3C15B_ACL_PATH; "+script],{env:{...process.env,C3C15B_ACL_PATH:dir},windowsHide:true,encoding:'utf8'});}
test('directorio existente seguro conserva secreto y ACL al repetir',()=>{
 const dir=aclFixture();secureDirectory(dir);const file=path.join(dir,'sentinel');fs.writeFileSync(file,'SYNTHETIC-NO-CREDENTIAL');
 secureDirectory(dir);assert.equal(fs.readFileSync(file,'utf8'),'SYNTHETIC-NO-CREDENTIAL');
 assert.deepEqual(fs.readdirSync(dir),['sentinel']);
});
test('directorio heredado existente rechazado sin reparar ni escribir',()=>{
 const dir=aclFixture();fs.mkdirSync(dir,{recursive:true});
 assert.throws(()=>secureDirectory(dir),{code:'C15B_PRIVATE_ACL'});assert.deepEqual(fs.readdirSync(dir),[]);
});
for(const [name,mutation]of [
 ['allow Everyone',"$r=New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier 'S-1-1-0'),'ReadAndExecute','Allow');[void]$a.AddAccessRule($r)"],
 ['deny operador',"$r=New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().User,'Write','Deny');[void]$a.AddAccessRule($r)"],
 ['herencia activada',"$a.SetAccessRuleProtection($false,$true)"],
 ['sin herencia a hijos',"$s=[Security.Principal.WindowsIdentity]::GetCurrent().User;[void]$a.PurgeAccessRules($s);$r=New-Object Security.AccessControl.FileSystemAccessRule($s,'FullControl','Allow');[void]$a.AddAccessRule($r)"],
])test('ACL incorrecta rechazada: '+name,()=>{
 const dir=aclFixture();secureDirectory(dir);
 const result=ps(dir,"$d=New-Object IO.DirectoryInfo $p;$a=$d.GetAccessControl([Security.AccessControl.AccessControlSections]::Access);"+mutation+";$d.SetAccessControl($a)");assert.equal(result.status,0);
 assert.throws(()=>secureDirectory(dir),{code:'C15B_PRIVATE_ACL'});assert.deepEqual(fs.readdirSync(dir),[]);
});
test('junction inesperada rechazada sin escribir en destino',()=>{
 const dir=aclFixture(),target=fs.mkdtempSync(path.join(os.tmpdir(),'c15b-link-target-'));
 fs.symlinkSync(target,dir,'junction');
 assert.throws(()=>secureDirectory(dir),{code:'C15B_PRIVATE_ACL'});assert.deepEqual(fs.readdirSync(target),[]);
});
test('fallo PowerShell con archivo en lugar de directorio preserva contenido',()=>{
 const dir=aclFixture();fs.writeFileSync(dir,'SYNTHETIC');
 assert.throws(()=>secureDirectory(dir),{code:'C15B_PRIVATE_ACL'});assert.equal(fs.readFileSync(dir,'utf8'),'SYNTHETIC');
});
test('token anonimo no puede leer archivo privado (sin cuenta ni elevacion)',()=>{
 const dir=aclFixture();secureDirectory(dir);fs.writeFileSync(path.join(dir,'sentinel'),'SYNTHETIC');
 const result=ps(dir,`
 Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class C15BToken { [DllImport("advapi32.dll", SetLastError=true)] public static extern bool ImpersonateAnonymousToken(IntPtr thread); [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentThread(); [DllImport("advapi32.dll")] public static extern bool RevertToSelf(); }'
 $sentinel=[IO.Path]::Combine($p,'sentinel')
 if(-not [C15BToken]::ImpersonateAnonymousToken([C15BToken]::GetCurrentThread())) { exit 2 }
 $denied=$false
 try { try { [void][IO.File]::ReadAllText($sentinel) } catch [UnauthorizedAccessException] { $denied=$true } }
 finally { if(-not [C15BToken]::RevertToSelf()) { exit 3 } }
 if(-not $denied) { exit 4 }
 `);
 assert.equal(result.status,0,result.stderr);
});
test('archivo con ACL expuesta rechazado antes de leer secretos',()=>{
 const dir=aclFixture();secureDirectory(dir);fs.writeFileSync(path.join(dir,'sentinel'),'SYNTHETIC');
 const result=ps(dir,"$f=New-Object IO.FileInfo (Join-Path $p 'sentinel');$a=$f.GetAccessControl([Security.AccessControl.AccessControlSections]::Access);$r=New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier 'S-1-1-0'),'Read','Allow');[void]$a.AddAccessRule($r);$f.SetAccessControl($a)");assert.equal(result.status,0);
 assert.throws(()=>secureDirectory(dir),{code:'C15B_PRIVATE_ACL'});
});
test('propietario inesperado: rama de rechazo con SID esperado simulado',()=>{
 const dir=aclFixture();secureDirectory(dir);
 const source=fs.readFileSync(new URL('./private-directory.ps1',import.meta.url),'utf8').replace('$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User',"$sid = New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'");
 const result=ps(dir,source);assert.equal(result.status,1);assert.deepEqual(fs.readdirSync(dir),[]);
});
test('fallo inyectado de PowerShell despues de crear deja DACL privada sin secretos',()=>{
 const dir=aclFixture();
 const source=fs.readFileSync(new URL('./private-directory.ps1',import.meta.url),'utf8').replace('# Existing directories are rejected',"throw 'SYNTHETIC_FAULT'\n # Existing directories are rejected");
 const result=ps(dir,source);assert.equal(result.status,1);assert.deepEqual(fs.readdirSync(dir),[]);
 secureDirectory(dir);assert.deepEqual(fs.readdirSync(dir),[]);
});
test('padre escribible por Everyone rechazado por riesgo de reemplazo',()=>{
 const dir=aclFixture();secureDirectory(dir);
 const result=ps(path.dirname(dir),"$d=New-Object IO.DirectoryInfo $p;$a=$d.GetAccessControl([Security.AccessControl.AccessControlSections]::Access);$r=New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier 'S-1-1-0'),'Modify','Allow');[void]$a.AddAccessRule($r);$d.SetAccessControl($a)");assert.equal(result.status,0);
 assert.throws(()=>secureDirectory(dir),{code:'C15B_PRIVATE_ACL'});assert.deepEqual(fs.readdirSync(dir),[]);
});
