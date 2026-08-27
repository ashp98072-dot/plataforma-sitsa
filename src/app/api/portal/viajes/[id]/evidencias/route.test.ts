import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ obtenerEmpleado: vi.fn() }));
vi.mock("@/lib/rrhh/dates", () => ({ ahoraLocal: vi.fn(() => "2026-08-27 10:00:00") }));
vi.mock("@/lib/flota/viajes-piloto", () => ({ colaboradorParticipaEnViaje: vi.fn() }));
vi.mock("@/lib/flota/viaje-evidencias", () => ({
  guardarEvidenciaViaje: vi.fn(() => Promise.resolve(1)),
  listarEvidenciasViaje: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/lib/tms/paradas", () => ({ validarParadaDelPlan: vi.fn() }));
// ÚLTIMA CORRECCIÓN P1 (unificación de autoridad de vínculo): el
// auto-vínculo ya NO escribe SQL propio aquí — delega TODA la decisión
// (exclusividad, transacción, backfill) a la misma autoridad que usa el
// vínculo administrativo manual.
vi.mock("@/lib/tms/vincular-viaje-plan", () => ({
  buscarPlanCandidatoUnicoParaViaje: vi.fn(),
  vincularViajeAPlan: vi.fn(),
}));
vi.mock("@/lib/uploads", () => ({
  absPathFromRelative: vi.fn((p: string) => p),
  contentTypeFor: vi.fn(() => "image/jpeg"),
}));

import { query } from "@/lib/db";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import { guardarEvidenciaViaje } from "@/lib/flota/viaje-evidencias";
import { validarParadaDelPlan } from "@/lib/tms/paradas";
import { buscarPlanCandidatoUnicoParaViaje, vincularViajeAPlan } from "@/lib/tms/vincular-viaje-plan";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ id: "5" }) };

function fotoFormData(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.append("files", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "foto.jpg");
  return form;
}

function req(form: FormData) {
  return new Request("http://localhost/api/portal/viajes/5/evidencias", { method: "POST", body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getColaboradorSession).mockResolvedValue(
    { empresaId: 7, empleadoId: 42 } as Awaited<ReturnType<typeof getColaboradorSession>>,
  );
  vi.mocked(obtenerEmpleado).mockResolvedValue(
    { nombre: "Juan Pérez", codigo: "E001" } as unknown as Awaited<ReturnType<typeof obtenerEmpleado>>,
  );
  vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "abierto" });
  // SELECT odometro_funcional (vehiculo)
  vi.mocked(query).mockResolvedValue([{ odometro_funcional: 1 }] as unknown as Awaited<ReturnType<typeof query>>);
});
afterEach(() => vi.restoreAllMocks());

describe("PORTAL-HARDENING-2 — Fase C: sin orden secuencial, parada elegida libremente", () => {
  it('tipo="producto" con cualquier parada válida del plan (no solo "la siguiente") se acepta', async () => {
    vi.mocked(validarParadaDelPlan).mockResolvedValue({
      id: 3, plan_id: 30, orden: 3, lugar_id: null, lugar_nombre: "MIXCO", tipo: "Entrega",
      requiere_evidencia: true, evidencias: 0,
    });
    const form = fotoFormData({ tipo: "producto", paradaId: "3", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "producto", paradaId: 3, planId: 30, syncTmsTipo: "Producto" }),
    );
  });

  it('tipo="tablero_llegada" ya no exige carga ni paradas completas primero', async () => {
    const form = fotoFormData({ tipo: "tablero_llegada", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "tablero_llegada", syncTmsTipo: "Descarga" }),
    );
  });

  it('tipo="tablero_salida" se acepta sin necesidad de ser la primera evidencia', async () => {
    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "tablero_salida", syncTmsTipo: "Carga" }),
    );
  });
});

describe("PORTAL-HARDENING-2 — Fase D: tipo OTRO soportado; tipo de punto de carga retirado", () => {
  it('tipo="otro" se acepta y sincroniza a TMS como "Otro"', async () => {
    const form = fotoFormData({ tipo: "otro", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "otro", syncTmsTipo: "Otro" }),
    );
  });

  it('tipo="salida" (punto de carga, retirado en Fase B) ya no es un tipo válido', async () => {
    const form = fotoFormData({ tipo: "salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(400);
    expect(guardarEvidenciaViaje).not.toHaveBeenCalled();
  });
});

// ÚLTIMA CORRECCIÓN P1 (unificación de autoridad de vínculo): el
// auto-vínculo del Portal YA NO escribe flota_viajes.plan_id con su propia
// UPDATE — busca un candidato (buscarPlanCandidatoUnicoParaViaje,
// best-effort) y, si hay uno, delega la decisión FINAL a
// vincularViajeAPlan (origen "AUTO_PORTAL") — la MISMA autoridad
// transaccional que usa el vínculo administrativo manual, con la MISMA
// regla de exclusividad "un plan = un solo viaje técnico". Este archivo ya
// no reimplementa ese criterio: solo prueba que el endpoint DELEGA
// correctamente y reacciona bien a cada resultado.
describe("PORTAL-HARDENING-2 (última corrección) — auto-vínculo delega en la misma autoridad transaccional del vínculo manual", () => {
  it("1) candidato único y vincularViajeAPlan confirma el vínculo → sin aviso, evidencia sincroniza al plan", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    vi.mocked(buscarPlanCandidatoUnicoParaViaje).mockResolvedValue(77);
    vi.mocked(vincularViajeAPlan).mockResolvedValue({ ok: true, planCodigo: "PLAN-1", evidenciasSincronizadas: 0 });

    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);

    expect(buscarPlanCandidatoUnicoParaViaje).toHaveBeenCalledWith(7, 5);
    // origen "AUTO_PORTAL" — nunca "MANUAL_OPERACIONES" para algo que
    // decide el propio sistema al subir evidencia.
    expect(vincularViajeAPlan).toHaveBeenCalledWith(7, 77, 5, "portal:E001", "AUTO_PORTAL");
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: 77 }));
    const data = await res.clone().json();
    expect(data.aviso).toBeUndefined();
  });

  it("2) 0/2+ candidatos (buscarPlanCandidatoUnicoParaViaje → null) → NO llama a vincularViajeAPlan; evidencia se guarda con aviso", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    vi.mocked(buscarPlanCandidatoUnicoParaViaje).mockResolvedValue(null);

    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(vincularViajeAPlan).not.toHaveBeenCalled();
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: null }));
    const data = await res.clone().json();
    expect(data.aviso).toContain("Operaciones deberá revisarlo");
  });

  it("3) plan ya vinculado a OTRO viaje técnico (abierto o cerrado) → vincularViajeAPlan devuelve 409, NO vincula, evidencia se guarda con aviso", async () => {
    // Es EXACTAMENTE la misma regla de exclusividad que protege al vínculo
    // manual (src/lib/tms/vincular-viaje-plan.test.ts, casos 6b/6c) — aquí
    // solo se comprueba que el Portal reacciona bien cuando esa MISMA
    // autoridad la rechaza, sin importar si el otro viaje estaba abierto o
    // cerrado (el mensaje es el mismo desde vincularViajeAPlan).
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    vi.mocked(buscarPlanCandidatoUnicoParaViaje).mockResolvedValue(77);
    vi.mocked(vincularViajeAPlan).mockResolvedValue({
      ok: false, error: "Este plan ya está vinculado a otro viaje técnico.", status: 409,
    });

    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: null }));
    const data = await res.clone().json();
    expect(data.aviso).toContain("Operaciones deberá revisarlo");
  });

  it("4) carrera: dos subidas concurrentes intentan el mismo plan — la que pierde recibe 409 de vincularViajeAPlan y no queda vinculada (no duplica asociación)", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    vi.mocked(buscarPlanCandidatoUnicoParaViaje).mockResolvedValue(77);
    vi.mocked(vincularViajeAPlan).mockResolvedValue({
      ok: false, error: "Este viaje ya fue vinculado por otra solicitud. Actualiza la pantalla.", status: 409,
    });

    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: null }));
  });

  it("5) nunca cambia tms_planes_viaje.estado ni flota_viajes.estado: el endpoint no ejecuta ninguna escritura SQL propia para el vínculo (delega todo)", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    vi.mocked(buscarPlanCandidatoUnicoParaViaje).mockResolvedValue(77);
    vi.mocked(vincularViajeAPlan).mockResolvedValue({ ok: true, planCodigo: "PLAN-1", evidenciasSincronizadas: 0 });
    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    await POST(req(form), ctx);
    // El módulo @/lib/db ya no expone `execute` a este archivo — la única
    // vía de escritura de flota_viajes.plan_id es vincularViajeAPlan.
    for (const call of vi.mocked(query).mock.calls) {
      expect(String(call[0])).not.toMatch(/UPDATE|SET\s+estado/i);
    }
  });

  it("6) un error técnico inesperado en el intento de auto-vínculo NO bloquea la subida de evidencia (se guarda con aviso, y queda logueado)", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    vi.mocked(buscarPlanCandidatoUnicoParaViaje).mockRejectedValue(new Error("Conexión perdida"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: null }));
    const data = await res.clone().json();
    expect(data.aviso).toContain("Operaciones deberá revisarlo");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("7) viaje ya con plan_id → no reintenta vincular (ni busca candidato ni llama a vincularViajeAPlan)", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "abierto" });
    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(buscarPlanCandidatoUnicoParaViaje).not.toHaveBeenCalled();
    expect(vincularViajeAPlan).not.toHaveBeenCalled();
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: 30 }));
  });

  it('8) manual (endpoint administrativo) y automático (Portal) comparten la MISMA función vincularViajeAPlan — nunca dos implementaciones de exclusividad', async () => {
    // No es un test de comportamiento nuevo: documenta explícitamente que
    // ambos "orígenes" invocan el mismo símbolo importado desde
    // @/lib/tms/vincular-viaje-plan (ver también
    // api/empresas/[slug]/tms/planes/[id]/vincular-viaje/route.ts, que
    // importa exactamente la misma función).
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    vi.mocked(buscarPlanCandidatoUnicoParaViaje).mockResolvedValue(77);
    vi.mocked(vincularViajeAPlan).mockResolvedValue({ ok: true, planCodigo: "PLAN-1", evidenciasSincronizadas: 0 });
    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    await POST(req(form), ctx);
    const [, , , , origen] = vi.mocked(vincularViajeAPlan).mock.calls[0];
    expect(origen).toBe("AUTO_PORTAL");
  });
});
