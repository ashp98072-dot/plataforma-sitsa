import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ obtenerEmpleado: vi.fn() }));
vi.mock("@/lib/flota/viajes-piloto", () => ({ colaboradorParticipaEnViaje: vi.fn() }));
vi.mock("@/lib/tms/parada-confirmacion", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tms/parada-confirmacion")>();
  return { ...real, confirmarParadaPorPiloto: vi.fn(), listarConfirmacionesPlan: vi.fn() };
});

import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import { confirmarParadaPorPiloto, listarConfirmacionesPlan } from "@/lib/tms/parada-confirmacion";
import { GET, POST } from "./route";

// El dominio está mockeado: aquí solo se prueba la ruta (sesión, pertenencia al viaje, validación del cuerpo y traducción de resultados). Las reglas viven en parada-confirmacion.test.ts.
const ctx = (id = "900", paradaId = "10") => ({ params: Promise.resolve({ id, paradaId }) });
const post = (body: unknown, raw = false) => new Request("https://x.invalid/api", { method: "POST", body: raw ? String(body) : JSON.stringify(body) });
const okConf = { id: 5, planId: 55, paradaId: 10, resultado: "ENTREGADA_POR_PILOTO", revision: "NO_REQUERIDA", pilotoUsuario: "portal:P01", confirmadoEn: "2026-11-11 10:00:00", evidenciaId: 77, nota: null, recepcionOficial: "NO_ACEPTADA_POR_PRICESMART", estadoExternoPublicado: false };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getColaboradorSession).mockResolvedValue({ empresaId: 7, empleadoId: 31 } as never);
  vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 900, planId: 55, estado: "abierto" });
  vi.mocked(obtenerEmpleado).mockResolvedValue({ codigo: "P01", nombre: "Piloto Uno" } as never);
  vi.mocked(confirmarParadaPorPiloto).mockResolvedValue({ ok: true, replayed: false, confirmacion: okConf } as never);
});

describe("POST /api/portal/viajes/[id]/paradas/[paradaId]/confirmar", () => {
  it("401 sin sesión del colaborador; no consulta nada más", async () => {
    vi.mocked(getColaboradorSession).mockResolvedValue(null as never);
    expect((await POST(post({ resultado: "ENTREGADA_POR_PILOTO" }), ctx())).status).toBe(401); expect(colaboradorParticipaEnViaje).not.toHaveBeenCalled(); expect(confirmarParadaPorPiloto).not.toHaveBeenCalled();
  });
  it("403 si no participa en el viaje; 409 si el viaje no está vinculado a un plan", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue(null);
    expect((await POST(post({ resultado: "ENTREGADA_POR_PILOTO" }), ctx())).status).toBe(403);
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 900, planId: null, estado: "abierto" });
    expect((await POST(post({ resultado: "ENTREGADA_POR_PILOTO" }), ctx())).status).toBe(409); expect(confirmarParadaPorPiloto).not.toHaveBeenCalled();
  });
  it.each([["abc", "10"], ["900", "0"], ["-1", "10"], ["900", "1.5"], ["", "10"]])("404 con identificadores inválidos (%s, %s)", async (id, paradaId) => {
    expect((await POST(post({ resultado: "ENTREGADA_POR_PILOTO" }), ctx(id, paradaId))).status).toBe(404); expect(confirmarParadaPorPiloto).not.toHaveBeenCalled();
  });
  it.each([[{}], [{ resultado: "OTRO" }], [{ resultado: "ENTREGADA_POR_PILOTO", empresaId: 9 }], [{ resultado: "ENTREGADA_POR_PILOTO", pilotoId: 1 }], [{ resultado: "ENTREGADA_POR_PILOTO", evidenciaId: -3 }], [{ resultado: "PARCIAL", nota: "x".repeat(501) }]])("400 con cuerpo inválido %j", async (body) => {
    expect((await POST(post(body), ctx())).status).toBe(400); expect(confirmarParadaPorPiloto).not.toHaveBeenCalled();
  });
  it("400 con JSON ilegible", async () => { expect((await POST(post("{no", true), ctx())).status).toBe(400); });
  it("201 al confirmar: empresa, empleado, usuario, viaje y plan salen de la sesión y del vínculo, nunca del cuerpo", async () => {
    const res = await POST(post({ resultado: "ENTREGADA_POR_PILOTO", evidenciaId: 77 }), ctx());
    expect(res.status).toBe(201); const json = await res.json(); expect(json.confirmacion).toMatchObject({ id: 5, recepcionOficial: "NO_ACEPTADA_POR_PRICESMART", estadoExternoPublicado: false }); expect(json.replayed).toBe(false);
    expect(confirmarParadaPorPiloto).toHaveBeenCalledWith({ empresaId: 7, empleadoId: 31, usuario: "portal:P01", viajeId: 900, planId: 55, paradaId: 10, body: { resultado: "ENTREGADA_POR_PILOTO", evidenciaId: 77 } });
  });
  it("200 en un reintento idéntico (replayed)", async () => {
    vi.mocked(confirmarParadaPorPiloto).mockResolvedValue({ ok: true, replayed: true, confirmacion: okConf } as never);
    const res = await POST(post({ resultado: "ENTREGADA_POR_PILOTO" }), ctx()); expect(res.status).toBe(200); expect((await res.json()).replayed).toBe(true);
  });
  it.each([["NO_ASIGNADO", 403], ["PARADA_INVALIDA", 404], ["SIN_EVIDENCIA", 409], ["YA_CONFIRMADA", 409], ["REVISION_PENDIENTE", 409], ["NO_DISPONIBLE", 503]])("traduce el rechazo %s a HTTP %i con su código", async (codigo, status) => {
    vi.mocked(confirmarParadaPorPiloto).mockResolvedValue({ ok: false, codigo, status, mensaje: "msg" } as never);
    const res = await POST(post({ resultado: "ENTREGADA_POR_PILOTO" }), ctx()); expect(res.status).toBe(status); expect(await res.json()).toEqual({ error: "msg", codigo });
  });
});

describe("fallos de infraestructura (503 reintentable, nunca un 403 engañoso)", () => {
  it("si la consulta de participación falla, se PROPAGA el error y responde 503 REINTENTAR (no «no estás asignado»)", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockRejectedValue(new Error("No se pudo conectar a la base sandbox."));
    const res = await POST(post({ resultado: "ENTREGADA_POR_PILOTO" }), ctx()); expect(res.status).toBe(503); expect((await res.json()).codigo).toBe("REINTENTAR");
    expect(colaboradorParticipaEnViaje).toHaveBeenCalledWith(7, 31, 900, { propagarErrores: true }); expect(confirmarParadaPorPiloto).not.toHaveBeenCalled();
    const g = await GET(new Request("https://x.invalid/api"), ctx()); expect(g.status).toBe(503);
  });
  it("si el dominio lanza un error inesperado responde 503 REINTENTAR sin filtrar el mensaje", async () => {
    vi.mocked(confirmarParadaPorPiloto).mockRejectedValue(new Error("SQL secreto: password=x"));
    const res = await POST(post({ resultado: "ENTREGADA_POR_PILOTO" }), ctx()); expect(res.status).toBe(503); expect(JSON.stringify(await res.json())).not.toMatch(/secreto|password/);
  });
});

describe("GET: historial de la parada", () => {
  it("devuelve solo las confirmaciones de ESA parada del plan del viaje del colaborador", async () => {
    vi.mocked(listarConfirmacionesPlan).mockResolvedValue([okConf, { ...okConf, id: 6, paradaId: 11 }] as never);
    const res = await GET(new Request("https://x.invalid/api"), ctx()); expect(res.status).toBe(200);
    expect((await res.json()).confirmaciones.map((c: { id: number }) => c.id)).toEqual([5]); expect(listarConfirmacionesPlan).toHaveBeenCalledWith(7, 55);
  });
  it("401/403 igual que el POST", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue(null);
    expect((await GET(new Request("https://x.invalid/api"), ctx())).status).toBe(403);
    vi.mocked(getColaboradorSession).mockResolvedValue(null as never);
    expect((await GET(new Request("https://x.invalid/api"), ctx())).status).toBe(401);
  });
});
