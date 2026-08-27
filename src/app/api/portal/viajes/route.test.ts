import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  execute: vi.fn(),
  getPool: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ obtenerEmpleado: vi.fn() }));
vi.mock("@/lib/rrhh/dates", () => ({ ahoraLocal: vi.fn(() => "2026-08-27 10:00:00") }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn() }));
vi.mock("@/lib/flota/km-vehiculo", () => ({ actualizarKmActualVehiculo: vi.fn() }));
vi.mock("@/lib/flota/pilotos", () => ({
  normalizarNombrePiloto: vi.fn((s: string) => s),
  obtenerPersonalOperativoDeEmpleado: vi.fn(),
  vehiculoPorPlaca: vi.fn(),
}));
vi.mock("@/lib/flota/viajes-piloto", () => ({ colaboradorParticipaEnViaje: vi.fn() }));
vi.mock("@/lib/tms/planes-salida", () => ({
  buscarPlanesParaSalida: vi.fn(() => Promise.resolve([])),
  marcarPlanEnRuta: vi.fn(),
}));
vi.mock("@/lib/tms/paradas", () => ({ paradasPendientesEvidencia: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/tms/unidad-flota", () => ({ resolverVehiculoDeUnidadTms: vi.fn() }));
vi.mock("@/lib/rrhh/geocerca", () => ({ validarGeocercaKiosko: vi.fn(() => Promise.resolve({ ok: true })) }));

import { execute, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { obtenerPersonalOperativoDeEmpleado } from "@/lib/flota/pilotos";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/portal/viajes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getColaboradorSession).mockResolvedValue(
    { empresaId: 7, empleadoId: 42 } as Awaited<ReturnType<typeof getColaboradorSession>>,
  );
  vi.mocked(obtenerPersonalOperativoDeEmpleado).mockResolvedValue(
    { id: 1, tipo: "Piloto", nombre: "Juan" } as Awaited<ReturnType<typeof obtenerPersonalOperativoDeEmpleado>>,
  );
  vi.mocked(obtenerEmpleado).mockResolvedValue(
    { nombre: "Juan Pérez", codigo: "E001" } as unknown as Awaited<ReturnType<typeof obtenerEmpleado>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("PORTAL-HARDENING-2 — Fase B: eliminación de kmCarga del flujo Portal", () => {
  it('accion="carga" ya no existe: responde 400 "Acción inválida."', async () => {
    const res = await POST(req({ accion: "carga", viajeId: 1, kmCarga: 100 }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Acción inválida.");
  });
});

describe("PORTAL-HARDENING-2 — Fase F: piloto ya no cierra/cancela el plan", () => {
  it('accion="contratiempo" exige motivo de al menos 10 caracteres', async () => {
    const res = await POST(req({ accion: "contratiempo", viajeId: 5, motivo: "corto" }));
    expect(res.status).toBe(400);
    expect(colaboradorParticipaEnViaje).not.toHaveBeenCalled();
  });

  it('el body de "llegada" ya no acepta cierreExcepcional/motivoExcepcional como mecanismo de cierre (campos ignorados por el schema, sin efecto)', async () => {
    // Viaje inexistente para este piloto → 404 antes de llegar a cualquier
    // lógica de excepcional, confirmando que no hay una rama especial que
    // dependa de esos campos para saltarse validaciones.
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    const res = await POST(req({
      accion: "llegada",
      viajeId: 1,
      cierreExcepcional: true,
      motivoExcepcional: "Cualquier motivo",
    }));
    expect(res.status).toBe(404);
  });
});

// CORRECCIÓN PR #107 (HALLAZGO 2): contratiempo debe autorizar al piloto Y
// al auxiliar REALMENTE asignados al viaje (colaboradorParticipaEnViaje),
// nunca a un colaborador ajeno — y nunca debe tocar flota_viajes.estado ni
// tms_planes_viaje.estado (ambos solo se mutan vía `execute`, así que basta
// con comprobar que `execute` nunca se llama).
describe("PORTAL-HARDENING-2 (HALLAZGO 2) — contratiempo: piloto Y auxiliar asignados, nunca cambia estado", () => {
  it("1) piloto participante → permitido, registra auditoría", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "abierto" });
    vi.mocked(query).mockResolvedValueOnce([{ placa: "C-034BXR" }] as unknown as Awaited<ReturnType<typeof query>>);

    const res = await POST(req({ accion: "contratiempo", viajeId: 5, motivo: "Avería de la unidad en ruta" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mensaje).toContain("Contratiempo registrado");
    expect(colaboradorParticipaEnViaje).toHaveBeenCalledWith(7, 42, 5);
    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
    const call = vi.mocked(registrarAuditoria).mock.calls[0][0];
    expect(call.accion).toBe("reportar_contratiempo");
    expect(call.detalle).toContain("Avería de la unidad en ruta");
  });

  it("2) auxiliar participante → permitido (mismo contrato que el piloto)", async () => {
    vi.mocked(obtenerPersonalOperativoDeEmpleado).mockResolvedValue(
      { id: 2, tipo: "Auxiliar", nombre: "Carlos" } as Awaited<ReturnType<typeof obtenerPersonalOperativoDeEmpleado>>,
    );
    vi.mocked(obtenerEmpleado).mockResolvedValue(
      { nombre: "Carlos Ruiz", codigo: "E002" } as unknown as Awaited<ReturnType<typeof obtenerEmpleado>>,
    );
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "abierto" });
    vi.mocked(query).mockResolvedValueOnce([{ placa: "C-034BXR" }] as unknown as Awaited<ReturnType<typeof query>>);

    const res = await POST(req({ accion: "contratiempo", viajeId: 5, motivo: "Avería de la unidad en ruta" }));
    expect(res.status).toBe(200);
    const call = vi.mocked(registrarAuditoria).mock.calls[0][0];
    expect(call.detalle).toContain("auxiliar Carlos Ruiz");
  });

  it("3) colaborador ajeno al viaje → 404, sin auditoría", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue(null);
    const res = await POST(req({ accion: "contratiempo", viajeId: 999, motivo: "Avería de la unidad en ruta" }));
    expect(res.status).toBe(404);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("4) nunca cambia tms_planes_viaje.estado / 5) nunca cambia flota_viajes.estado (ninguna escritura vía execute)", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "abierto" });
    vi.mocked(query).mockResolvedValueOnce([{ placa: "C-034BXR" }] as unknown as Awaited<ReturnType<typeof query>>);
    const res = await POST(req({ accion: "contratiempo", viajeId: 5, motivo: "Avería de la unidad en ruta" }));
    expect(res.status).toBe(200);
    expect(execute).not.toHaveBeenCalled();
  });
});
