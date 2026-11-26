// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComprobanteVenta, ESCALA_MINIMA, htmlComprobante, type DatosComprobante } from "./comprobante-venta";
import { CanecasClient } from "./canecas-client";

const base: DatosComprobante = { empresaNombre: "Empresa Demo, S.A.", logoUrl: "/brands/demo/logo.png", documento: "VTA-000012", fecha: "2026-11-24", cliente: "Cliente <Uno>", origen: "Bodega Central", destino: "Zona 4, Ciudad", producto: "Caneca 55 gal", cantidad: "8", precioUnitario: "Q 95.00", total: "Q 760.00", quienLleva: "Juan Pérez", quienRecibe: "Ana López" };

describe("comprobante de venta (media carta)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("incluye logo (sin repetir el nombre), título, documento, fecha, cliente, Sale de, Va hacia, detalle, totales, quién lleva/recibe y dos firmas", () => {
    const h = htmlComprobante({ ...base, logoUrl: "/brands/demo/logo.png" });
    expect(h).toContain('<img src="/brands/demo/logo.png"');
    expect(h).not.toContain('class="emp"'); expect(h).not.toMatch(/>Empresa Demo, S\.A\.</); // solo el logo: el nombre no se escribe
    for (const t of ["COMPROBANTE DE VENTA", "VTA-000012", "2026-11-24", "Sale de", "Bodega Central", "Va hacia", "Zona 4, Ciudad", "Caneca 55 gal", "Q 95.00", "Subtotal", "Total", "Q 760.00", "Quién lleva", "Juan Pérez", "Quién recibe", "Ana López", "Firma de quien entrega", "Firma de quien recibe"]) expect(h, t).toContain(t);
    expect(h).not.toContain("Dirección de entrega"); // mismo dato que «Va hacia»: no se duplica
    expect(h.match(/class="linea"/g)).toHaveLength(2);
  });
  it("papel: carta imprime la media hoja arriba (8.5 x 11, margen 0); media carta es 8.5 x 5.5; NO recorta: sin alto fijo, sin overflow oculto ni alturas mínimas; ajusta la escala y lo marca", () => {
    const carta = htmlComprobante(base), media = htmlComprobante(base, "media");
    expect(carta).toContain("@page { size: 8.5in 11in; margin: 0; }"); expect(media).toContain("@page { size: 8.5in 5.5in; margin: 0; }");
    for (const h of [carta, media]) {
      expect(h).toContain(".hoja { width: 8.5in; padding: 0.25in 0.45in; }");
      expect(h).not.toMatch(/overflow:\s*hidden|overflow:\s*clip|min-height|margin-top:\s*auto|\.hoja \{[^}]*height:/);
      expect(h).toContain("data-ajuste"); expect(h).toContain(`MIN = ${ESCALA_MINIMA}`); expect(h).toContain("DISPONIBLE = 5.4 * 96 - 48");
    }
    expect(carta.replace(/@page \{[^}]*\}/, "")).toBe(media.replace(/@page \{[^}]*\}/, "")); // mismo contenido; solo cambia el papel
  });
  it("sin logo configurado se muestra el nombre de la empresa (nunca un logo ajeno); los logos incrustados PNG/JPEG se admiten", () => {
    expect(htmlComprobante({ ...base, logoUrl: null })).toContain('<div class="emp">Empresa Demo, S.A.</div>');
    expect(htmlComprobante({ ...base, logoUrl: "data:image/png;base64,iVBORw0KGgo=" })).toContain('<img src="data:image/png;base64,iVBORw0KGgo="');
    expect(htmlComprobante({ ...base, logoUrl: "data:text/html;base64,AAAA" })).not.toContain("<img");
  });
  it("escapa los datos y solo admite logos del propio sitio o https; sin logo ni personas deja espacios en blanco para llenar a mano", () => {
    const h = htmlComprobante({ ...base, logoUrl: "javascript:alert(1)", quienLleva: "", quienRecibe: "", cliente: '<script>x</script>"' });
    expect(h).not.toContain("<script>x"); expect(h).toContain("&lt;script&gt;x&lt;/script&gt;&quot;");
    expect(h).not.toContain("<img"); expect(h).not.toContain("javascript:");
    expect(h).toContain('<span class="va">&nbsp;</span>');
  });
  it("la vista previa usa un iframe con el mismo HTML e imprime desde él", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    const cerrar = vi.fn();
    try {
      await act(async () => { root.render(createElement(ComprobanteVenta, { datos: base, onCerrar: cerrar })); });
      const marco = host.querySelector("iframe")!;
      expect(marco.getAttribute("srcdoc")).toBe(htmlComprobante(base, "carta"));
      await act(async () => { (host.querySelectorAll("input[name=papel]")[1] as HTMLInputElement).click(); });
      expect(host.querySelector("iframe")!.getAttribute("srcdoc")).toContain("size: 8.5in 5.5in");
      const imprimir = vi.fn(); Object.defineProperty(marco, "contentWindow", { value: { focus: vi.fn(), print: imprimir, document: { images: [] } } });
      const botones = [...host.querySelectorAll("button")];
      await act(async () => { botones.find(b => b.textContent === "Imprimir")!.click(); botones.find(b => b.textContent === "Cerrar")!.click(); });
      await act(async () => { await new Promise(r => setTimeout(r, 10)); });
      expect(imprimir).toHaveBeenCalledTimes(1); expect(cerrar).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("Ventas: cada venta activa ofrece «Imprimir comprobante» con los datos de la empresa activa; las anuladas no; el formulario trae quién lleva y quién recibe", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const fila = { id: "1", fecha: "2026-11-24", documento: "VTA-000012", cliente: "Cliente Uno", direccion_entrega: "Zona 4", ubicacion: "Bodega Real", producto: "Caneca", cantidad: 8, precio_unitario: "Q 95.00", total: "Q 760.00", estado: "ACTIVA", quien_lleva: "Juan", quien_recibe: null };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ datos: [fila, { ...fila, id: "2", documento: "VTA-000013", estado: "ANULADA" }] })));
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    try {
      await act(async () => { root.render(createElement(CanecasClient, { slug: "demo", vista: "ventas", permisos: { ventas: true }, empresaNombre: "Empresa Demo, S.A.", logoUrl: "/brands/demo/logo.png" })); });
      await act(async () => { await new Promise(r => setTimeout(r, 40)); });
      const botones = [...host.querySelectorAll("button")].filter(b => b.textContent === "Imprimir comprobante");
      expect(botones).toHaveLength(1);
      await act(async () => { botones[0].click(); });
      const html = host.querySelector("iframe")!.getAttribute("srcdoc")!;
      for (const t of ["/brands/demo/logo.png", "VTA-000012", "Juan", "Bodega Real", "Zona 4", "Q 760.00", "Q 95.00"]) expect(html, t).toContain(t);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("espera a que el logo cargue (o falle) antes de imprimir", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    try {
      await act(async () => { root.render(createElement(ComprobanteVenta, { datos: base, onCerrar: vi.fn() })); });
      const marco = host.querySelector("iframe")!, imprimir = vi.fn();
      const img = document.createElement("img"); Object.defineProperty(img, "complete", { value: false });
      Object.defineProperty(marco, "contentWindow", { value: { focus: vi.fn(), print: imprimir, document: { images: [img] } } });
      await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Imprimir")!.click(); await new Promise(r => setTimeout(r, 20)); });
      expect(imprimir).not.toHaveBeenCalled(); // el logo aún no termina de descargar
      await act(async () => { img.dispatchEvent(new Event("error")); await new Promise(r => setTimeout(r, 20)); }); // imágenes bloqueadas: imprime igual
      expect(imprimir).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("el comprobante no contiene costos ni utilidad aunque el usuario tenga permiso de costos", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const fila = { id: "1", fecha: "2026-11-24", documento: "VTA-000012", cliente: "Cliente Uno", direccion_entrega: "Zona 4", producto: "Caneca", cantidad: 8, precio_unitario: "Q 95.00", total: "Q 760.00", costo_fifo: "Q 640.00", utilidad: "Q 120.00", estado: "ACTIVA" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ datos: [fila] })));
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    try {
      await act(async () => { root.render(createElement(CanecasClient, { slug: "demo", vista: "ventas", permisos: { ventas: true, compras: true }, empresaNombre: "Demo" })); });
      await act(async () => { await new Promise(r => setTimeout(r, 40)); });
      await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Imprimir comprobante")!.click(); });
      const html = host.querySelector("iframe")!.getAttribute("srcdoc")!;
      expect(html).not.toMatch(/640\.00|120\.00|[Cc]osto|[Uu]tilidad/); expect(html).toContain("Q 760.00");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("avisa en pantalla cuando el comprobante se redujo o no cabe en la media hoja (nada se oculta en silencio)", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    try {
      await act(async () => { root.render(createElement(ComprobanteVenta, { datos: base, onCerrar: vi.fn() })); });
      const marco = host.querySelector("iframe")!;
      const simular = async (estado: string, escala: string) => {
        Object.defineProperty(marco, "contentDocument", { configurable: true, value: { documentElement: { getAttribute: (n: string) => (n === "data-ajuste" ? estado : escala) } } });
        await act(async () => { marco.dispatchEvent(new Event("load")); });
      };
      await simular("normal", "1"); expect(host.querySelector("[role=status],[role=alert]")).toBeNull();
      await simular("reducido", "0.75"); expect(host.querySelector("[role=status]")!.textContent).toContain("75 %");
      await simular("extendido", "0.6"); expect(host.querySelector("[role=alert]")!.textContent).toMatch(/No se recorta nada/);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
