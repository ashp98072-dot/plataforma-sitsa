// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImportarCB2 } from "./importar";
import type { CatalogosCB2 } from "./client";
it("clasifica HALEL desconocido y V-Power, vincula empleado explícito y conserva decisiones entre páginas",async()=>{
    (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
    const cat:CatalogosCB2={proveedores:[{id:1,nombre:"Demo"}],vehiculos:[{id:1,placa:"C-633CBL"},{id:2,placa:"C-570BZT"}],empleados:[{id:77,nombre:"José Antonio Chay"},{id:78,nombre:"Héctor René Set"},{id:79,nombre:"Héctor Manuel Set"}]};
    const filas=Array.from({length:26},(_,i)=>({hoja:"LOTE",fila:i+2,lote:"2054",candidato:i.toString(16).padStart(64,"0"),bloqueada:false,documento:null,errores:[],estado:"ADVERTENCIA",motivos:["Serie/factura incompleta"],vale:String(i+1).padStart(4,"0"),placa:"633 CBL",placaNormalizada:"633 CBL",fecha:"2026-10-01",galones:"10",precio:"20",monto:"200",moneda:"GTQ",origen:{producto:i===0?"":i===1?"V-POWER":"Diesel",piloto:i===0?" HECTOR SET ":"JOSE ANTONIO CHAY"}}));
    const requests:FormData[]=[];vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{requests.push(init.body as FormData);return new Response(JSON.stringify(url.endsWith("preview")?{perfilDetectado: "HALEL", sha256:"b".repeat(64),token:"sintetico",nota:"",filas}:{eventos:[]}),{headers:{"Content-Type":"application/json"}});}));
    const run=vi.fn(async(_accion,_id,fn)=>fn("clave-sintetica-514"));
    const render=async()=>act(async()=>root.render(createElement(ImportarCB2,{api:"/demo",cat:{...cat,vehiculos:[...cat.vehiculos]},run,locked:false})));
    const control=(text:string)=>{const l=[...host.querySelectorAll("label")].find(l=>l.textContent?.startsWith(text))!;return (l.querySelector("input,select,textarea")??document.getElementById(l.htmlFor)) as HTMLInputElement;};
    const change=async(label:string,value:string)=>{const el=control(label);await act(async()=>{const proto=el.tagName==="SELECT"?HTMLSelectElement.prototype:el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value")!.set!.call(el,value);el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));});};
    const click=async(text:string)=>act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent===text)!.click());
    try{
        await render();await change("Proveedor de la empresa","1");await act(async()=>{const el=control("Excel original");Object.defineProperty(el,"files",{value:[new File(["sintetico"],"demo.xlsx")]});el.dispatchEvent(new Event("change",{bubbles:true}));});await click("Analizar Excel");
        expect(host.textContent).toContain("24 consumos seleccionados para confirmar");expect(control("Empleado para vale 0001").value).toBe("");expect(control("Empleado para vale 0002").value).toBe("77");expect(host.textContent).toContain("AMBIGUA");
        await change("Empleado para vale 0001","78");await change("Combustible para vale 0001","NO_DETERMINADO");await change("Combustible para vale 0002","VPOWER_NO_DETERMINADO");expect(host.textContent).toContain("26 consumos seleccionados para confirmar");
        await change("Unidad para vale 0001","2");expect(host.textContent).toContain("25 consumos seleccionados para confirmar");await change("Justificación de unidad manual","Verificado contra evidencia por Operaciones");expect(host.textContent).toContain("26 consumos seleccionados para confirmar");
        await click("Siguiente");await click("Anterior");await render();expect(control("Empleado para vale 0001").value).toBe("78");expect(control("Combustible para vale 0001").value).toBe("NO_DETERMINADO");expect(control("Unidad para vale 0001").value).toBe("2");
        await change("Vale","0001");await act(async()=>control("Confirmo el procesamiento parcial").click());await change("Empleado para vale 0001","79");expect(control("Confirmo el procesamiento parcial").checked).toBe(false);expect(requests).toHaveLength(1);
        await act(async()=>control("Confirmo el procesamiento parcial").click());await click("Confirmar selección parcial");
        const seleccion=JSON.parse(String(requests[2].get("seleccion")));expect(seleccion).toHaveLength(26);expect(seleccion[0]).toMatchObject({vehiculoId:2,empleadoId:79,productoClasificado:"NO_DETERMINADO",motivoUnidad:"Verificado contra evidencia por Operaciones"});expect(seleccion[1].productoClasificado).toBe("VPOWER_NO_DETERMINADO");expect(filas[0].origen).toEqual({producto:"",piloto:" HECTOR SET "});
    }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
