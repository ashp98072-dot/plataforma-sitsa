// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanecasClient } from "./canecas-client";

describe("Canecas", () => {
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
    ["productos", "catalogo"], ["ubicaciones", "catalogo"],
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
  it.each([["productos","catalogo","Desactivar"],["ubicaciones","catalogo","Desactivar"],["compras","catalogo","Registrar proveedor comercial"]])("controla la acción %s con %s", async (vista, permiso, etiqueta) => {
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
      return Response.json({datos:resource === "proveedores" ? [{id:1,nombre_comercial:"Proveedor",activo:1}] : resource === "ubicaciones" ? [{id:1,nombre:"Bodega",activo:1}] : resource === "empleados" ? [{id:1,nombre:"Ana"}] : []});
    });
    vi.stubGlobal("fetch",fetchMock);
    const host=document.createElement("div"), root=createRoot(host); document.body.append(host);
    try {
      await act(async()=>{root.render(createElement(CanecasClient,{slug:"demo",vista:"compras",permisos:{compras:true,recepciones:true,confirmar:true}})); await new Promise(r=>setTimeout(r,30));});
      await act(async()=>{Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Nuevo registro")!.click();});
      const form=host.querySelector("form")!;
      expect(form.elements.namedItem("referencia")).toBeNull();
      expect(form.elements.namedItem("producto_id")).toBeNull();
      (form.elements.namedItem("proveedor_id") as HTMLSelectElement).value="1";
      (form.elements.namedItem("ubicacion_id") as HTMLSelectElement).value="1";
      (form.elements.namedItem("recibido_por_empleado_id") as HTMLSelectElement).value="1";
      (form.elements.namedItem("cantidad") as HTMLInputElement).value="2";
      (form.elements.namedItem("precio_compra") as HTMLInputElement).value="10.50";
      await act(async()=>{form.dispatchEvent(new Event("input",{bubbles:true}));});
      expect(host.textContent).toContain("Total: Q 21.00");
      await act(async()=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})); form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
      const posts=fetchMock.mock.calls.filter(([,init])=>init?.method==="POST");
      expect(posts).toHaveLength(1);
      expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({proveedor_id:"1",ubicacion_id:"1",recibido_por_empleado_id:"1",cantidad:"2",precio_compra:"10.50"});
      await act(async()=>{resolver(Response.json({error:"Error sintético"},{status:400})); await pending;});
      expect(host.textContent).toContain("Error sintético");
    } finally { await act(async()=>root.unmount()); host.remove(); }
  });
  it.each([["productos","catalogo"],["ubicaciones","catalogo"]])("envía el formulario completo de %s", async (vista, permiso) => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock=vi.fn(async (_input:string|URL|Request, init?:RequestInit) => init?.method === "POST" ? Response.json({}) : Response.json({datos:[{id:1,nombre:"Dato sintético",referencia:"DEMO",activo:1}]}));
    vi.stubGlobal("fetch",fetchMock);
    const host=document.createElement("div"), root=createRoot(host);document.body.append(host);
    try {
      await act(async()=>{root.render(createElement(CanecasClient,{slug:"demo",vista,permisos:{[permiso]:true}}));});
      await act(async()=>{await new Promise(r=>setTimeout(r,30));});
      await act(async()=>{Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Nuevo registro")!.click();});
      const form=host.querySelector("form")!;
      if (vista === "productos") for (const viejo of ["codigo","marca","presentacion","capacidad","unidad_inventario"]) expect(form.elements.namedItem(viejo)).toBeNull();
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
  it("las compras piden solo proveedor, bodega, receptor, cantidad y precio; exigen los tres permisos", async () => {
    const parcial = await montar("compras", { compras: true, recepciones: true }, {});
    try { expect(parcial.host.textContent).not.toContain("Nuevo registro"); } finally { await parcial.limpiar(); }
    const { host, limpiar } = await montar("compras", { compras: true, recepciones: true, confirmar: true }, { proveedores: [cliente, { ...cliente, id: 9, nombre_comercial: "Proveedor inactivo", activo: 0 }] });
    try {
      await act(async () => { host.querySelector<HTMLButtonElement>("header button")!.click(); });
      expect(host.querySelector('input[name="moneda"]')).toBeNull();
      expect(host.querySelector('input[name="gastos_adquisicion"]')).toBeNull();
      expect(host.textContent).toContain("Precio de compra por caneca en Q");
      const opciones = Array.from(host.querySelectorAll('select[name="proveedor_id"] option')).map(o => o.textContent);
      expect(opciones).toContain("Aceites del Sur");
      expect(opciones).not.toContain("Proveedor inactivo");
    } finally { await limpiar(); }
  });
  it("la clave de la operación es durable: sobrevive a una recarga, se reutiliza con el mismo formulario y se renueva si cambia o si hubo rechazo definitivo", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    const claves: string[] = [];
    let respuesta: () => Response | Promise<Response> = () => { throw new TypeError("sin red"); };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") { claves.push(JSON.parse(String(init.body)).clave_operacion); expect(String(input)).toMatch(/\/compras_ingreso$/); return respuesta(); }
      const recurso = String(input).split("/").pop();
      return Response.json({ datos: recurso === "proveedores" ? [{ id: 1, nombre_comercial: "P", activo: 1 }] : recurso === "ubicaciones" ? [{ id: 1, nombre: "B", activo: 1 }] : recurso === "empleados" ? [{ id: 1, nombre: "Ana" }] : [] });
    }));
    const enviar = async (cantidad: string) => {
      const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
      try {
        await act(async () => { root.render(createElement(CanecasClient, { slug: "demo", vista: "compras", permisos: { compras: true, recepciones: true, confirmar: true } })); await new Promise(r => setTimeout(r, 30)); });
        await act(async () => { Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Nuevo registro")!.click(); });
        const form = host.querySelector("form")!;
        for (const [n, v] of Object.entries({ proveedor_id: "1", ubicacion_id: "1", recibido_por_empleado_id: "1", cantidad, precio_compra: "10.00" })) (form.elements.namedItem(n) as HTMLInputElement).value = v;
        await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 20)); });
      } finally { await act(async () => root.unmount()); host.remove(); }
    };
    await enviar("2"); await enviar("2");          // fallo de red + "recarga": misma clave
    expect(claves[1]).toBe(claves[0]);
    await enviar("3");                              // otros datos: clave nueva
    expect(claves[2]).not.toBe(claves[0]);
    respuesta = () => Response.json({ error: "caído" }, { status: 503 });
    await enviar("3");                              // 5xx: se conserva
    expect(claves[3]).toBe(claves[2]);
    respuesta = () => Response.json({ error: "rechazada" }, { status: 409 });
    await enviar("3");                              // rechazo definitivo: se descarta
    expect(claves[4]).toBe(claves[2]);
    await enviar("3");
    expect(claves[5]).not.toBe(claves[4]);
    respuesta = () => Response.json({ id: 1 }, { status: 201 });
    await enviar("3");                              // éxito: la siguiente operación usa otra clave
    await enviar("3");
    expect(claves[7]).not.toBe(claves[6]);
  });
  describe("POST confirmado y refresco fallido (sin aparente fallo ni duplicados)", () => {
    const montarFlujo = async (vista: "compras" | "ventas", exito: Record<string, unknown>, identidad: { empresaId?: number; usuarioId?: number } = {}) => {
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
      window.localStorage.clear();
      const estado = { posts: [] as { url: string; cuerpo: Record<string, string> }[], getFalla: false };
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") { estado.posts.push({ url: String(input), cuerpo: JSON.parse(String(init.body)) }); return Response.json(exito, { status: 201 }); }
        if (estado.getFalla) throw new TypeError("sin red");
        const recurso = String(input).split("/").pop();
        return Response.json({ datos: recurso === "proveedores" ? [{ id: 1, nombre_comercial: "P", activo: 1 }] : recurso === "clientes" ? [{ id: 1, nombre_comercial: "C", direccion: "Zona 1", activo: 1 }] : recurso === "ubicaciones" ? [{ id: 1, nombre: "B", activo: 1 }] : recurso === "empleados" ? [{ id: 1, nombre: "Ana" }] : [] });
      }));
      const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
      await act(async () => { root.render(createElement(CanecasClient, { slug: "demo", vista, permisos: { compras: true, recepciones: true, confirmar: true, ventas: true, catalogo: true }, ...identidad })); await new Promise(r => setTimeout(r, 30)); });
      const abrir = async () => { await act(async () => { host.querySelector<HTMLButtonElement>("header button")!.click(); }); return host.querySelector<HTMLFormElement>("main > form, form")!; };
      const llenar = (form: HTMLFormElement, valores: Record<string, string>) => { for (const [n, v] of Object.entries(valores)) (form.elements.namedItem(n) as HTMLInputElement).value = v; };
      const enviar = async (form: HTMLFormElement) => { await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 30)); }); };
      return { host, estado, abrir, llenar, enviar, limpiar: async () => { await act(async () => root.unmount()); host.remove(); } };
    };
    it.each([
      ["compras", { id: 7, referencia: "COMP-000007", mensaje: "Compra COMP-000007 registrada e ingresada al inventario (total Q 21.00)." }, { proveedor_id: "1", ubicacion_id: "1", recibido_por_empleado_id: "1", cantidad: "2", precio_compra: "10.50" }, /compras_ingreso$/, "COMP-000007"],
      ["ventas", { id: "9", documento: "VTA-000009", mensaje: "Venta VTA-000009 registrada: ingreso Q 190.00." }, { cliente_id: "1", ubicacion_id: "1", direccion_entrega: "Zona 4", cantidad: "2", precio_unitario: "95.00" }, /ventas_pos$/, "VTA-000009"],
    ] as const)("%s: un POST exitoso seguido de un GET fallido muestra el éxito, avisa de la lista y no permite duplicar", async (vista, exito, valores, destino, correlativo) => {
      const m = await montarFlujo(vista, exito);
      try {
        const form = await m.abrir();
        m.llenar(form, valores as Record<string, string>);
        m.estado.getFalla = true; // el refresco posterior al guardado fallará
        await m.enviar(form);
        // Éxito del guardado conservado: correlativo visible, aviso de lista desactualizada y NINGÚN mensaje de fallo de guardado.
        expect(m.host.textContent).toContain(correlativo);
        expect(m.host.textContent).toContain("Guardado correctamente, pero no se pudo actualizar la lista");
        expect(m.host.textContent).not.toContain("No se pudo guardar");
        expect(m.host.querySelector('[role="status"]')!.textContent).toContain(correlativo);
        // El formulario se cierra y se vacía: no hay nada que reenviar por accidente.
        expect(m.host.querySelector("main > form, header ~ form, form select[name=\"" + Object.keys(valores)[0] + "\"]")).toBeNull();
        expect(m.estado.posts).toHaveLength(1);
        expect(m.estado.posts[0].url).toMatch(destino);
        // La clave de esa operación ya no se reutiliza: una operación posterior exige abrir un formulario NUEVO (vacío) y lleva clave nueva.
        expect(window.localStorage.length).toBe(0);
        const nuevo = await m.abrir();
        expect((nuevo.elements.namedItem(Object.keys(valores)[0]) as HTMLInputElement).value).toBe("");
        expect(Array.from(m.host.querySelectorAll("button")).some(b => b.textContent === "Actualizar lista")).toBe(true); // el aviso persiste hasta refrescar
        // Recuperar la lista quita el aviso sin tocar el guardado.
        m.estado.getFalla = false;
        await act(async () => { Array.from(m.host.querySelectorAll("button")).find(b => b.textContent === "Actualizar lista")!.click(); await new Promise(r => setTimeout(r, 30)); });
        expect(Array.from(m.host.querySelectorAll("button")).some(b => b.textContent === "Actualizar lista")).toBe(false);
        expect(m.host.textContent).not.toContain("no se pudo actualizar la lista");
        expect(m.host.textContent).toContain(correlativo); // la confirmación se conserva
        expect(m.estado.posts).toHaveLength(1); // ni el refresco ni nada volvió a enviar la operación
      } finally { await m.limpiar(); }
    });
    it("el envío doble inmediato (dos submit seguidos) produce un solo POST", async () => {
      const m = await montarFlujo("compras", { id: 7, mensaje: "ok" });
      try {
        const form = await m.abrir();
        m.llenar(form, { proveedor_id: "1", ubicacion_id: "1", recibido_por_empleado_id: "1", cantidad: "2", precio_compra: "10.50" });
        await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 30)); });
        expect(m.estado.posts).toHaveLength(1);
      } finally { await m.limpiar(); }
    });
    it("las claves guardadas se delimitan por empresa y usuario (terminal compartida)", async () => {
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
      window.localStorage.clear();
      const claves: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") { claves.push(JSON.parse(String(init.body)).clave_operacion); throw new TypeError("sin red"); }
        const recurso = String(input).split("/").pop();
        return Response.json({ datos: recurso === "proveedores" ? [{ id: 1, nombre_comercial: "P", activo: 1 }] : recurso === "ubicaciones" ? [{ id: 1, nombre: "B", activo: 1 }] : recurso === "empleados" ? [{ id: 1, nombre: "Ana" }] : [] });
      }));
      const enviarComo = async (identidad: { empresaId: number; usuarioId: number }) => {
        const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
        try {
          await act(async () => { root.render(createElement(CanecasClient, { slug: "demo", vista: "compras", permisos: { compras: true, recepciones: true, confirmar: true }, ...identidad })); await new Promise(r => setTimeout(r, 30)); });
          await act(async () => { host.querySelector<HTMLButtonElement>("header button")!.click(); });
          const form = host.querySelector("form")!;
          for (const [n, v] of Object.entries({ proveedor_id: "1", ubicacion_id: "1", recibido_por_empleado_id: "1", cantidad: "2", precio_compra: "10.00" })) (form.elements.namedItem(n) as HTMLInputElement).value = v;
          await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 20)); });
        } finally { await act(async () => root.unmount()); host.remove(); }
      };
      await enviarComo({ empresaId: 1, usuarioId: 10 }); await enviarComo({ empresaId: 1, usuarioId: 10 });
      expect(claves[1]).toBe(claves[0]);                  // mismo usuario y empresa tras recargar: misma clave
      await enviarComo({ empresaId: 1, usuarioId: 11 });  // otro usuario en la misma terminal y mismos datos: clave distinta
      await enviarComo({ empresaId: 2, usuarioId: 10 });  // otra empresa: clave distinta
      expect(new Set(claves).size).toBe(3);
      expect(Object.keys(window.localStorage).filter(k => k.startsWith("canecas:demo:")).sort()).toEqual(["canecas:demo:1:10:compras_ingreso", "canecas:demo:1:11:compras_ingreso", "canecas:demo:2:10:compras_ingreso"]);
    });
  });
});
