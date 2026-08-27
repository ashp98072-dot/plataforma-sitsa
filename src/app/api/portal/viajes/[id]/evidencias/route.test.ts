import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn() }));
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
vi.mock("@/lib/tms/planes-salida", () => ({ buscarPlanesParaSalida: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/uploads", () => ({
  absPathFromRelative: vi.fn((p: string) => p),
  contentTypeFor: vi.fn(() => "image/jpeg"),
}));

import { execute, query } from "@/lib/db";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import { guardarEvidenciaViaje } from "@/lib/flota/viaje-evidencias";
import { validarParadaDelPlan } from "@/lib/tms/paradas";
import { buscarPlanesParaSalida } from "@/lib/tms/planes-salida";
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

describe("PORTAL-HARDENING-2 — Fase E: auto-vínculo de plan cuando el viaje quedó sin plan_id", () => {
  it("si el viaje no tiene plan vinculado pero ya hay un único candidato, se vincula y la evidencia sincroniza a TMS", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    vi.mocked(query)
      .mockResolvedValueOnce([{ piloto_nombre: "Juan Pérez", placa: "C-034BXR" }] as unknown as Awaited<ReturnType<typeof query>>) // viajeInfo
      .mockResolvedValueOnce([{ odometro_funcional: 1 }] as unknown as Awaited<ReturnType<typeof query>>); // vehiculo lookup
    vi.mocked(buscarPlanesParaSalida).mockResolvedValue([
      { id: 77, codigo: "PLAN-1", fecha_plan: "2026-08-27", hora_carga: null, tipo_traslado: null, notas: null, placa: "C-034BXR", piloto: "Juan Pérez", cliente: null, lugar_carga: null, lugar_descarga: null, estado: "Programado", auxiliares: [], paradas: [] },
    ]);
    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE flota_viajes SET plan_id"),
      [77, 5, 7],
    );
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: 77 }));
  });

  it("si sigue habiendo ambigüedad (0 o 2+ candidatos), no se vincula y la evidencia se guarda sin sincronizar a TMS", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    vi.mocked(query)
      .mockResolvedValueOnce([{ piloto_nombre: "Juan Pérez", placa: "C-034BXR" }] as unknown as Awaited<ReturnType<typeof query>>)
      .mockResolvedValueOnce([{ odometro_funcional: 1 }] as unknown as Awaited<ReturnType<typeof query>>);
    vi.mocked(buscarPlanesParaSalida).mockResolvedValue([]);
    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(execute).not.toHaveBeenCalled();
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: null }));
  });
});
