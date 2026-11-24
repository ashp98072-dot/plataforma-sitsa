// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanecasClient } from "./canecas-client";

describe("recepciones de Canecas", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("muestra controles de costo solo con los permisos correspondientes", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({datos:[]})));
    const host=document.createElement("div"), root=createRoot(host); document.body.append(host);
    try {
      await act(async () => { root.render(createElement(CanecasClient,{slug:"demo",vista:"inventario",permisos:{}})); await new Promise(r=>setTimeout(r,20)); });
      expect(host.textContent).not.toContain("Conciliar existencia inicial");
      expect(host.textContent).not.toContain("Costo conocido en Q");
      await act(async () => { root.render(createElement(CanecasClient,{slug:"demo",vista:"inventario",permisos:{confirmar:true,compras:true}})); await new Promise(r=>setTimeout(r,20)); });
      expect(host.textContent).toContain("Conciliar existencia inicial");
      expect(host.textContent).toContain("Costo conocido en Q");
      expect(host.querySelector('input[name="costo"]')).not.toBeNull();
    } finally { await act(async()=>root.unmount()); host.remove(); }
  });
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
      if (vista === "productos") {
        const unidad = form.elements.namedItem("unidad_inventario") as HTMLInputElement;
        expect(unidad.value).toBe("caneca");
        expect(unidad.readOnly).toBe(true);
      }
      for(const input of form.querySelectorAll("input")) input.value=input.name === "capacidad" ? "0.001" : input.name === "precio_venta_referencia" ? "2.00" : input.name === "moneda" ? "GTQ" : input.type === "number" ? "2" : "Dato sintético";
      for(const select of form.querySelectorAll("select")) select.value="1";
      expect(form.checkValidity()).toBe(true);
      await act(async()=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,20));});
      expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
      expect(host.textContent).toContain("Operación registrada correctamente");
    } finally {await act(async()=>root.unmount());host.remove();}
  });
  it("registra un proveedor comercial con datos sintéticos", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock=vi.fn(async (_input:string|URL|Request, init?:RequestInit) => init?.method === "POST" ? Response.json({}) : Response.json({datos:[]}));
    vi.stubGlobal("fetch",fetchMock);
    const host=document.createElement("div"), root=createRoot(host);document.body.append(host);
    try {
      await act(async()=>{root.render(createElement(CanecasClient,{slug:"demo",vista:"compras",permisos:{catalogo:true}}));});
      await act(async()=>{await new Promise(r=>setTimeout(r,30));});
      const form=host.querySelector<HTMLFormElement>("details form")!;
      (form.elements.namedItem("nombre_comercial") as HTMLInputElement).value="Proveedor sintético";
      expect(form.checkValidity()).toBe(true);
      await act(async()=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,20));});
      const post=fetchMock.mock.calls.find(([,init])=>init?.method==="POST");
      expect(String(post?.[0])).toMatch(/\/proveedores$/);
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({nombre_comercial:"Proveedor sintético"});
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
  const montar = async (vista: string, permisos: Record<string, boolean>, datos: Record<string, unknown[]>, respuestas: { patch?: unknown } = {}) => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST" || init?.method === "PATCH") return Response.json(respuestas.patch ?? {});
      const recurso = String(input).split("/canecas/")[1];
      return Response.json({ datos: datos[recurso] ?? [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    await act(async () => { root.render(createElement(CanecasClient, { slug: "demo", vista, permisos })); });
    await act(async () => { await new Promise(r => setTimeout(r, 30)); }); // los efectos se ejecutan al salir del primer act
    return { host, root, fetchMock, limpiar: async () => { await act(async () => root.unmount()); host.remove(); } };
  };
  const cliente = { id: 3, nombre_comercial: "Aceites del Sur", nit: "1234567-8", telefono: "5555-1111", direccion: "Zona 4", estado: "Activo", activo: 1, creado_en: "2026-11-01" };
  it.each(["proveedores", "clientes"])("%s: muestra el catálogo, busca y no ofrece campos de moneda", async vista => {
    const { host, limpiar } = await montar(vista, { catalogo: true }, { [vista]: [cliente, { ...cliente, id: 4, nombre_comercial: "Distribuidora Norte", nit: "9999999-9", estado: "Inactivo", activo: 0 }] });
    try {
      for (const texto of ["Aceites del Sur", "1234567-8", "Distribuidora Norte", "Inactivo", "Dirección"]) expect(host.textContent).toContain(texto);
      const buscador = host.querySelector<HTMLInputElement>('input[placeholder="Buscar en registros"]')!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(buscador, "norte"); buscador.dispatchEvent(new Event("input", { bubbles: true })); });
      expect(host.textContent).toContain("Distribuidora Norte");
      expect(host.textContent).not.toContain("Aceites del Sur");
      await act(async () => { host.querySelector<HTMLButtonElement>("header button")!.click(); });
      expect(host.querySelector('input[name="moneda"]')).toBeNull();
      expect(host.querySelector('select[name="moneda"]')).toBeNull();
      for (const nombre of ["nombre_comercial", "nit", "telefono", "direccion"]) expect(host.querySelector(`input[name="${nombre}"]`)).not.toBeNull();
    } finally { await limpiar(); }
  });
  it.each(["proveedores", "clientes"])("%s: crea un registro con los campos opcionales vacíos", async vista => {
    const { host, fetchMock, limpiar } = await montar(vista, { catalogo: true }, {});
    try {
      await act(async () => { host.querySelector<HTMLButtonElement>("header button")!.click(); });
      const form = host.querySelector<HTMLFormElement>("main form")!;
      (form.elements.namedItem("nombre_comercial") as HTMLInputElement).value = "Nuevo registro de prueba";
      expect(form.checkValidity()).toBe(true);
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 20)); });
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
      expect(String(post[0])).toMatch(new RegExp(`/canecas/${vista}$`));
      expect(JSON.parse(String(post[1]?.body))).toEqual({ nombre_comercial: "Nuevo registro de prueba", nit: "", telefono: "", direccion: "" });
    } finally { await limpiar(); }
  });
  it("edita un registro existente con PATCH y conserva su identificador", async () => {
    const { host, fetchMock, limpiar } = await montar("proveedores", { catalogo: true }, { proveedores: [cliente] });
    try {
      await act(async () => { Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Editar")!.click(); });
      const form = host.querySelector<HTMLFormElement>("main form")!;
      expect((form.elements.namedItem("nombre_comercial") as HTMLInputElement).value).toBe("Aceites del Sur");
      expect((form.elements.namedItem("telefono") as HTMLInputElement).value).toBe("5555-1111");
      (form.elements.namedItem("telefono") as HTMLInputElement).value = "5555-2222";
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 20)); });
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
      expect(JSON.parse(String(patch[1]?.body))).toMatchObject({ id: 3, nombre_comercial: "Aceites del Sur", telefono: "5555-2222" });
      expect(host.textContent).toContain("Registro actualizado.");
    } finally { await limpiar(); }
  });
  it("activa y desactiva clientes solo con permiso de catálogo", async () => {
    const sin = await montar("clientes", {}, { clientes: [cliente] });
    try {
      expect(sin.host.textContent).not.toContain("Desactivar");
      expect(sin.host.textContent).not.toContain("Editar");
      expect(sin.host.textContent).not.toContain("Nuevo registro");
    } finally { await sin.limpiar(); }
    const con = await montar("clientes", { catalogo: true }, { clientes: [cliente] });
    try {
      await act(async () => { Array.from(con.host.querySelectorAll("button")).find(b => b.textContent === "Desactivar")!.click(); await new Promise(r => setTimeout(r, 20)); });
      const patch = con.fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
      expect(JSON.parse(String(patch[1]?.body))).toEqual({ id: 3, activo: false });
    } finally { await con.limpiar(); }
  });
  it("muestra el error del servidor por duplicado sin cerrar el formulario", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => init?.method === "POST" ? Response.json({ error: "Ya existe un cliente de Canecas con ese NIT." }, { status: 409 }) : Response.json({ datos: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    try {
      await act(async () => { root.render(createElement(CanecasClient, { slug: "demo", vista: "clientes", permisos: { catalogo: true } })); });
      await act(async () => { await new Promise(r => setTimeout(r, 30)); });
      await act(async () => { host.querySelector<HTMLButtonElement>("header button")!.click(); });
      const form = host.querySelector<HTMLFormElement>("main form")!;
      (form.elements.namedItem("nombre_comercial") as HTMLInputElement).value = "Duplicado";
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 20)); });
      expect(host.textContent).toContain("Ya existe un cliente de Canecas con ese NIT.");
      expect(host.querySelector("main form")).not.toBeNull();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("las compras no piden moneda ni gastos y muestran importes en Q", async () => {
    const { host, limpiar } = await montar("compras", { compras: true }, { proveedores: [cliente, { ...cliente, id: 9, nombre_comercial: "Proveedor inactivo", activo: 0 }], productos: [{ id: 2, nombre: "Aceite", activo: 1 }] });
    try {
      await act(async () => { host.querySelector<HTMLButtonElement>("header button")!.click(); });
      expect(host.querySelector('input[name="moneda"]')).toBeNull();
      expect(host.querySelector('input[name="gastos_adquisicion"]')).toBeNull();
      expect(host.textContent).toContain("Precio unitario de compra en Q");
      const opciones = Array.from(host.querySelectorAll('select[name="proveedor_id"] option')).map(o => o.textContent);
      expect(opciones).toContain("Aceites del Sur");
      expect(opciones).not.toContain("Proveedor inactivo");
    } finally { await limpiar(); }
  });
});
