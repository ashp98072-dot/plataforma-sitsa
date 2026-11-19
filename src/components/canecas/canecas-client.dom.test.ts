// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanecasClient } from "./canecas-client";

describe("recepciones de Canecas", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
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
      await act(async () => { button!.click(); await new Promise(r => setTimeout(r,20)); });
      expect(host.textContent).toContain("CONFIRMADA");
      expect(host.textContent).toContain("operador");
      expect(fetchMock.mock.calls.filter(([url,init]) => String(url).endsWith("/confirmar") && init?.method === "POST")).toHaveLength(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
