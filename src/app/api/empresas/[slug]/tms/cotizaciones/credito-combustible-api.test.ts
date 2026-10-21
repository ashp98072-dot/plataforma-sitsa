import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantCotizaciones: vi.fn(), requireTenantCotizacionesCosteo: vi.fn() }));
vi.mock("@/lib/tms/cotizaciones", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/lib/tms/cotizaciones")>()),
  crearCotizacion: vi.fn(), actualizarCotizacion: vi.fn(), obtenerCotizacion: vi.fn(), duplicarCotizacion: vi.fn(), listarCotizaciones: vi.fn(),
}));

import { requireTenantCotizaciones } from "@/lib/tenant";
import { actualizarCotizacion, crearCotizacion, duplicarCotizacion, listarCotizaciones, obtenerCotizacion } from "@/lib/tms/cotizaciones";
import { COTIZACION_DOC } from "@/lib/tms/cotizacion-documento.fixture";
import { GET as listar, POST as crear } from "./route";
import { GET as detalle, PATCH as editar } from "./[id]/route";
import { POST as duplicar } from "./[id]/duplicar/route";

/** COTIZACIONES-CREDITO-COMBUSTIBLE — validación del servidor en POST/PATCH y exposición en GET/duplicar. */
const ctx = (id = "123") => ({ params: Promise.resolve({ slug: "kt-monaco", id }) });
const json = (body: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const BASE = { clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08" };
const CON = { ...COTIZACION_DOC, condicionesCredito: "Crédito 30 días", combustibleReferenciaTipo: "diesel" as const, combustibleReferenciaPrecio: 29.75 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantCotizaciones).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "Kuiqtrans" }, session: { username: "admin" } } as never);
  vi.mocked(crearCotizacion).mockResolvedValue(CON);
  vi.mocked(actualizarCotizacion).mockResolvedValue(CON);
  vi.mocked(obtenerCotizacion).mockResolvedValue(CON);
  vi.mocked(listarCotizaciones).mockResolvedValue([CON]);
  vi.mocked(duplicarCotizacion).mockResolvedValue({ ...CON, id: 124 });
});

describe("POST /tms/cotizaciones — crédito y combustible", () => {
  it("pasa los 3 campos a la capa de datos con la empresa de la sesión", async () => {
    const res = await crear(new Request("http://x/api", json({ ...BASE, condicionesCredito: "Crédito 30 días", combustibleReferenciaTipo: "diesel", combustibleReferenciaPrecio: 29.75 })), ctx());
    expect(res.status).toBe(200);
    const [empresaId, datos] = vi.mocked(crearCotizacion).mock.calls[0];
    expect(empresaId).toBe(7);
    expect(datos).toMatchObject({ condicionesCredito: "Crédito 30 días", combustibleReferenciaTipo: "diesel", combustibleReferenciaPrecio: 29.75 });
  });

  it("los 3 campos son opcionales y aceptan null", async () => {
    expect((await crear(new Request("http://x/api", json(BASE)), ctx())).status).toBe(200);
    const res = await crear(new Request("http://x/api", json({ ...BASE, condicionesCredito: null, combustibleReferenciaTipo: null, combustibleReferenciaPrecio: null })), ctx());
    expect(res.status).toBe(200);
  });

  it.each(["Diesel", "kerosene", "", 5])("rechaza tipo de combustible inválido %j con 400 y sin crear", async (malo) => {
    const res = await crear(new Request("http://x/api", json({ ...BASE, combustibleReferenciaTipo: malo })), ctx());
    expect(res.status).toBe(400);
    expect(crearCotizacion).not.toHaveBeenCalled();
  });

  it.each([29.755, 0, -3, "29.75"])("rechaza precio de referencia inválido %j con 400", async (malo) => {
    const res = await crear(new Request("http://x/api", json({ ...BASE, combustibleReferenciaPrecio: malo })), ctx());
    expect(res.status).toBe(400);
    expect(crearCotizacion).not.toHaveBeenCalled();
  });

  it("rechaza condiciones de crédito de más de 300 caracteres", async () => {
    const res = await crear(new Request("http://x/api", json({ ...BASE, condicionesCredito: "x".repeat(301) })), ctx());
    expect(res.status).toBe(400);
    expect(crearCotizacion).not.toHaveBeenCalled();
  });
});

describe("PATCH /tms/cotizaciones/[id] — crédito y combustible", () => {
  const patch = (body: unknown) => editar(new Request("http://x/api", json(body, "PATCH")), ctx());

  it("pasa los cambios a actualizarCotizacion (que aplica la regla de Borrador)", async () => {
    const res = await patch({ condicionesCredito: "Contado", combustibleReferenciaTipo: "gasolina", combustibleReferenciaPrecio: 32.1 });
    expect(res.status).toBe(200);
    expect(vi.mocked(actualizarCotizacion).mock.calls[0][2]).toMatchObject({ condicionesCredito: "Contado", combustibleReferenciaTipo: "gasolina", combustibleReferenciaPrecio: 32.1 });
  });

  it("rechaza tipo inválido y precio con 3 decimales", async () => {
    expect((await patch({ combustibleReferenciaTipo: "jet" })).status).toBe(400);
    expect((await patch({ combustibleReferenciaPrecio: 1.234 })).status).toBe(400);
    expect(actualizarCotizacion).not.toHaveBeenCalled();
  });
});

describe("GET listado/detalle y duplicar exponen los campos", () => {
  it("listado", async () => {
    const res = await listar(new Request("http://x/api"), ctx());
    const body = JSON.stringify(await res.json());
    expect(body).toContain('"condicionesCredito":"Crédito 30 días"');
    expect(body).toContain('"combustibleReferenciaTipo":"diesel"');
    expect(body).toContain('"combustibleReferenciaPrecio":29.75');
  });

  it("detalle", async () => {
    const res = await detalle(new Request("http://x/api"), ctx());
    const body = JSON.stringify(await res.json());
    expect(body).toContain('"condicionesCredito":"Crédito 30 días"');
    expect(body).toContain('"combustibleReferenciaPrecio":29.75');
  });

  it("duplicar delega en la capa de datos con la empresa de la sesión", async () => {
    const res = await duplicar(new Request("http://x/api", { method: "POST" }), ctx());
    expect(res.status).toBe(200);
    expect(vi.mocked(duplicarCotizacion).mock.calls[0][0]).toBe(7);
    expect(JSON.stringify(await res.json())).toContain('"combustibleReferenciaTipo":"diesel"');
  });
});
