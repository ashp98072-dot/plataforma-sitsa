import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import {
  ESTADOS_ASIGNACION_DIARIA,
  listarDisponibilidadProgramacionDia,
  mensajeConflictoProgramacionDia,
  primerConflictoProgramacionDia,
} from "./disponibilidad-programacion-dia";

/**
 * PROGRAMACION-TC-CAJA-REMOLQUE-1 — el TC como cuarto recurso de la reserva
 * diaria. Modelo en memoria de tms_planes_viaje.tc_vehiculo_id sobre el que
 * responde la consulta REAL (`FROM flota_vehiculos v INNER JOIN
 * tms_planes_viaje p ON p.tc_vehiculo_id = v.id`).
 */
type Plan = { plan_id: number; codigo: string; empresa_id: number; fecha: string; estado: string; tc: number; placa: string };
let planes: Plan[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  planes = [
    { plan_id: 125, codigo: "PLAN-000125", empresa_id: 7, fecha: "2026-09-23", estado: "Programado", tc: 45, placa: "TC-045" },
  ];
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
    if (!String(sql).includes("FROM flota_vehiculos v")) return [];
    const ids = (params as unknown[]).slice(2 + ESTADOS_ASIGNACION_DIARIA.length).filter((v): v is number => typeof v === "number");
    const excluido = String(sql).includes("AND p.id != ?") ? ids.pop() : null;
    const filtraIds = String(sql).includes("AND v.id IN");
    return planes
      .filter((p) => p.empresa_id === params[0] && p.fecha === params[1] && ESTADOS_ASIGNACION_DIARIA.includes(p.estado as never)
        && (!filtraIds || ids.includes(p.tc)) && (excluido == null || p.plan_id !== excluido))
      .map((p) => ({ recurso_id: p.tc, nombre: p.placa, plan_id: p.plan_id, codigo: p.codigo, fecha: p.fecha }));
  }) as never);
});

const tc = (id = 45) => ({ tipo: "tc" as const, id });

describe("primerConflictoProgramacionDia — TC", () => {
  it("mismo TC, misma fecha -> conflicto, con el mensaje 'El TC … ya está asignado al …'", async () => {
    const c = await primerConflictoProgramacionDia(7, [tc()], "2026-09-23", null);
    expect(c).toMatchObject({ tipo: "tc", id: 45, nombre: "TC-045", codigoConflicto: "PLAN-000125" });
    expect(mensajeConflictoProgramacionDia(c!)).toBe("El TC TC-045 ya está asignado al PLAN-000125 para el 23/09/2026.");
  });

  it("mismo TC, día siguiente -> disponible", async () => {
    expect(await primerConflictoProgramacionDia(7, [tc()], "2026-09-24", null)).toBeNull();
  });

  it("otro TC el mismo día -> disponible", async () => {
    expect(await primerConflictoProgramacionDia(7, [tc(46)], "2026-09-23", null)).toBeNull();
  });

  it.each(["Programado", "Cargado", "En ruta", "Descargado", "Cerrado"])(
    "un plan %s ocupa el TC toda su fecha (aunque no esté cerrado administrativamente, y también después de cerrar)",
    async (estado) => {
      planes[0].estado = estado;
      expect(await primerConflictoProgramacionDia(7, [tc()], "2026-09-23", null)).not.toBeNull();
    },
  );

  it("un plan Cancelado libera el TC", async () => {
    planes[0].estado = "Cancelado";
    expect(await primerConflictoProgramacionDia(7, [tc()], "2026-09-23", null)).toBeNull();
  });

  it("edición: el propio plan se autoexcluye (excluirPlanId), otro plan no", async () => {
    expect(await primerConflictoProgramacionDia(7, [tc()], "2026-09-23", 125)).toBeNull();
    expect(await primerConflictoProgramacionDia(7, [tc()], "2026-09-23", 999)).not.toBeNull();
  });

  it("aislamiento por empresa: el plan de otra empresa no bloquea", async () => {
    planes[0].empresa_id = 8;
    expect(await primerConflictoProgramacionDia(7, [tc()], "2026-09-23", null)).toBeNull();
    expect(vi.mocked(query).mock.calls.every(([, p]) => (p as unknown[])[0] === 7)).toBe(true);
  });

  it("una sola consulta para el TC; con piloto+unidad+TC son tres consultas máximo", async () => {
    await primerConflictoProgramacionDia(7, [tc()], "2026-09-23", null);
    expect(query).toHaveBeenCalledTimes(1);
    vi.mocked(query).mockClear();
    await primerConflictoProgramacionDia(7, [{ tipo: "piloto", id: 1 }, { tipo: "unidad", id: 2 }, tc()], "2026-09-23", null);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("un id de TC nunca se confunde con un id de personal/unidad (cada tipo usa su propia consulta)", async () => {
    const c = await primerConflictoProgramacionDia(7, [{ tipo: "unidad", id: 45 }], "2026-09-23", null);
    expect(c).toBeNull();
  });

  it("los mensajes de piloto/auxiliar/unidad no cambian", () => {
    const base = { id: 1, nombre: "X", planIdConflicto: 1, codigoConflicto: "PLAN-1", fechaConflicto: "2026-09-23" };
    expect(mensajeConflictoProgramacionDia({ ...base, tipo: "unidad", nombre: "C-1" })).toBe("La unidad C-1 ya está asignada al PLAN-1 para el 23/09/2026.");
    expect(mensajeConflictoProgramacionDia({ ...base, tipo: "piloto", nombre: "Juan" })).toBe("El piloto Juan ya está asignado al PLAN-1 para el 23/09/2026.");
    expect(mensajeConflictoProgramacionDia({ ...base, tipo: "auxiliar", nombre: "Ana" })).toBe("El auxiliar Ana ya está asignado al PLAN-1 para el 23/09/2026.");
  });
});

describe("listarDisponibilidadProgramacionDia — mapa de TC para el selector", () => {
  it("devuelve `tcs` por placa en mayúsculas, aparte de personal/unidades (nunca mezclado)", async () => {
    const r = await listarDisponibilidadProgramacionDia(7, "2026-09-23", null);
    expect(r.tcs.get("TC-045")).toMatchObject({ planId: 125, planCodigo: "PLAN-000125" });
    expect(r.unidades.size).toBe(0);
    expect(r.personal.size).toBe(0);
  });

  it("otro día -> vacío; edición excluye su propio plan", async () => {
    expect((await listarDisponibilidadProgramacionDia(7, "2026-09-24", null)).tcs.size).toBe(0);
    expect((await listarDisponibilidadProgramacionDia(7, "2026-09-23", 125)).tcs.size).toBe(0);
  });

  it("si la columna tc_vehiculo_id aún no existe (migración sin aplicar) NO rompe piloto/auxiliar/unidad: devuelve TC vacío", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (String(sql).includes("FROM flota_vehiculos v")) throw new Error("Unknown column 'p.tc_vehiculo_id'");
      return [];
    }) as never);
    const r = await listarDisponibilidadProgramacionDia(7, "2026-09-23", null);
    expect(r.tcs.size).toBe(0);
    expect(r.personal.size).toBe(0);
  });
});
