// @vitest-environment happy-dom
import { act,createElement,useState } from "react";
import { createRoot } from "react-dom/client";
import { it,expect,vi } from "vitest";
import { AsignacionCB2,type DecisionAsignacion } from "./asignacion";
import { asignacionesExactas,resumenPreview } from "./preview-model";
import { seleccionPilotoIndependiente } from "./piloto-independiente";
import type { CatalogosCB2,FilaCB2 } from "./client";
import { FondosConsumoCB2 } from "./fondos-consumo";
const fila:FilaCB2={hoja:"SHELL",fila:2,estado:"ADVERTENCIA",bloqueada:false,errores:[],motivos:["Piloto sin determinar"],documento:null,candidato:"c".repeat(64),vale:"SHELL-001",placa:"C001LAB",placaNormalizada:"C001LAB",fecha:"2026-10-01",galones:"10",precio:"20",monto:"200",moneda:"GTQ",origen:{piloto:"Mensajero reportado sin catalogo",producto:"vPower",km:"",galones:"10",precio:"20",monto:"200"}};
const cat:CatalogosCB2={proveedores:[],vehiculos:[{id:1,placa:"C001LAB"}],empleados:[],pilotosExternos:[],unidadesExternas:[],terceros:[],tercerosDirectos:true,tercerosHabilitados:true,identidadesIndependientes:true};
it("sin empleado ni fondo: LISTO; dato faltante o vinculo invalido sigue pendiente",()=>{
 const seleccion=asignacionesExactas([fila],cat);
 expect(resumenPreview([fila],cat,seleccion).listos).toBe(1);
 expect(seleccionPilotoIndependiente(fila,cat,{},1)).toEqual({empleadoId:null,metodoEmpleado:"SIN_ASIGNACION"});
 for(const d of [{pilotoTipo:"INTERNO" as const,empleadoId:999},{pilotoTipo:"EXTERNO" as const,pilotoExternoId:999}])expect(resumenPreview([fila],cat,seleccion,{},{},{[fila.candidato!]:d}).listos).toBe(0);
 expect(resumenPreview([{...fila,origen:{...fila.origen!,producto:"20W50"}}],cat,seleccion).listos).toBe(0);
 expect(resumenPreview([{...fila,bloqueada:true}],cat,seleccion).listos).toBe(0);
 const externa={...cat,vehiculos:[{id:-7,placa:"C001LAB"}],unidadesExternas:[{id:7,placa:"C001LAB",tipo:"VEHICULO",referencia:"LAB",descripcion:"LAB"}]};
 expect(resumenPreview([fila],externa,{[fila.candidato!]:"-7"}).listos).toBe(0);
 expect(resumenPreview([fila],{...externa,pilotoReportadoExterno:true},{[fila.candidato!]:"-7"}).listos).toBe(1);
});
it("seleccion manual solo nombre sobrevive al recalculo sin crear empleados",async()=>{
 (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement("div"),root=createRoot(host);document.body.append(host);
 const conocidos={...cat,empleados:[{id:8,nombre:fila.origen!.piloto!}]};
 let actual:DecisionAsignacion={};
 function Pantalla(){const [d,setD]=useState<DecisionAsignacion>({});actual=d;return createElement(AsignacionCB2,{fila,cat:conocidos,value:d,onChange:setD,disabled:false});}
 try{await act(async()=>root.render(createElement(Pantalla)));const select=host.querySelector('select')!;
 await act(async()=>{select.value="REPORTADO";select.dispatchEvent(new Event("change",{bubbles:true}));});
 expect(actual).toMatchObject({pilotoTipo:"REPORTADO",empleadoId:null,pilotoExternoId:null});
 expect(seleccionPilotoIndependiente(fila,conocidos,actual,1)).toEqual({empleadoId:null,metodoEmpleado:"SIN_ASIGNACION"});
 expect(host.textContent).toContain(fila.origen!.piloto);
 }finally{await act(async()=>root.unmount());host.remove();}
});
it("conciliacion se carga bajo demanda y exige revision manual; no afecta la importacion",async()=>{
 (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement("div"),root=createRoot(host);document.body.append(host);
 const mock=vi.fn().mockResolvedValue(new Response(JSON.stringify({estado:"SIN_CONCILIAR",vinculo:null,items:[{id:9,codigo:"LAB-FONDO",monto:"250",fecha:"2026-09-30",persona:"Otra persona",placa:"C001LAB"}]}),{headers:{"Content-Type":"application/json"}}));vi.stubGlobal("fetch",mock);
 try{await act(async()=>root.render(createElement(FondosConsumoCB2,{api:"/lab",r:{id:1,proveedor_id:2,monto:"200",fecha_consumo:"2026-10-01",piloto_informado:"Mensajero",moneda:"GTQ"},canWrite:true,locked:false})));
 expect(mock).not.toHaveBeenCalled();expect(host.textContent).toContain("ya está registrado");
 await act(async()=>host.querySelector('button')!.click());expect(mock).toHaveBeenCalledTimes(1);
 await act(async()=>{const s=host.querySelector('select')!;s.value="9";s.dispatchEvent(new Event("change",{bubbles:true}));});
 expect(host.textContent).toContain("MONTO, FECHA, PERSONA");expect(host.textContent).toContain("-50");
 expect(host.querySelectorAll('button')[1].disabled).toBe(true);
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
