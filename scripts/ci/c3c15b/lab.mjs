// Entrada alternativa cuando la política existente no permite ejecutar Lab.ps1.
// No modifica ni evita la política de ejecución de PowerShell.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {Writable} from 'node:stream';
import policy from './policy.cjs';
import {initialize} from './initialize.mjs';
import {control} from './control.mjs';
import {secureDirectory} from './private-directory.mjs';

const action=process.argv[2];
const repo=path.resolve(process.argv[3]??process.cwd());
const state=path.join(os.tmpdir(),'novalvion-c3c15-manual','acceptance-private');
const file=path.join(state,'private.json');
try {
 if(action==='prepare'){
  policy.assertCleanEnvironment(repo);
  if(fs.existsSync(file))policy.fail('C15B_STATE_EXISTS');
  if(!process.stdin.isTTY||!process.stdout.isTTY)policy.fail('C15B_INTERACTIVE_REQUIRED');
  secureDirectory(state);
  process.stdout.write('Password local de c3c15_app (oculta; sin transcript): ');
  const muted=new Writable({write(_chunk,_encoding,done){done();}});
  const reader=readline.createInterface({input:process.stdin,output:muted,terminal:true});
  let password;
  try{password=await new Promise((resolve,reject)=>{reader.once('SIGINT',()=>reject(Object.assign(new Error(),{code:'C15B_CANCELLED'})));reader.question('',resolve);});}
  finally{reader.close();process.stdout.write('\n');}
  try{console.log(JSON.stringify(await initialize(policy.config(repo),password,state)));}
  finally{password=undefined;}
 }else if(action==='credentials'){
  if(!process.stdout.isTTY)policy.fail('C15B_INTERACTIVE_REQUIRED');
  console.log('Credenciales sinteticas privadas: no capturar ni publicar.');
  console.table(JSON.parse(fs.readFileSync(file,'utf8')).accounts.map(({username,role,password})=>({username,role,password})));
 }else{
  if(!['verify','start','stop'].includes(action))policy.fail('C15B_ACTION');
  console.log(JSON.stringify(await control(action,file)));
 }
}catch(e){console.error(String(e.code??'C15B_FAILED'));process.exitCode=1;}
