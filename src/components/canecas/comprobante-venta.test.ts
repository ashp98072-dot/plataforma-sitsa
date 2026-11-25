// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComprobanteVenta, htmlComprobante, type DatosComprobante } from "./comprobante-venta";
import { CanecasClient } from "./canecas-client";

const base: DatosComprobante = { empresaNombre: "Empresa Demo, S.A.", logoUrl: "/brands/demo/logo.png", documento: "VTA-000012", fecha: "2026-11-24", cliente: "Cliente <Uno>", direccion: "Zona 4, Ciudad", producto: "Caneca 55 gal", cantidad: "8", precioUnitario: "Q 95.00", total: "Q 760.00", quienLleva: "Juan Pérez", quienRecibe: "Ana López" };

describe("comprobante de venta (media carta)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("incluye logo, empresa, título, documento, fecha, cliente, dirección, cantidad, precios, total, quién lleva/recibe y dos líneas de firma", () => {
    const h = htmlComprobante(base);
    expect(h).toContain('<img src="/brands/demo/logo.png"');
    for (const t of ["Empresa Demo, S.A.", "Comprobante de Venta", "VTA-000012", "2026-11-24", "Zona 4, Ciudad", "Caneca 55 gal", "Q 95.00", "Subtotal", "Total", "Q 760.00", "Quién lleva", "Juan Pérez", "Quién recibe", "Ana López", "Firma de quien entrega", "Firma de quien recibe"]) expect(h, t).toContain(t);
    expect(h.match(/class="linea"/g)).toHaveLength(2);
    expect(h).toContain("@page { size: 5.5in 8.5in;");
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
      expect(marco.getAttribute("srcdoc")).toBe(htmlComprobante(base));
      const imprimir = vi.fn(); Object.defineProperty(marco, "contentWindow", { value: { focus: vi.fn(), print: imprimir } });
      const botones = [...host.querySelectorAll("button")];
      await act(async () => { botones.find(b => b.textContent === "Imprimir")!.click(); botones.find(b => b.textContent === "Cerrar")!.click(); });
      expect(imprimir).toHaveBeenCalledTimes(1); expect(cerrar).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("Ventas: cada venta activa ofrece «Imprimir comprobante» con los datos de la empresa activa; las anuladas no; el formulario trae quién lleva y quién recibe", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const fila = { id: "1", fecha: "2026-11-24", documento: "VTA-000012", cliente: "Cliente Uno", direccion_entrega: "Zona 4", producto: "Caneca", cantidad: 8, precio_unitario: "Q 95.00", total: "Q 760.00", estado: "ACTIVA", quien_lleva: "Juan", quien_recibe: null };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ datos: [fila, { ...fila, id: "2", documento: "VTA-000013", estado: "ANULADA" }] })));
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    try {
      await act(async () => { root.render(createElement(CanecasClient, { slug: "demo", vista: "ventas", permisos: { ventas: true }, empresaNombre: "Empresa Demo, S.A.", logoUrl: "/brands/demo/logo.png" })); });
      await act(async () => { await new Promise(r => setTimeout(r, 40)); });
      const botones = [...host.querySelectorAll("button")].filter(b => b.textContent === "Imprimir comprobante");
      expect(botones).toHaveLength(1);
      await act(async () => { botones[0].click(); });
      const html = host.querySelector("iframe")!.getAttribute("srcdoc")!;
      for (const t of ["Empresa Demo, S.A.", "/brands/demo/logo.png", "VTA-000012", "Juan", "Zona 4"]) expect(html, t).toContain(t);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
