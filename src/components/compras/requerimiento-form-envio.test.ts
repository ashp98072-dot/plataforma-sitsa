import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * COMPORTAMIENTO del formulario de Requerimientos de Compras ante doble envío y respuestas inciertas. Se ejecuta el componente
 * con el mismo arnés de hooks que documentos-pendientes-client.test.ts (useState/useEffect simulados, sin DOM): se obtiene el
 * `onSubmit` del <form> y se invoca como lo haría el navegador.
 */
const h = vi.hoisted(() => ({ activo: false, indice: 0, estados: [] as unknown[], efectos: [] as (() => void | (() => void))[], push: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async importar => {
  const real = await importar<typeof import("react")>();
  return { ...real, useState: (inicial: unknown) => {
    if (!h.activo) return real.useState(inicial);
    const i = h.indice++; if (!(i in h.estados)) h.estados[i] = typeof inicial === "function" ? inicial() : inicial;
    return [h.estados[i], (valor: unknown) => { h.estados[i] = typeof valor === "function" ? valor(h.estados[i]) : valor; }];
  }, useEffect: (efecto: () => void | (() => void)) => { if (h.activo) h.efectos.push(efecto); else real.useEffect(efecto); } };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
import { nuevaLinea, RequerimientoFormClient } from "./requerimiento-form-client";

const mockFetch = vi.fn();
const res = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
function elementos(nodo: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(nodo)) return nodo.flatMap(elementos);
  if (!isValidElement<Record<string, unknown>>(nodo)) return [];
  return [nodo, ...elementos(nodo.props.children as ReactNode)];
}
function ejecutar<T>(fn: () => T): T { h.indice = 0; h.efectos = []; h.activo = true; try { return fn(); } finally { h.activo = false; } }

const render = () => RequerimientoFormClient({ slug: "a", detalle: undefined, editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: false, puedeAutorizar: false, fechaHoy: "2026-10-01" });
const submit = () => {
  const form = elementos(ejecutar(render)).find(e => e.type === "form")!;
  return () => (form.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault() {} });
};
const nuevoFormulario = () => {
  h.estados = [];
  ejecutar(render);
  h.estados[1] = 4; h.estados[2] = 2; // empresa requirente y persona que requiere
  h.estados[5] = [{ ...nuevaLinea("2026-10-01", "nueva"), proveedor_id: 9, repuesto_descripcion: "Filtro", total: "100.00" }];
};
const cuerpos = () => mockFetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body) as Record<string, unknown>);

beforeEach(() => {
  h.push.mockReset(); h.refresh.mockReset(); mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch); vi.stubGlobal("window", { alert: vi.fn() });
  nuevoFormulario();
});
afterEach(() => vi.unstubAllGlobals());

it("doble envío en el mismo tick (clic + Enter): UN solo POST; el segundo se descarta", async () => {
  mockFetch.mockImplementation(() => res(201, { id: 12, codigo: "RC-2026-000012", version: 1 }));
  const enviar = submit();
  await Promise.all([enviar(), enviar(), enviar()]);
  expect(mockFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(h.push).toHaveBeenCalledOnce();
});

it("el POST de creación lleva clave_idempotencia válida", async () => {
  mockFetch.mockImplementation(() => res(201, { id: 12 }));
  await submit()();
  const [cuerpo] = cuerpos();
  expect(cuerpo.clave_idempotencia).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  expect(cuerpo).not.toHaveProperty("version");
});

it("respuesta perdida (red caída): el botón queda libre y el reintento reutiliza la MISMA clave", async () => {
  mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockImplementation(() => res(201, { id: 12 }));
  await submit()();
  expect(h.push).not.toHaveBeenCalled();
  expect(h.estados[7]).toContain("Failed to fetch"); // error visible; sin éxito
  await submit()();
  const [primero, segundo] = cuerpos();
  expect(segundo.clave_idempotencia).toBe(primero.clave_idempotencia);
  expect(h.push).toHaveBeenCalledOnce();
});

it("error 5xx tras una creación posiblemente confirmada: el reintento conserva la clave", async () => {
  mockFetch.mockImplementationOnce(() => res(500, { error: "No se pudo procesar el requerimiento." })).mockImplementation(() => res(201, { id: 12 }));
  await submit()();
  await submit()();
  const [primero, segundo] = cuerpos();
  expect(segundo.clave_idempotencia).toBe(primero.clave_idempotencia);
});

it("tras el éxito el formulario queda bloqueado: un envío tardío no dispara otro POST (ni otra clave)", async () => {
  mockFetch.mockImplementation(() => res(201, { id: 12 }));
  await submit()();
  expect(cuerpos()).toHaveLength(1);
  await submit()(); // handler del render posterior al éxito (completado = true)
  expect(cuerpos()).toHaveLength(1);
});

it("un formulario NUEVO genera otra clave (dos creaciones legítimas con el mismo contenido)", async () => {
  mockFetch.mockImplementation(() => res(201, { id: 12 }));
  await submit()();
  nuevoFormulario();
  await submit()();
  const [a, b] = cuerpos();
  expect(b.clave_idempotencia).not.toBe(a.clave_idempotencia);
});

it("409 (p. ej. misma clave con otro contenido): se muestra el mensaje y el formulario se bloquea con la opción de actualizar", async () => {
  mockFetch.mockImplementation(() => res(409, { error: "Esta operación ya se registró con datos distintos a los que envías ahora. Revisa el listado antes de volver a intentarlo." }));
  await submit()();
  expect(h.estados[10]).toBe(true); // conflicto
  expect(h.estados[7]).toContain("ya se registró con datos distintos");
  expect(h.push).not.toHaveBeenCalled();
});
