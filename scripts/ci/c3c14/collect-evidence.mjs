// Solo lectura de evidencias locales; nunca conecta a una base de datos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const args=process.argv.slice(2),unitArg=args.find(a=>a.startsWith('--unit=')),outputArg=args.find(a=>a.startsWith('--output='));
if(!unitArg||!outputArg)throw Error('Uso: --unit=archivo --output=archivo directorios-temporales...');
const interno=nombre=>{
 const p=path.resolve(repo,nombre);
 if(!p.startsWith(repo+path.sep))throw Error('Ruta fuera del repositorio');
 return p;
};
const leer=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const resumen=r=>({total:r.numTotalTests,aprobadas:r.numPassedTests,fallidas:r.numFailedTests,pendientes:r.numPendingTests});
const exigir=r=>{if(r.numTotalTests<1||r.numPassedTests!==r.numTotalTests||r.numFailedTests||r.numPendingTests)throw Error('Evidencia con fallos u omisiones');};
const suites=[],artefactos={};
let recorrido;
for(const nombre of args.filter(a=>!a.startsWith('--'))){
 if(!/^novalvion-c3c2-[a-f0-9]{32}$/.test(nombre))throw Error('Directorio no pertenece a ejecucion aislada');
 const dir=path.join(os.tmpdir(),nombre),resultados=leer(path.join(dir,'results.json')),meta=leer(path.join(dir,'qa-execution.json'));
 exigir(resultados);
 const cierre=fs.readFileSync(path.join(dir,'shutdown.jsonl'),'utf8').trim().split(/\r?\n/).map(l=>JSON.parse(l));
 if(cierre.at(-1)?.event!=='shutdown-confirmed')throw Error('Cierre no confirmado');
 const postcheck=leer(path.join(dir,'postcheck-c13.json'));
 if(postcheck.length!==5||postcheck.some(c=>Number(c.errores)!==0))throw Error('Postcheck incorrecto');
 suites.push({suite:meta.suite,...resumen(resultados),directorio:nombre,cierre:'shutdown-confirmed',postcheck,
  resultadosSha256:sha(path.join(dir,'results.json')),ejecucionSha256:sha(path.join(dir,'qa-execution.json')),
  casos:resultados.testResults.flatMap(f=>f.assertionResults.map(c=>({nombre:c.fullName,estado:c.status})))});
 if(meta.suite==='c3c14'){
  recorrido=leer(path.join(dir,'c3c14-journey.json'));
  for(const archivo of ['c3c14-precontable.xlsx','c3c14-informe.json','c3c14-render.html','qa-execution.json'])artefactos[archivo]={directorio:nombre,sha256:sha(path.join(dir,archivo))};
 }
}
if(suites.length!==10||new Set(suites.map(s=>s.suite)).size!==10||!recorrido)throw Error('Faltan suites C3C5 a C3C14');
const unit=leer(interno(unitArg.slice(7)));exigir(unit);
const salida=interno(outputArg.slice(9));fs.mkdirSync(path.dirname(salida),{recursive:true});
fs.writeFileSync(salida,JSON.stringify({contrato:'C3C14-EVIDENCIA-1',base:'cdb85965',fecha:'2026-10-30',
 integracion:suites,unitarias:resumen(unit),totalIntegracion:suites.reduce((n,s)=>n+s.aprobadas,0),recorrido,artefactos,
 noRealizado:[
  {prueba:'Navegador autenticado / DOM real',motivo:'mcp__cua_repl: failed to start Node runtime, os error 3'},
  {prueba:'Presentacion visual en Microsoft Excel',motivo:'mcp__node_repl: failed to start Node runtime, os error 3; Excel instalado'},
  {prueba:'Login HTTP y servidor Next completo',motivo:'API probada en proceso con JWT/guard reales y next/headers.cookies simulado; no equivale a login HTTP'},
 ],sinMigracionNueva:true,sinAutorizacionFormal:true},null,2)+'\n');
console.log('Evidencia recopilada:',path.relative(repo,salida));
