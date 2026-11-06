// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CxpClient } from "@/components/contabilidad/cxp-client";
import { CxpAntiguedad } from "@/components/contabilidad/cxp-antiguedad";
import { CxpEstadoCuenta } from "@/components/contabilidad/cxp-estado-cuenta";

let root: Root | undefined;
let container: HTMLDivElement;
const suppliers = [
  { id: 1001, nombre: "SYNTHETIC-ACTIVE", nit: "QA-1", activo: true, fiscal: null },
  { id: 1002, nombre: "SYNTHETIC-ALSO-ACTIVE", nit: "QA-2", activo: true, fiscal: null },
  { id: 1003, nombre: "SYNTHETIC-INACTIVE", nit: "QA-3", activo: false, fiscal: null },
];
const props = { slug: "qa", puedeVer: true, puedeRegistrar: true, puedeAnular: false, puedeVerFiscal: false,
  puedeEditarFiscal: false, puedeVerPagos: true, puedeRegistrarPago: true };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; document.body.innerHTML = ""; vi.unstubAllGlobals();
});
function setFetch(rows: Array<{ id: number; nombre: string; nit: string; activo: boolean; fiscal: unknown }> = suppliers) {
  const mock = vi.fn(async (url: string) => {
    if (url.endsWith("/entidades")) return Response.json({ entidades: [{ id: 11, codigo: "QA", nombre: "SYNTHETIC-BOOK", activa: 1 }] });
    if (url.includes("/proveedores?")) return Response.json({ proveedores: rows });
    if (url.includes("/facturas?")) return Response.json({ total: 0, facturas: [] });
    if (url.includes("/pagos?")) return Response.json({ total: 0, pagos: [] });
    if (url.includes("/cuentas?")) return Response.json({ cuentas: [] });
    if (url.includes("/antiguedad?")) return Response.json({ error: "Synthetic report not loaded" }, { status: 503 });
    throw new Error(`Unexpected test fetch: ${url}`);
  });
  vi.stubGlobal("fetch", mock); return mock;
}
async function mount(element: ReturnType<typeof createElement>) {
  await act(async () => root!.render(element));
  await act(async () => {});
}
async function tab(label: string) {
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === label);
  expect(button).toBeDefined(); await act(async () => button!.click()); await act(async () => {});
}
async function select(selector: string, value: string) {
  const el = container.querySelector<HTMLSelectElement>(selector);
  expect(el).not.toBeNull(); await act(async () => { el!.value = value; el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => {}); return el!;
}
it("invoice selector keeps active commercial providers selectable with fiscal:null", async () => {
  setFetch(); await mount(createElement(CxpClient, props));
  const input = await select('[aria-label="Proveedor"]', "1001");
  expect(input.value).toBe("1001");
  expect([...input.options].map(o => o.value)).toEqual(["", "1001", "1002"]);
  expect(container.textContent).not.toContain("SYNTHETIC-INACTIVE");
});
it("payment selector keeps commercial providers and loads invoices for selected provider without fiscal access", async () => {
  const mock = setFetch(); await mount(createElement(CxpClient, props)); await tab("Pagos");
  const input = await select('[aria-label="Proveedor del pago"]', "1001");
  expect(input.value).toBe("1001");
  expect([...input.options].map(o => o.value)).toEqual(["", "1001", "1002"]);
  expect(mock.mock.calls.some(([url]) => url.includes("proveedorId=1001"))).toBe(true);
});
it("commercial provider table does not infer or display missing fiscal configuration", async () => {
  const mock = setFetch(); await mount(createElement(CxpClient, props)); await tab("Proveedores y configuración fiscal");
  expect(container.textContent).toContain("SYNTHETIC-ACTIVE");
  expect([...container.querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["Proveedor", "NIT"]);
  expect(container.textContent).not.toContain("Sin configurar");
  expect(container.textContent).not.toContain("Pendiente");
  expect(mock.mock.calls.some(([url]) => url.includes("/cuentas?"))).toBe(false);
});
it("fiscal reader retains fiscal columns, configuration state and editing controls", async () => {
  const fiscal = { regimenFiscal: "GENERAL" as const, sujetoIsr: true, cuentaProveedorId: 11001,
    cuentaAnticipoId: 11002, cuentaGastoId: 11003, activo: true };
  setFetch([{ ...suppliers[0], fiscal }]);
  await mount(createElement(CxpClient, { ...props, puedeVerFiscal: true, puedeEditarFiscal: true }));
  await tab("Proveedores y configuración fiscal");
  expect(container.textContent).toContain("General"); expect(container.textContent).toContain("Activa");
  await tab("Editar");
  expect(container.textContent).toContain("Configuración fiscal — SYNTHETIC-ACTIVE");
});
it("antiquity filter still loads and selects commercial suppliers without fiscal fields", async () => {
  setFetch(); await mount(createElement(CxpAntiguedad, { slug: "qa", entidadId: "11" }));
  const option = [...container.querySelectorAll("option")].find(o => o.value === "1001");
  expect(option?.textContent).toBe("SYNTHETIC-ACTIVE");
  const parent = option!.parentElement as HTMLSelectElement;
  await act(async () => { parent.value = "1001"; parent.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(parent.value).toBe("1001");
});
it("provider statement selector still loads commercial suppliers without fiscal fields", async () => {
  setFetch(); await mount(createElement(CxpEstadoCuenta, { slug: "qa", entidadId: "11" }));
  const option = [...container.querySelectorAll("option")].find(o => o.value === "1001");
  expect(option?.textContent).toBe("SYNTHETIC-ACTIVE");
  const parent = option!.parentElement as HTMLSelectElement;
  await act(async () => { parent.value = "1001"; parent.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(parent.value).toBe("1001");
});
