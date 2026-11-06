// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BancosMayorPanel } from "@/components/contabilidad/bancos-mayor-panel";
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(createElement(BancosMayorPanel, { base: "/bancos/10/mayor", entidad: "5" })));
  const inputs = node.querySelectorAll("input");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(inputs[0], "2026-01-01"); inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    setter.call(inputs[1], "2026-01-31"); inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
  });
  return node;
}
async function submit(node: HTMLElement) { await act(async () => node.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
const resultado = { cuenta: { codigo: "11103001", nombre: "Cuenta QA" }, desde: "2026-01-01", hasta: "2026-01-31", movimientos: [{ detalleId: 1, asientoId: 2, numero: "A1", fecha: "2026-01-01", estado: "Registrado", debe: "999999999999.99", haber: "0.10" }] };
it("consulta explícita, exactitud visual y advertencia de cobertura", async () => {
  const fetcher = vi.fn(async () => Response.json(resultado)); vi.stubGlobal("fetch", fetcher);
  const node = await mount(); expect(fetcher).not.toHaveBeenCalled(); await submit(node);
  expect(fetcher).toHaveBeenCalledWith("/bancos/10/mayor?entidad=5&desde=2026-01-01&hasta=2026-01-31", expect.objectContaining({ cache: "no-store" }));
  expect(node.textContent).toContain("999999999999.99"); expect(node.textContent).toContain("No demuestra movimiento bancario real");
  expect(node.querySelectorAll("tbody tr")).toHaveLength(1); expect(node.querySelectorAll("th")).toHaveLength(6);
});
it("permiso denegado limpia resultados y permite reintentar mismos filtros", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(resultado)).mockResolvedValueOnce(Response.json({ error: "Sin permiso para ver el Libro Mayor." }, { status: 403 })).mockResolvedValueOnce(Response.json({ ...resultado, movimientos: [] }));
  vi.stubGlobal("fetch", fetcher); const node = await mount(); await submit(node); await submit(node);
  expect(node.querySelector("table")).toBeNull(); expect(node.querySelector('[role="alert"]')?.textContent).toContain("Sin permiso");
  await submit(node); expect(node.textContent).toContain("No hay movimientos"); expect(fetcher).toHaveBeenCalledTimes(3);
});
it("desmontar cuenta aborta y descarta respuesta tardía", async () => {
  let resolve!: (r: Response) => void; let signal!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn((_url, opts) => { signal = opts.signal; return new Promise<Response>(r => { resolve = r; }); }));
  const node = await mount(); await submit(node);
  await act(async () => root.render(createElement(BancosMayorPanel, { key: "otra", base: "/bancos/11/mayor", entidad: "6" })));
  expect(signal.aborted).toBe(true); await act(async () => resolve(Response.json(resultado)));
  expect(node.textContent).not.toContain("999999999999.99");
});
