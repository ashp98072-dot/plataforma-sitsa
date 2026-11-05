// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CxpIntegridad } from "@/components/contabilidad/cxp-integridad";
import { datosExportacion } from "./__tests__/integridad-export-fixture";

const MIME="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const originalCreate=Object.getOwnPropertyDescriptor(URL,"createObjectURL"), originalRevoke=Object.getOwnPropertyDescriptor(URL,"revokeObjectURL");
const create=vi.fn(),revoke=vi.fn();
let root:Root|undefined, node:HTMLDivElement;
let downloads:string[];
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);downloads=[];create.mockReset().mockReturnValue("blob:qa");revoke.mockReset();
  Object.defineProperty(URL,"createObjectURL",{configurable:true,value:create});Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:revoke});
  vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(this:HTMLAnchorElement){downloads.push(this.download);});
  node=document.createElement("div");document.body.append(node);root=createRoot(node);
});
afterEach(async()=>{
  if(root)await act(async()=>root!.unmount());root=undefined;document.body.innerHTML="";vi.restoreAllMocks();vi.unstubAllGlobals();
  if(originalCreate)Object.defineProperty(URL,"createObjectURL",originalCreate);else Reflect.deleteProperty(URL,"createObjectURL");
  if(originalRevoke)Object.defineProperty(URL,"revokeObjectURL",originalRevoke);else Reflect.deleteProperty(URL,"revokeObjectURL");
});
const boton=()=>[...node.querySelectorAll("button")].find(b=>/Exportar Excel|Exportando/.test(b.textContent??""))!;
const archivo=()=>new Response("xlsx-sintético",{headers:{"Content-Type":MIME}});
const pantalla=()=>Response.json(datosExportacion({totalAdvertencias:30}));
const render=async(entidadId="5")=>{await act(async()=>root!.render(createElement(CxpIntegridad,{slug:"qa",entidadId,onConsultarProveedor:()=>undefined})));};
const cambiarEstado=async()=>{await act(async()=>{const select=node.querySelectorAll("select")[1];select.value="ANULADA";select.dispatchEvent(new Event("change",{bubbles:true}));});};
const aplicar=async()=>{await act(async()=>node.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));};

it("bloquea descargas duplicadas síncronas, usa filtros aplicados y conserva la lista",async()=>{
  let resolver:((r:Response)=>void)|undefined;
  const fetchMock=vi.fn(async(url:string)=>url.includes("/export?")?new Promise<Response>(resolve=>{resolver=resolve;}):pantalla());
  vi.stubGlobal("fetch",fetchMock);await render();await cambiarEstado();
  await act(async()=>{boton().click();boton().click();});
  const calls=fetchMock.mock.calls.filter(([url])=>url.includes("/export?"));expect(calls).toHaveLength(1);
  const params=new URL(calls[0][0],"http://qa").searchParams;expect(params.get("entidad")).toBe("5");expect(params.has("estado")).toBe(false);expect(params.has("page")).toBe(false);expect(params.has("pageSize")).toBe(false);
  expect(boton().disabled).toBe(true);expect(node.querySelectorAll("tbody tr")).toHaveLength(1);
  await act(async()=>resolver!(archivo()));
  expect(downloads).toEqual(["cxp-integridad-entidad-5.xlsx"]);expect(revoke).toHaveBeenCalledWith("blob:qa");expect(boton().disabled).toBe(false);expect(node.querySelectorAll("tbody tr")).toHaveLength(1);
});
it("exporta estado aplicado desde cualquier página sin enviar paginación",async()=>{
  const fetchMock=vi.fn(async(url:string)=>url.includes("/export?")?archivo():pantalla());vi.stubGlobal("fetch",fetchMock);
  await render();await cambiarEstado();await aplicar();
  await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent==="Siguiente")!.click());
  await act(async()=>boton().click());
  const req=fetchMock.mock.calls.find(([url])=>url.includes("/export?"))![0];const p=new URL(req,"http://qa").searchParams;
  expect(p.get("estado")).toBe("ANULADA");expect(p.has("page")).toBe(false);expect(p.has("pageSize")).toBe(false);expect(downloads).toHaveLength(1);
});
it("cambio de filtros durante lectura del blob cancela y descarta el archivo antiguo",async()=>{
  let blob:((r:Blob)=>void)|undefined;let signal:AbortSignal|null|undefined;
  vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
    if(!url.includes("/export?"))return pantalla();signal=init?.signal;
    return {ok:true,headers:new Headers({"Content-Type":MIME}),blob:()=>new Promise<Blob>(resolve=>{blob=resolve;})} as Response;
  }));
  await render();await act(async()=>boton().click());await cambiarEstado();await aplicar();
  expect(signal?.aborted).toBe(true);await act(async()=>blob!(new Blob(["archivo viejo"])));
  expect(create).not.toHaveBeenCalled();expect(downloads).toEqual([]);expect(boton().disabled).toBe(false);expect(node.querySelectorAll("tbody tr")).toHaveLength(1);
});
it("cambio de entidad descarta una respuesta tardía de exportación",async()=>{
  let resolver:((r:Response)=>void)|undefined;
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.includes("/export?")?new Promise<Response>(resolve=>{resolver=resolve;}):pantalla()));
  await render();await act(async()=>boton().click());await render("6");await act(async()=>resolver!(archivo()));
  expect(downloads).toEqual([]);expect(create).not.toHaveBeenCalled();expect(node.textContent).toContain("Entidad #6");
});
it("paginación durante exportación no cambia sus filtros ni cancela el conjunto completo",async()=>{
  let resolver:((r:Response)=>void)|undefined;let signal:AbortSignal|null|undefined;
  vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
    if(!url.includes("/export?"))return pantalla();signal=init?.signal;return new Promise<Response>(resolve=>{resolver=resolve;});
  }));
  await render();await act(async()=>boton().click());await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent==="Siguiente")!.click());
  expect(signal?.aborted).toBe(false);await act(async()=>resolver!(archivo()));expect(downloads).toHaveLength(1);
});
it("errores controlados y MIME incorrecto no descargan ni cambian filas visibles",async()=>{
  let intento=0;
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.includes("/export?")?(++intento===1?Response.json({error:"Reduce los filtros"},{status:422}):Response.json({error:"No es Excel"})):pantalla()));
  await render();await act(async()=>boton().click());expect(node.querySelector('[role="alert"]')?.textContent).toBe("Reduce los filtros");
  expect(boton().disabled).toBe(false);await act(async()=>boton().click());expect(node.querySelector('[role="alert"]')?.textContent).toBe("Archivo de exportación inválido.");
  expect(downloads).toEqual([]);expect(node.querySelectorAll("tbody tr")).toHaveLength(1);
});
