import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn(), requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/programacion-lote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tms/programacion-lote")>()),
  validarLote: vi.fn(),
  confirmarLote: vi.fn(),
}));
vi.mock("@/lib/tms/programacion-copia", () => ({ cargarCopiaDeFecha: vi.fn(), catalogosParaCopia: vi.fn(), borradoresDesdeCliente: vi.fn() }));

import { requireTenantProgramacion, requireTenantProgramacionOTms } from "@/lib/tenant";
import { confirmarLote, validarLote } from "@/lib/tms/programacion-lote";
import { borradoresDesdeCliente, cargarCopiaDeFecha, catalogosParaCopia } from "@/lib/tms/programacion-copia";
import { GET as cargar } from "./route";
import { POST as validar } from "./validar/route";
import { POST as confirmar } from "./confirmar/route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const fila = { fila: 1, origenPlanId: 900, rutaId: 10, clienteId: 3, horaCarga: "03:00", tipoTraslado: null, tipoViaje: "Propio", unidadPlaca: "P-1", tcVehiculoId: null, pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [], tarifaId: null, externo: null };
const cuerpo = (over: Record<string, unknown> = {}) => ({ fechaOrigen: "2026-09-24", fechaDestino: "2026-09-25", filas: [fila], ...over });
const post = (fn: typeof validar, body: unknown) => fn(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const sesion = { session: { username: "jefe" }, empresa: { id: 7 } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacion).mockResolvedValue(sesion as never);
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue(sesion as never);
  vi.mocked(cargarCopiaDeFecha).mockResolvedValue([{ borrador: { ...fila, paradas: [] }, origen: { planId: 900 }, advertencias: [] }] as never);
  vi.mocked(catalogosParaCopia).mockResolvedValue({ empleados: [], unidades: [], tcs: [], tarifasPorRuta: {} });
  vi.mocked(validarLote).mockResolvedValue([{ fila: 1, estado: "ok", errores: [], tarifa: null }]);
  vi.mocked(borradoresDesdeCliente).mockResolvedValue({ ok: true, borradores: [{ ...fila, paradas: [] }] } as never);
  vi.mocked(confirmarLote).mockResolvedValue({ ok: true, planIds: [1000], codigos: ["PLAN-1"] });
});

describe("permisos y tenant", () => {
  it("confirmar exige programacion:crear; sin permiso no valida ni crea nada", async () => {
    vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: NextResponse.json({ error: "no" }, { status: 403 }) } as never);
    expect((await post(confirmar, cuerpo())).status).toBe(403);
    expect(requireTenantProgramacion).toHaveBeenCalledWith("acme", "crear");
    expect(confirmarLote).not.toHaveBeenCalled();
    expect(borradoresDesdeCliente).not.toHaveBeenCalled();
  });
  it("cargar y validar (solo lectura) usan programacion:ver; sin permiso no leen nada", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: NextResponse.json({ error: "no" }, { status: 403 }) } as never);
    expect((await cargar(new Request("http://x/api?fechaOrigen=2026-09-24&fechaDestino=2026-09-25"), ctx)).status).toBe(403);
    expect((await post(validar, cuerpo())).status).toBe(403);
    expect(requireTenantProgramacionOTms).toHaveBeenCalledWith("acme", "ver");
    expect(cargarCopiaDeFecha).not.toHaveBeenCalled();
    expect(validarLote).not.toHaveBeenCalled();
  });
  it("la empresa y el usuario salen de la SESIÓN; empresa_id del cliente se rechaza (esquema estricto)", async () => {
    expect((await post(confirmar, cuerpo({ empresa_id: 99 }))).status).toBe(400);
    expect((await post(confirmar, cuerpo({ empresaId: 99 }))).status).toBe(400);
    expect((await post(confirmar, cuerpo({ filas: [{ ...fila, empresa_id: 99 }] }))).status).toBe(400);
    expect(confirmarLote).not.toHaveBeenCalled();
    const r = await post(confirmar, cuerpo());
    expect(r.status).toBe(200);
    expect(vi.mocked(borradoresDesdeCliente).mock.calls[0][0]).toBe(7);
    expect(vi.mocked(confirmarLote).mock.calls[0].slice(0, 4)).toEqual([7, "jefe", "2026-09-25", { tipo: "COPIA", fechaOrigen: "2026-09-24" }]);
  });
  it("otra empresa: si algún origen no es accesible para la sesión, 400 y no se crea nada", async () => {
    vi.mocked(borradoresDesdeCliente).mockResolvedValue({ ok: false, error: "Algún viaje origen no existe, está cancelado o no pertenece a la fecha/empresa indicada." });
    const r = await post(confirmar, cuerpo());
    expect(r.status).toBe(400);
    expect(confirmarLote).not.toHaveBeenCalled();
  });
});

describe("validación del cuerpo (estricta)", () => {
  it("no admite montos de tarifa ni paradas del cliente; solo tarifaId del catálogo", async () => {
    expect((await post(confirmar, cuerpo({ filas: [{ ...fila, tarifaComercial: 1 }] }))).status).toBe(400);
    expect((await post(confirmar, cuerpo({ filas: [{ ...fila, monto: 1 }] }))).status).toBe(400);
    expect((await post(confirmar, cuerpo({ filas: [{ ...fila, paradas: [] }] }))).status).toBe(400);
    expect((await post(confirmar, cuerpo({ filas: [{ ...fila, tarifaId: 101 }] }))).status).toBe(200);
  });
  it("máximo 8 auxiliares, fechas válidas y distintas, filas 1..200", async () => {
    expect((await post(confirmar, cuerpo({ filas: [{ ...fila, auxiliarEmpleadoIds: [1, 2, 3, 4, 5, 6, 7, 8, 9] }] }))).status).toBe(400);
    expect((await post(confirmar, cuerpo({ fechaDestino: "2026-09-24" }))).status).toBe(400);
    expect((await post(confirmar, cuerpo({ fechaDestino: "25/09/2026" }))).status).toBe(400);
    expect((await post(confirmar, cuerpo({ filas: [] }))).status).toBe(400);
    expect((await post(confirmar, cuerpo({ filas: Array.from({ length: 201 }, (_, i) => ({ ...fila, fila: i + 1 })) }))).status).toBe(400);
    expect((await post(confirmar, cuerpo({ filas: [{ ...fila, auxiliarEmpleadoIds: [1, 2, 3, 4, 5, 6, 7, 8] }] }))).status).toBe(200);
  });
  it("cuerpo no JSON -> 400", async () => {
    expect((await confirmar(new Request("http://x/api", { method: "POST", body: "no json" }), ctx)).status).toBe(400);
  });
  it("GET: fechas inválidas o iguales -> 400", async () => {
    expect((await cargar(new Request("http://x/api?fechaOrigen=x&fechaDestino=2026-09-25"), ctx)).status).toBe(400);
    expect((await cargar(new Request("http://x/api?fechaOrigen=2026-09-25&fechaDestino=2026-09-25"), ctx)).status).toBe(400);
  });
});

describe("respuestas", () => {
  it("cargar: NO guarda nada (solo lectura); devuelve filas con su validación y catálogos", async () => {
    const r = await cargar(new Request("http://x/api?fechaOrigen=2026-09-24&fechaDestino=2026-09-25"), ctx);
    const data = await r.json();
    expect(data.filas[0]).toMatchObject({ validacion: { estado: "ok" } });
    expect(data.catalogos).toBeDefined();
    expect(confirmarLote).not.toHaveBeenCalled();
    expect(vi.mocked(cargarCopiaDeFecha).mock.calls[0]).toEqual([7, "2026-09-24"]);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("confirmar propaga el status y los errores por fila del motor (todo o nada)", async () => {
    vi.mocked(confirmarLote).mockResolvedValue({ ok: false, status: 409, error: "1 de 1 fila(s) no pasaron la validación.", erroresPorFila: [{ fila: 1, errores: ["El piloto X ya está asignado"] }] });
    const r = await post(confirmar, cuerpo());
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ erroresPorFila: [{ fila: 1 }] });
  });
  it("confirmar ok devuelve cantidad y códigos", async () => {
    expect(await (await post(confirmar, cuerpo())).json()).toEqual({ creados: 1, planIds: [1000], codigos: ["PLAN-1"] });
  });
  it("validar devuelve la validación por fila", async () => {
    expect(await (await post(validar, cuerpo())).json()).toEqual({ validacion: [{ fila: 1, estado: "ok", errores: [], tarifa: null }] });
  });
});
