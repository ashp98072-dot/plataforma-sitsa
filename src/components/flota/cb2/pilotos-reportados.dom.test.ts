// @vitest-environment happy-dom
import { act,createElement } from "react";
import { createRoot } from "react-dom/client";
import { it,expect,vi } from "vitest";
import { AsignacionCB2 } from "./asignacion";
import { PilotoShellVale } from "./revision-nombres";
import { ReportePilotosCB2 } from "./pilotos-reporte";
import type { FilaCB2 } from "./client";
it("Shell permite vincular terceros opcionalmente sin convertir el nombre reportado en alta automatica",async()=>{
 (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement("div"),root=createRoot(host);document.body.append(host);const cambiar=vi.fn();
 const fila={perfil:"SHELL",vale:"001",placa:"C001LAB",placaNormalizada:"C001LAB",origen:{piloto:"  Mensajero externo  ",producto:"Diesel"}} as FilaCB2;
 try{await act(async()=>root.render(createElement(AsignacionCB2,{fila,cat:{proveedores:[],vehiculos:[],tercerosDirectos:true,identidadesIndependientes:true},value:{pilotoTipo:"REPORTADO"},onChange:cambiar,disabled:false})));
 expect(host.textContent).toContain("  Mensajero externo  ");expect([...host.querySelectorAll('label')].find(l=>l.textContent?.startsWith("Tipo de piloto"))?.querySelector("select")?.value).toBe("REPORTADO");expect(host.textContent).not.toContain("Registrar piloto");
 expect(host.textContent).toContain("Piloto del Excel");expect(cambiar).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());host.remove();}
});
it("reporte muestra totales separados, origen, advertencia y exportacion de filtros aplicados",async()=>{
 (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({instalado:true,advertencia:"Homónimos sin identidad definitiva",items:[{id:1,fecha:"2026-10-01",numero_vale:"001",piloto_informado:"Reportado",piloto_reportado_id:3,galones:"1.234567",monto:"100",moneda:"GTQ",producto:"Diesel",proveedor_id:2,empresa_id:1,vehiculo_id:651,placa_original:"C092BXF"}],totales:[{moneda:"GTQ",producto_clasificado:"DIESEL",consumos:1,galones:"1.234567",importe:"100"}],siguiente:null}),{headers:{"Content-Type":"application/json"}})));
 try{await act(async()=>root.render(createElement(ReportePilotosCB2,{api:"/lab"})));await act(async()=>host.querySelector('button')!.click());expect(host.textContent).toContain("Homónimos");expect(host.textContent).toContain("1.234567");expect(host.querySelector('a')!.href).toContain("exportar=csv");expect(host.textContent).toContain("Reportado");}finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});

it("resolución desde el vale: candidatos requieren elegir, el nombre original se conserva, sin coincidencias se confirma expresamente como piloto reportado",async()=>{
 (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);const onElegir=vi.fn();
 const montar=async(original:string,nombre:Parameters<typeof PilotoShellVale>[0]["nombre"],decision?:Parameters<typeof PilotoShellVale>[0]["decision"])=>act(async()=>root.render(createElement(PilotoShellVale,{original,nombre,decision,empleados:[{id:1,nombre:"Luis Escobar",estado:"Activo"}],instalado:true,onElegir})));
 try{await montar("  Luis Escobr ",{clave:"LUIS ESCOBR",originales:["  Luis Escobr "],filas:12,candidatos:[{id:1,nombre:"Luis Escobar"}],elegibles:[],propuesta:null});
 expect(host.textContent).toContain("  Luis Escobr ");expect(host.textContent).toContain("12 filas");expect(host.textContent).toContain("Pendiente");expect(onElegir).not.toHaveBeenCalled();
 const select=host.querySelector('select')!;await act(async()=>{select.value="1";select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(onElegir).toHaveBeenCalledWith({tipo:"EMPLEADO",empleadoId:1,confirmado:true});
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes("Ninguno corresponde"))!.click());expect(onElegir).toHaveBeenLastCalledWith({tipo:"REPORTADO",confirmado:true});
 onElegir.mockClear();
 await montar("Visitante",{clave:"VISITANTE",originales:["Visitante"],filas:8,candidatos:[],elegibles:[],propuesta:null});
 expect(host.textContent).toContain("Ningún empleado coincide");
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==="Guardar el nombre original como piloto reportado")!.click());expect(onElegir).toHaveBeenCalledWith({tipo:"REPORTADO",confirmado:true});
 // piloto reportado ya confirmado: no se vuelve a pedir
 await montar("Visitante",{clave:"VISITANTE",originales:["Visitante"],filas:8,candidatos:[],elegibles:[],propuesta:null},{tipo:"REPORTADO",reportadoId:5,confirmado:true});
 expect(host.textContent).toContain("Piloto reportado #5");expect([...host.querySelectorAll('button')].find(b=>b.textContent?.includes("piloto reportado"))!.disabled).toBe(true);
 }finally{await act(async()=>root.unmount());host.remove();}
});
