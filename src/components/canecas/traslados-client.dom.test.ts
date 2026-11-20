// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrasladosClient } from "./traslados-client";

describe("pantalla de traslados", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("restringe acciones y muestra versiones históricas", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => Response.json({ datos: String(input).endsWith("/traslados") ? [{ id: 1, numero: "TR-1", estado: "ENVIADO", origen: "A", destino: "B", versiones: 2, partidas: [{ id: 1, producto: "Aceite", presentacion: "Caneca", cantidad: 3, recibido: 1, faltante: 0, transito: 2 }] }] : [] })));
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    try {
      await act(async () => { root.render(createElement(TrasladosClient, { slug: "demo", permisos: {} })); });
      await act(async () => { await new Promise(r => setTimeout(r, 30)); });
      expect(host.textContent).not.toContain("Nuevo traslado");
      expect(host.textContent).not.toContain("Registrar recepción");
      expect(host.querySelectorAll("a[href*=comprobante]")).toHaveLength(2);
      await act(async () => { root.render(createElement(TrasladosClient, { slug: "demo", permisos: { recepciones: true, confirmar: true } })); });
      expect(host.textContent).toContain("Nuevo traslado");
      expect(host.textContent).toContain("Registrar recepción");
      expect(host.textContent).toContain("pendiente: 2");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("evita doble envío y muestra errores al recibir", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    let resolver!: (r: Response) => void;
    const pendiente = new Promise<Response>(resolve => { resolver = resolve; });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => init?.method === "POST" ? pendiente : Response.json({ datos: String(input).endsWith("/traslados") ? [{ id: 1, numero: "TR-1", estado: "ENVIADO", origen: "A", destino: "B", versiones: 1, partidas: [{ id: 1, producto: "Aceite", presentacion: "Caneca", cantidad: 3, recibido: 1, faltante: 0, transito: 2 }] }] : [] }));
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
    try {
      await act(async () => { root.render(createElement(TrasladosClient, { slug: "demo", permisos: { confirmar: true } })); });
      await act(async () => { await new Promise(r => setTimeout(r, 30)); });
      const form = host.querySelector<HTMLFormElement>("form")!;
      (form.elements.namedItem("recibe") as HTMLInputElement).value = "Ana";
      (form.elements.namedItem("condicion") as HTMLInputElement).value = "Bien";
      (form.elements.namedItem("recibido-1") as HTMLInputElement).value = "1";
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(fetchMock.mock.calls.filter(([,init]) => init?.method === "POST")).toHaveLength(1);
      await act(async () => { resolver(Response.json({ error: "Error de prueba" }, { status: 409 })); await pendiente; });
      expect(host.textContent).toContain("Error de prueba");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});

