import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import policy from './policy.cjs';

const script=fs.readFileSync(new URL('./private-directory.ps1',import.meta.url),'utf8');
export function secureDirectory(state){
 const resolved=path.resolve(state),parent=path.dirname(resolved);
 if(policy.normal(path.dirname(parent))!==policy.normal(os.tmpdir())||
  !/^novalvion-c3c15(?:-manual|b-test-[a-f0-9]{32})$/.test(path.basename(parent))||
  !['acceptance-private','private'].includes(path.basename(resolved)))policy.fail('C15B_PRIVATE_SCOPE');
 const result=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
  {windowsHide:true,encoding:'utf8',timeout:30000,env:{...process.env,C3C15B_ACL_PATH:resolved}});
 if(result.status!==0)policy.fail('C15B_PRIVATE_ACL');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{secureDirectory(process.argv[2]);}catch(e){console.error(String(e.code??'C15B_PRIVATE_ACL'));process.exitCode=1;}
}
