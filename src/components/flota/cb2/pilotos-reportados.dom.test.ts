// @vitest-environment happy-dom
import { act,createElement } from "react";
import { createRoot } from "react-dom/client";
import { it,expect,vi } from "vitest";
import { AsignacionCB2 } from "./asignacion";
import { RevisionNombresCB2 } from "./revision-nombres";
import { ReportePilotosCB2 } from "./pilotos-reporte";
import type { FilaCB2 } from "./client";
it("Shell no exige elegir Tercerizado ni permite alta contractual automatica; conserva nombre",async()=>{
 (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement("div"),root=createRoot(host);document.body.append(host);const cambiar=vi.fn();
 const fila={perfil:"SHELL",vale:"001",placa:"C001LAB",placaNormalizada:"C001LAB",origen:{piloto:"  Mensajero externo  ",producto:"Diesel"}} as FilaCB2;
 try{await act(async()=>root.render(createElement(AsignacionCB2,{fila,cat:{proveedores:[],vehiculos:[],tercerosDirectos:true,identidadesIndependientes:true},value:{pilotoTipo:"REPORTADO"},onChange:cambiar,disabled:false})));
 expect(host.textContent).toContain("  Mensajero externo  ");expect([...host.querySelectorAll('label')].some(l=>l.textContent?.startsWith("Tipo de piloto"))).toBe(false);expect(host.textContent).not.toContain("Registrar piloto");
 expect(host.textContent).toContain("panel común");expect(cambiar).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());host.remove();}
});
it("reporte muestra totales separados, origen, advertencia y exportacion de filtros aplicados",async()=>{
 (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({instalado:true,advertencia:"Homónimos sin identidad definitiva",items:[{id:1,fecha:"2026-10-01",numero_vale:"001",piloto_informado:"Reportado",piloto_reportado_id:3,galones:"1.234567",monto:"100",moneda:"GTQ",producto:"Diesel",proveedor_id:2,empresa_id:1,vehiculo_id:651,placa_original:"C092BXF"}],totales:[{moneda:"GTQ",producto_clasificado:"DIESEL",consumos:1,galones:"1.234567",importe:"100"}],siguiente:null}),{headers:{"Content-Type":"application/json"}})));
 try{await act(async()=>root.render(createElement(ReportePilotosCB2,{api:"/lab"})));await act(async()=>host.querySelector('button')!.click());expect(host.textContent).toContain("Homónimos");expect(host.textContent).toContain("1.234567");expect(host.querySelector('a')!.href).toContain("exportar=csv");expect(host.textContent).toContain("Reportado");}finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});

it("revisión única por nombre: candidatos requieren confirmar, alta pide consentimiento explícito",async()=>{
 (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);const onChange=vi.fn();
 try{await act(async()=>root.render(createElement(RevisionNombresCB2,{nombres:[{clave:"LUIS ESCOBR",originales:["Luis Escobr"],filas:12,candidatos:[{id:1,nombre:"Luis Escobar"}],propuesta:null},{clave:"VISITANTE",originales:["Visitante"],filas:8,candidatos:[],propuesta:null}],decisiones:{},onChange,disabled:false,instalado:true})));
 expect(host.querySelectorAll('section')).toHaveLength(2);expect(host.textContent).toContain("12 filas");expect(onChange).not.toHaveBeenCalled();expect(host.textContent).toContain("Este piloto no está registrado como empleado. ¿Deseas guardarlo como piloto reportado?");
 const select=host.querySelector('select')!;await act(async()=>{select.value="1";select.dispatchEvent(new Event('change',{bubbles:true}));});await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==="Confirmar empleado para todas estas filas")!.click());expect(onChange).toHaveBeenCalledWith("LUIS ESCOBR",{tipo:"EMPLEADO",empleadoId:1,confirmado:true});
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==="Sí, guardar como piloto reportado")!.click());expect(onChange).toHaveBeenCalledWith("VISITANTE",{tipo:"REPORTADO",confirmado:true});
 }finally{await act(async()=>root.unmount());host.remove();}
});
