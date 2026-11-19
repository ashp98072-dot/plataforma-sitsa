// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanecasClient } from "./canecas-client";

describe("recepciones de Canecas", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it.each([
    ["productos", "catalogo"], ["ubicaciones", "catalogo"], ["compras", "compras"], ["recepciones", "recepciones"],
  ])("muestra el formulario de %s solo con permiso %s", async (vista, permiso) => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({datos:[]})));
    const host=document.createElement("div"), root=createRoot(host); document.body.append(host);
    try {
      await act(async () => { root.render(createElement(CanecasClient,{slug:"demo",vista,permisos:{}})); await new Promise(r=>setTimeout(r,20)); });
      expect(host.textContent).not.toContain("Nuevo registro");
      await act(async () => { root.render(createElement(CanecasClient,{slug:"demo",vista,permisos:{[permiso]:true}})); });
      expect(host.textContent).toContain("Nuevo registro");
    } finally { await act(async()=>root.unmount()); host.remove(); }
  });
  it.each([["productos","catalogo","Desactivar"],["ubicaciones","catalogo","Desactivar"],["compras","catalogo","Registrar proveedor comercial"],["recepciones","confirmar","Confirmar recepción física"]])("controla la acción %s con %s", async (vista, permiso, etiqueta) => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch",vi.fn(async (input:string|URL|Request)=>Response.json({datos:String(input).endsWith(`/${vista}`)?[{id:1,activo:1,estado:"BORRADOR"}]:[]})));
    const host=document.createElement("div"), root=createRoot(host);document.body.append(host);
    try {
      await act(async()=>{root.render(createElement(CanecasClient,{slug:"demo",vista,permisos:{}}));});
      await act(async()=>{await new Promise(r=>setTimeout(r,30));});
      expect(host.textContent).not.toContain(etiqueta);
      await act(async()=>{root.render(createElement(CanecasClient,{slug:"demo",vista,permisos:{[permiso]:true}}));});
      expect(host.textContent).toContain(etiqueta);
    } finally {await act(async()=>root.unmount());host.remove();}
  });
  it("registra una compra completa, bloquea doble envío y muestra errores", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    let resolver!: (r:Response)=>void;
    const pending = new Promise<Response>(resolve => { resolver=resolve; });
    const fetchMock=vi.fn(async (input:string|URL|Request, init?:RequestInit) => {
      if(init?.method === "POST") return pending;
      const resource=String(input).split("/").pop();
      return Response.json({datos:resource === "proveedores" ? [{id:1,nombre_comercial:"Proveedor",activo:1}] : resource === "productos" ? [{id:2,nombre:"Aceite",activo:1}] : []});
    });
    vi.stubGlobal("fetch",fetchMock);
    const host=document.createElement("div"), root=createRoot(host); document.body.append(host);
    try {
      await act(async()=>{root.render(createElement(CanecasClient,{slug:"demo",vista:"compras",permisos:{compras:true}})); await new Promise(r=>setTimeout(r,30));});
      await act(async()=>{Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Nuevo registro")!.click();});
      const form=host.querySelector("form")!;
      (form.elements.namedItem("proveedor_id") as HTMLSelectElement).value="1";
      (form.elements.namedItem("producto_id") as HTMLSelectElement).value="2";
      (form.elements.namedItem("referencia") as HTMLInputElement).value="DEMO-1";
      (form.elements.namedItem("cantidad") as HTMLInputElement).value="2";
      await act(async()=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})); form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
      const posts=fetchMock.mock.calls.filter(([,init])=>init?.method==="POST");
      expect(posts).toHaveLength(1);
      expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({proveedor_id:"1",producto_id:"2",referencia:"DEMO-1",cantidad:"2"});
      await act(async()=>{resolver(Response.json({error:"Error sintético"},{status:400})); await pending;});
      expect(host.textContent).toContain("Error sintético");
    } finally { await act(async()=>root.unmount()); host.remove(); }
  });
  it.each([["productos","catalogo"],["ubicaciones","catalogo"],["recepciones","recepciones"]])("envía el formulario completo de %s", async (vista, permiso) => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock=vi.fn(async (_input:string|URL|Request, init?:RequestInit) => init?.method === "POST" ? Response.json({}) : Response.json({datos:[{id:1,nombre:"Dato sintético",referencia:"DEMO",activo:1}]}));
    vi.stubGlobal("fetch",fetchMock);
    const host=document.createElement("div"), root=createRoot(host);document.body.append(host);
    try {
      await act(async()=>{root.render(createElement(CanecasClient,{slug:"demo",vista,permisos:{[permiso]:true}}));});
      await act(async()=>{await new Promise(r=>setTimeout(r,30));});
      await act(async()=>{Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Nuevo registro")!.click();});
      const form=host.querySelector("form")!;
      for(const input of form.querySelectorAll("input")) input.value=input.name === "capacidad" ? "0.001" : input.type === "number" ? "2" : "Dato sintético";
      for(const select of form.querySelectorAll("select")) select.value="1";
      expect(form.checkValidity()).toBe(true);
      await act(async()=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,20));});
      expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
      expect(host.textContent).toContain("Operación registrada correctamente");
    } finally {await act(async()=>root.unmount());host.remove();}
  });
  it("muestra carga y elimina el error anterior al cambiar de vista", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    let resolveReload!: (r:Response)=>void;
    const reload = new Promise<Response>(resolve=>{resolveReload=resolve;});
    vi.stubGlobal("fetch",vi.fn(async (input:string|URL|Request) => String(input).endsWith("/productos") ? Response.json({error:"Error de prueba"},{status:500}) : reload));
    const host=document.createElement("div"), root=createRoot(host); document.body.append(host);
    try {
      await act(async()=>{root.render(createElement(CanecasClient,{slug:"demo",vista:"productos",permisos:{}}));});
      await act(async()=>{await new Promise(r=>setTimeout(r,30));});
      expect(host.textContent).toContain("Error de prueba");
      await act(async()=>{root.render(createElement(CanecasClient,{slug:"demo",vista:"ubicaciones",permisos:{}}));});
      await act(async()=>{await new Promise(r=>setTimeout(r,30));});
      expect(host.textContent).not.toContain("Error de prueba");
      expect(host.textContent).toContain("Cargando registros");
      await act(async()=>{resolveReload(Response.json({datos:[]})); await reload;});
      expect(host.textContent).toContain("No hay registros para mostrar");
    } finally { await act(async()=>root.unmount()); host.remove(); }
  });
  it("oculta las acciones cuando no existe permiso", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => Response.json({datos: String(input).endsWith("/recepciones") ? [{id:1,estado:"BORRADOR"}] : []})));
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => { root.render(createElement(CanecasClient,{slug:"demo",vista:"recepciones",permisos:{}})); });
      await act(async () => { await new Promise(r => setTimeout(r,20)); });
      expect(host.textContent).not.toContain("Confirmar recepción física");
      expect(host.textContent).not.toContain("Nuevo registro");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("muestra la recepción, confirma y recarga el historial", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    let confirmado = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/confirmar")) { confirmado = true; return Response.json({yaConfirmada:false}); }
      if (url.endsWith("/recepciones")) return Response.json({datos:[{id:1,referencia:"FAC-1",producto:"Aceite",ubicacion:"Bodega",cantidad:20,recibido_por:"Ana",estado:confirmado ? "CONFIRMADA" : "BORRADOR",confirmado_usuario:confirmado ? "operador" : null}]});
      return Response.json({datos:[]});
    });
    vi.stubGlobal("fetch",fetchMock);
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => { root.render(createElement(CanecasClient,{slug:"demo",vista:"recepciones",permisos:{catalogo:true,compras:true,recepciones:true,confirmar:true}})); });
      await act(async () => { await new Promise(r => setTimeout(r,20)); });
      expect(host.textContent).toContain("FAC-1");
      const button = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Confirmar recepción física");
      expect(button).toBeDefined();
      await act(async () => { button!.click(); button!.click(); await new Promise(r => setTimeout(r,20)); });
      expect(host.textContent).toContain("CONFIRMADA");
      expect(host.textContent).toContain("operador");
      expect(fetchMock.mock.calls.filter(([url,init]) => String(url).endsWith("/confirmar") && init?.method === "POST")).toHaveLength(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
