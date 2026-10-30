// Diagnóstico de solo lectura. No inicia navegador, Excel, helper, Next ni base de datos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const cache=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime');
const bundled=path.join(cache,'dependencies/node/bin/node.exe');
const metadataFile=path.join(cache,'runtime.json');
const metadata=fs.existsSync(metadataFile)?JSON.parse(fs.readFileSync(metadataFile,'utf8')):{};
function version(executable){
 if(!fs.existsSync(executable))return {presente:false};
 const r=spawnSync(executable,['--version'],{cwd:process.cwd(),encoding:'utf8',timeout:5000,windowsHide:true});
 return {presente:true,codigo:r.status,error:r.error?.code??null,version:r.stdout?.trim()??''};
}
const salida={contrato:'C3C15-DIAGNOSTICO-1',plataforma:process.platform,arquitectura:process.arch,
 nodeSistema:version(process.execPath),nodeEmpaquetado:version(bundled),
 paquete:{version:metadata.bundleVersion,plataforma:metadata.targetPlatform,arquitectura:metadata.targetArch,nodeDeclarado:metadata.nodeVersion},
 aplicaciones:{
  chrome:fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe'),
  edge:fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'),
  excel:fs.existsSync('C:/Program Files/Microsoft Office/root/Office16/EXCEL.EXE'),
 },
 happyDomInstalado:fs.existsSync(path.resolve('node_modules/happy-dom/package.json')),
 alcance:'Solo existencia de rutas conocidas y node --version. No demuestra funcionamiento de navegador/Excel ni identifica la ruta interna que falta al lanzador MCP.'};
const out=process.argv.find(a=>a.startsWith('--output='));
if(out){const file=path.resolve(out.slice(9));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(salida,null,2)+'\n');}
console.log(JSON.stringify(salida,null,2));
