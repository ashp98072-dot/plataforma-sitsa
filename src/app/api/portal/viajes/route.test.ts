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
  it('accion="contratiempo" registra auditoría y NO ejecuta ningún UPDATE (no cambia estado)', async () => {
    vi.mocked(query).mockResolvedValueOnce([
      { id: 5, estado: "abierto", placa: "C-034BXR" },
    ] as unknown as Awaited<ReturnType<typeof query>>);

    const res = await POST(req({ accion: "contratiempo", viajeId: 5, motivo: "Avería de la unidad en ruta" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mensaje).toContain("Contratiempo registrado");

    expect(execute).not.toHaveBeenCalled();
    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
    const call = vi.mocked(registrarAuditoria).mock.calls[0][0];
    expect(call.accion).toBe("reportar_contratiempo");
    expect(call.detalle).toContain("Avería de la unidad en ruta");
  });

  it('accion="contratiempo" exige motivo de al menos 10 caracteres', async () => {
    const res = await POST(req({ accion: "contratiempo", viajeId: 5, motivo: "corto" }));
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('accion="contratiempo" solo permite reportar el PROPIO viaje (nunca el de otro piloto)', async () => {
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    const res = await POST(req({ accion: "contratiempo", viajeId: 999, motivo: "Avería de la unidad en ruta" }));
    expect(res.status).toBe(404);
    expect(registrarAuditoria).not.toHaveBeenCalled();
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
