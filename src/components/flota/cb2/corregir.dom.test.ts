// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CorregirCB2 } from "./corregir";
it("la corrección exige motivo y confirmación, conserva el ID y no muta evidencia",async()=>{
    (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
    const r={id:10,proveedor_id:3,vehiculo_id:1,revision_asignacion:4,placa_original:"633 CBL",piloto_informado:"HECTOR SET",producto:null};
    const run=vi.fn().mockResolvedValue({}),cat={proveedores:[{id:3,nombre:"Demo"}],vehiculos:[{id:1,placa:"C-633CBL"},{id:2,placa:"C-570BZT"}],empleados:[{id:77,nombre:"Héctor René Set"}]};
    const control=(text:string)=>{const l=[...host.querySelectorAll("label")].find(l=>l.textContent?.startsWith(text))!;return (l.querySelector("input,select,textarea")??document.getElementById(l.htmlFor)) as HTMLInputElement;};
    const change=async(text:string,value:string)=>{const el=control(text);await act(async()=>{const proto=el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(proto,"value")!.set!.call(el,value);el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));});};
    try{await act(async()=>root.render(createElement(CorregirCB2,{r,cat,api:"/demo",run,locked:false})));const guardar=host.querySelector("button")!;expect(guardar.disabled).toBe(true);await change("Unidad corregida","2");await change("Empleado corregido","77");await change("Combustible corregido","NO_DETERMINADO");await change("Justificacion de correccion","Verificado contra vale original");expect(run).not.toHaveBeenCalled();await act(async()=>control("Confirmo esta corrección").click());await change("Combustible corregido","DIESEL");expect(control("Confirmo esta corrección").checked).toBe(false);await act(async()=>control("Confirmo esta corrección").click());await act(async()=>guardar.click());expect(run).toHaveBeenCalledExactlyOnceWith("corregir",{proveedorId:3,consumoId:10,revision:4,vehiculoId:2,empleadoId:77,productoClasificado:"DIESEL",motivo:"Verificado contra vale original"},expect.any(Function));expect(r).toMatchObject({placa_original:"633 CBL",piloto_informado:"HECTOR SET",producto:null,vehiculo_id:1});}
    finally{await act(async()=>root.unmount());host.remove();}
});
