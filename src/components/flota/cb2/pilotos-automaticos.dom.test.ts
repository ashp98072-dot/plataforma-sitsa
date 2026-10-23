// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImportarCB2 } from "./importar";
import type { CatalogosCB2 } from "./client";
it("autopropone nombres abreviados, conserva cambios manuales y registra el método al confirmar",async()=>{
    (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
    const original="  Álvaro, Pinto. ";
    const filas=Array.from({length:26},(_,i)=>({hoja:"AGOSTO",fila:i+2,candidato:i.toString(16).padStart(64,"0"),bloqueada:false,documento:null,errores:[],estado:"ADVERTENCIA",motivos:["Serie/factura incompleta"],vale:String(i+1).padStart(4,"0"),placa:"633 CBL",placaNormalizada:"633 CBL",fecha:"2026-08-01",galones:"10",precio:"20",monto:"200",moneda:"GTQ",origen:{producto:"DIESEL",piloto:original}}));
    const empleados=[{id:77,nombre:"Alvaro Antonio León Pinto"},{id:88,nombre:"Marta López"}];
    const base:CatalogosCB2={proveedores:[{id:1,nombre:"Demo"}],vehiculos:[{id:1,placa:"C-633CBL"}],empleados:[]};
    const requests:{url:string;body:FormData}[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{requests.push({url,body:init.body as FormData});return new Response(JSON.stringify(url.endsWith("preview")?{sha256:"b".repeat(64),token:"sintetico",nota:"",filas}:{eventos:[]}),{headers:{"Content-Type":"application/json"}});}));
    const run=vi.fn(async(_accion,_id,fn)=>fn("clave-sintetica-pilotos"));
    const render=async(cat:CatalogosCB2)=>act(async()=>root.render(createElement(ImportarCB2,{api:"/demo",cat,run,locked:false})));
    const control=(text:string)=>{const l=[...host.querySelectorAll("label")].find(l=>l.textContent?.startsWith(text))!;return (l.querySelector("input,select")??document.getElementById(l.htmlFor)) as HTMLInputElement;};
    const change=async(text:string,value:string)=>{const el=control(text);await act(async()=>{const proto=el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value")!.set!.call(el,value);el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));});};
    const click=async(text:string)=>act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent===text)!.click());
    const aceptar=async()=>act(async()=>control("Confirmo el procesamiento parcial").click());
    try{
        await render(base);await change("Proveedor de la empresa","1");await act(async()=>{const el=control("Excel original");Object.defineProperty(el,"files",{value:[new File(["sintetico"],"demo.xlsx")]});el.dispatchEvent(new Event("change",{bubbles:true}));});await click("Analizar Excel");await aceptar();
        await render({...base,empleados});expect(control("Confirmo el procesamiento parcial").checked).toBe(false);expect(control("Empleado para vale 0001").value).toBe("77");expect(host.textContent).toContain("Autopropuesta única por tokens completos");expect(host.textContent).toContain(original);
        await change("Empleado para vale 0001","88");await change("Empleado para vale 0002","");await click("Siguiente");await click("Anterior");await render({...base,empleados:[...empleados]});expect(control("Empleado para vale 0001").value).toBe("88");expect(control("Empleado para vale 0002").value).toBe("");
        await aceptar();await render({...base,empleados:[...empleados,{id:79,nombre:"Alvaro Pinto"}]});expect(control("Confirmo el procesamiento parcial").checked).toBe(false);expect(control("Empleado para vale 0003").value).toBe("");expect(control("Empleado para vale 0001").value).toBe("88");
        await render({...base,empleados:[...empleados]});await change("Vale","0001");expect(control("Empleado para vale 0001").value).toBe("88");if(!control("Confirmo el procesamiento parcial").checked)await aceptar();expect(requests).toHaveLength(1);await click("Confirmar selección parcial");
        expect(requests.map(r=>r.url)).toEqual(["/demo/preview","/demo/preview","/demo/confirmar"]);
        const choices=JSON.parse(String(requests[2].body.get("seleccion")));expect(choices).toHaveLength(26);expect(choices[0]).toMatchObject({empleadoId:88,metodoEmpleado:"MANUAL"});expect(choices[1]).toMatchObject({empleadoId:null,metodoEmpleado:"SIN_ASIGNACION"});expect(choices[2]).toMatchObject({empleadoId:77,metodoEmpleado:"TOKENS_COMPLETOS_UNICOS"});expect(filas.every(f=>f.origen.piloto===original)).toBe(true);
    }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
