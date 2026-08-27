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
vi.mock("@/lib/uploads", () => ({
  absPathFromRelative: vi.fn((p: string) => p),
  contentTypeFor: vi.fn(() => "image/jpeg"),
}));

import { execute, query } from "@/lib/db";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import { guardarEvidenciaViaje } from "@/lib/flota/viaje-evidencias";
import { validarParadaDelPlan } from "@/lib/tms/paradas";
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
  vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as unknown as Awaited<ReturnType<typeof execute>>);
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

// CORRECCIÓN PR #107 (HALLAZGO 1): el auto-vínculo YA NO usa la heurística
// débil de buscarPlanesParaSalida (nombre normalizado + placa normalizada,
// "hoy") — usa una consulta ESTRICTA sobre datos ya existentes: mismo
// piloto por id_empleado, misma unidad por flota_vehiculo_id, misma fecha
// del plan (= fecha real del viaje, no "hoy"), estado operativo compatible,
// y exactamente un resultado.
describe("PORTAL-HARDENING-2 (HALLAZGO 1) — auto-vínculo de plan solo con coincidencia estricta y verificable", () => {
  function mockViajeInfo() {
    // 1ª query(): datos reales del viaje (empleado_id/vehiculo_id/hora_salida)
    vi.mocked(query).mockResolvedValueOnce(
      [{ empleado_id: 9, vehiculo_id: 15, hora_salida: "2026-08-27 07:00:00" }] as unknown as Awaited<ReturnType<typeof query>>,
    );
  }

  it("1) candidato fuerte único (piloto+unidad+fecha+estado coinciden) → vincula", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    mockViajeInfo();
    // 2ª query(): candidatos estrictos → exactamente uno
    vi.mocked(query).mockResolvedValueOnce([{ id: 77 }] as unknown as Awaited<ReturnType<typeof query>>);

    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);

    // Confirma que la consulta de candidatos exige TODOS los criterios
    // estrictos (piloto por id_empleado, unidad por flota_vehiculo_id,
    // misma fecha del viaje) — no una heurística de texto.
    const candidatosCall = vi.mocked(query).mock.calls[1];
    expect(candidatosCall[0]).toContain("pil.id_empleado = ?");
    expect(candidatosCall[0]).toContain("u.flota_vehiculo_id = ?");
    expect(candidatosCall[0]).toContain("p.fecha_plan = ?");
    expect(candidatosCall[1]).toEqual([7, 9, 15, "2026-08-27"]);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE flota_viajes SET plan_id"),
      [77, 5, 7],
    );
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: 77 }));
    const data = await res.clone().json();
    expect(data.aviso).toBeUndefined();
  });

  it("2) 0 candidatos → NO vincula; evidencia se guarda igual, con aviso para Operaciones", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    mockViajeInfo();
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);

    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(execute).not.toHaveBeenCalled();
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: null }));
    const data = await res.clone().json();
    expect(data.aviso).toContain("Operaciones debe revisar y vincular el plan manualmente");
  });

  it("3) 2+ candidatos (ambigüedad real) → NO vincula, con aviso", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    mockViajeInfo();
    vi.mocked(query).mockResolvedValueOnce(
      [{ id: 77 }, { id: 78 }] as unknown as Awaited<ReturnType<typeof query>>,
    );

    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    expect(execute).not.toHaveBeenCalled();
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: null }));
  });

  it("4) candidato único pero incompatible en piloto/unidad/fecha (la consulta estricta no lo devuelve) → NO vincula", async () => {
    // La consulta ya filtra por id_empleado + flota_vehiculo_id + fecha_plan
    // en el propio SQL — un "candidato" que no cumpla los tres no puede
    // aparecer en el resultado. Se simula ese caso real (0 filas) para
    // distinguirlo explícitamente del caso 2 (ambigüedad) en el reporte.
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: null, estado: "abierto" });
    mockViajeInfo();
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);

    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    const candidatosCall = vi.mocked(query).mock.calls[1];
    // La query en sí exige coincidencia exacta de piloto/unidad/fecha —
    // por eso un plan con cualquiera de esos tres distinto nunca se cuela.
    expect(candidatosCall[1]).toEqual([7, 9, 15, "2026-08-27"]);
    expect(execute).not.toHaveBeenCalled();
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: null }));
  });

  it("5) viaje ya con plan_id → no reintenta vincular (ni siquiera consulta candidatos)", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "abierto" });
    const form = fotoFormData({ tipo: "tablero_salida", latitud: "14.6", longitud: "-90.5" });
    const res = await POST(req(form), ctx);
    expect(res.status).toBe(200);
    // Única query() esperada: la del vehículo (odometro_funcional) — nunca
    // viajeInfo ni candidatos.
    expect(query).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(guardarEvidenciaViaje).toHaveBeenCalledWith(expect.objectContaining({ planId: 30 }));
  });
});
