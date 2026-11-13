// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { AsignacionCB2, type DecisionAsignacion } from "./asignacion";
import { useRevisionCB2 } from "./use-revision";
import { pilotoIndependiente, seleccionPilotoIndependiente } from "./piloto-independiente";
import { asignacionesExactas, seleccionSegura } from "./preview-model";
import type { CatalogosCB2, FilaCB2 } from "./client";
const fila: FilaCB2={hoja:"OCTUBRE",fila:9,candidato:"a".repeat(64),bloqueada:false,documento:null,errores:[],estado:"ADVERTENCIA",motivos:[],vale:"121646",placa:"060 KHK",placaNormalizada:"060KHK",fecha:"2026-10-01",galones:"10",precio:"20",monto:"200",moneda:"GTQ",origen:{piloto:"Luis Escobar",producto:"DIESEL",km:"",galones:"10",precio:"20",monto:"200"}};
const cat:CatalogosCB2={tercerosDirectos:true,identidadesIndependientes:true,tercerosHabilitados:true,proveedores:[],empleados:[{id:7,nombre:"Piloto Interno"}],vehiculos:[{id:1,placa:"M060KHK"},{id:-21,placa:"M060KHK"}],pilotosExternos:[{id:11,nombre:"Luis Escobar",referencia:"LAB"}],unidadesExternas:[{id:21,placa:"M060KHK",tipo:"MOTOCICLETA",referencia:"LAB",descripcion:"LAB"}],terceros:[]};
it("cuatro combinaciones independientes y decisiones manuales sobreviven al recalculo DOM",async()=>{
 (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 function Pantalla(){const [ds,setDs]=useState<Record<string,DecisionAsignacion>>({});const [n,setN]=useState(0);const r=useRevisionCB2([{...fila,placaNormalizada:cat.vehiculos[0].placa}],{...cat,empleados:[...cat.empleados!]},ds,setDs);return createElement('div',null,createElement('button',{onClick:()=>r.asignar(fila.candidato!,'1')},'Unidad propia'),createElement('button',{onClick:()=>setN(n+1)},'Recalcular'),createElement('output',{'data-unidad':r.asignaciones[fila.candidato!]},r.resumen.revision[0]?.estado),createElement(AsignacionCB2,{fila,cat,value:ds[fila.candidato!]??{},onChange:v=>r.cambiarDecision(fila.candidato!,v),disabled:false}));}
 async function cambiar(label:string,value:string){const l=[...host.querySelectorAll('label')].find(l=>l.textContent?.startsWith(label))!;const s=(l.querySelector('select')??document.getElementById(l.htmlFor)) as HTMLSelectElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(s,value);s.dispatchEvent(new Event('change',{bubbles:true}));});}
 try{await act(async()=>root.render(createElement(Pantalla)));expect(host.querySelector('output')!.textContent).toBe('PENDIENTE');
  expect(host.textContent).toContain('Piloto de la empresa para vale');expect(host.textContent).toContain('Piloto tercerizado para vale');
  for(const externo of [false,true])for(const externa of [false,true]){
   await cambiar(externo?'Piloto tercerizado para vale':'Piloto de la empresa para vale',externo?'11':'7');
   if(externa)await cambiar('Unidad tercerizada para vale','21');else await act(async()=>host.querySelector('button')!.click());
    expect(host.querySelector('output')!.textContent,`externo=${externo}, externa=${externa}, unidad=${host.querySelector('output')!.getAttribute('data-unidad')}`).toBe('LISTO');expect(host.querySelector('output')!.getAttribute('data-unidad')).toBe(externa?'-21':'1');
   await act(async()=>host.querySelectorAll('button')[1].click());expect(host.querySelector('output')!.textContent).toBe('LISTO');
  }
  expect(host.textContent).not.toContain('VERIFICADA por otro administrador');
  await cambiar('Piloto tercerizado para vale','');expect(host.querySelector('output')!.textContent).toBe('PENDIENTE');
 }finally{await act(async()=>root.unmount());host.remove();}
});
it("autopropuestas separadas: homonimos, coincidencia entre categorias y combustible pendiente",()=>{
 const unique={...cat,vehiculos:cat.vehiculos.filter(v=>v.id<0)};
 expect(asignacionesExactas([fila],unique)).toEqual({[fila.candidato!]:'-21'});
 expect(seleccionSegura([fila],unique,{[fila.candidato!]:'-21'})).toEqual({[fila.candidato!]:'-21'});
 expect(seleccionPilotoIndependiente(fila,unique,{})).toMatchObject({pilotoTipo:'EXTERNO',pilotoExternoId:11,empleadoId:null});
 expect(pilotoIndependiente(fila,{...unique,empleados:[{id:8,nombre:'Luis Escobar'}]})).toBeNull();
 expect(pilotoIndependiente(fila,{...unique,pilotosExternos:[...cat.pilotosExternos!,{...cat.pilotosExternos![0],id:12}]})).toBeNull();
 expect(asignacionesExactas([fila],cat)).toEqual({});
 expect(seleccionSegura([fila],unique,{[fila.candidato!]:'-21'},{},{[fila.candidato!]:{pilotoExternoId:null}})).toEqual({});
 expect(seleccionSegura([{...fila,origen:{...fila.origen!,producto:''}}],unique,{[fila.candidato!]:'-21'},{},{[fila.candidato!]:{exigirProducto:true}})).toEqual({});
 const interno={...fila,origen:{...fila.origen!,piloto:'Piloto Interno'}};
 expect(pilotoIndependiente(interno,unique)).toMatchObject({tipo:'INTERNO',id:7,manual:false});
 expect(seleccionSegura([interno],unique,{[fila.candidato!]:'-21'})).toEqual({[fila.candidato!]:'-21'});
});
