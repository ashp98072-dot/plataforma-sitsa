// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BancosClient } from "@/components/contabilidad/bancos-client";
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(createElement(BancosClient, { slug: "qa" })));
  return node;
}
const entidades = [{ id: 5, codigo: "QA", nombre: "Sintética", activa: 1 }];
it("vacío sin datos inventados, consulta no-store y navegación contable", async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("?entidad") ? { bancos: [] } : { entidades }));
  vi.stubGlobal("fetch", fetcher); const node = await mount();
  expect(node.textContent).toContain("No hay cuentas bancarias configuradas");
  expect(node.querySelector("a")?.getAttribute("href")).toBe("/e/qa/contabilidad");
  expect(fetcher.mock.calls[1]?.[0]).toContain("entidad=5");
});
it("muestra estado inactivo, moneda ausente y advertencia sin saldos", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("?entidad") ? { bancos: [{ id: 1, banco: "Banco QA", alias: null, moneda: null, activa: false, cuenta: null, advertencias: ["Cuenta contable no disponible en esta entidad."] }] } : { entidades })));
  const node = await mount(); expect(node.textContent).toContain("Inactiva"); expect(node.textContent).toContain("Sin configurar");
  expect(node.textContent).toContain("Cuenta contable no disponible"); expect(node.querySelectorAll("tbody tr")).toHaveLength(1);
});
it("error de permisos no muestra tabla ni datos anteriores", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Sin permiso de módulo." }, { status: 403 })));
  const node = await mount(); expect(node.querySelector('[role="alert"]')?.textContent).toContain("Sin permiso"); expect(node.querySelector("table")).toBeNull();
});
it("cambio de entidad descarta respuesta tardía de la anterior", async () => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("entidad=5") ? new Promise<Response>(r => { resolve = r; }) : Response.json(url.includes("entidad=6") ? { bancos: [] } : { entidades: [...entidades, { id: 6, codigo: "DOS", nombre: "Otra", activa: 1 }] })));
  const node = await mount(), select = node.querySelector("select")!;
  await act(async () => { select.value = "5"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { select.value = "6"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => resolve(Response.json({ bancos: [{ id: 99, banco: "ANTERIOR" }] })));
  expect(node.textContent).not.toContain("ANTERIOR"); expect(node.textContent).toContain("No hay cuentas bancarias configuradas");
});
