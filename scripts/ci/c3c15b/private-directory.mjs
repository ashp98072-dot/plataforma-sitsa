import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import policy from './policy.cjs';

export function secureDirectory(state){
 const parent=path.dirname(path.resolve(state));
 if(policy.normal(path.dirname(parent))!==policy.normal(os.tmpdir())||
  !/^novalvion-c3c15(?:-manual|b-test-[a-f0-9]{32})$/.test(path.basename(parent))||
  !['acceptance-private','private'].includes(path.basename(state)))policy.fail('C15B_PRIVATE_SCOPE');
 const result=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`
  $ErrorActionPreference='Stop'
  $p=$env:C3C15B_ACL_PATH
  if(-not(Test-Path -LiteralPath $p)){[void](New-Item -ItemType Directory -Path $p)}
  if((Get-Item -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'C15B_REPARSE_STATE'}
  $s=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $a=New-Object Security.AccessControl.DirectorySecurity
  $a.SetOwner($s); $a.SetAccessRuleProtection($true,$false)
  foreach($i in @($s,(New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'))){
   $r=New-Object Security.AccessControl.FileSystemAccessRule($i,'FullControl',[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,'Allow')
   [void]$a.AddAccessRule($r)
  }
  Set-Acl -LiteralPath $p -AclObject $a
 `],{windowsHide:true,encoding:'utf8',env:{...process.env,C3C15B_ACL_PATH:state}});
 if(result.status!==0)policy.fail('C15B_PRIVATE_ACL');
}
