import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import {
  ESTADOS_ASIGNACION_DIARIA, listarDisponibilidadProgramacionDia,
  mensajeConflictoProgramacionDia, primerConflictoProgramacionDia,
} from "./disponibilidad-programacion-dia";

type Fila = { recurso_id: number; id_empleado?: number; nombre: string; plan_id: number; codigo: string; fecha: string; estado: string; empresa_id: number };
const filas: Fila[] = [
  { recurso_id: 10, id_empleado: 101, nombre: "Juan Pérez", plan_id: 100, codigo: "PLAN-100", fecha: "2026-09-23", estado: "Descargado", empresa_id: 7 },
  { recurso_id: 20, id_empleado: 102, nombre: "Pedro López", plan_id: 100, codigo: "PLAN-100", fecha: "2026-09-23", estado: "Descargado", empresa_id: 7 },
  { recurso_id: 50, nombre: "C-987CBV", plan_id: 100, codigo: "PLAN-100", fecha: "2026-09-23", estado: "Descargado", empresa_id: 7 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(query).mockImplementation(async (sql, params) => {
    const personal = String(sql).includes("FROM tms_personal tp");
    const recurso = String(sql).includes("FROM tms_unidades u");
    if (!personal && !recurso) throw new Error("Consulta inesperada");
    const p = params as unknown[];
    const ids = p.slice(2 + ESTADOS_ASIGNACION_DIARIA.length).filter((v): v is number => typeof v === "number");
    const excluido = String(sql).includes("AND p.id != ?") ? ids.pop() : null;
    return filas.filter((r) => r.empresa_id === p[0] && r.fecha === p[1]
      && ESTADOS_ASIGNACION_DIARIA.includes(r.estado as typeof ESTADOS_ASIGNACION_DIARIA[number])
      && (personal ? r.id_empleado != null : r.id_empleado == null)
      && (excluido == null || r.plan_id !== excluido)
      && (!String(sql).includes("AND tp.id IN") && !String(sql).includes("AND u.id IN") || ids.includes(r.recurso_id))) as never;
  });
});

describe("Disponibilidad diaria de Programación", () => {
  const recursos = [{ tipo: "piloto" as const, id: 10 }, { tipo: "auxiliar" as const, id: 20 }, { tipo: "unidad" as const, id: 50 }];

  it("plan Descargado sin cierre del 23: los tres recursos están disponibles el 24", async () => {
    expect(await primerConflictoProgramacionDia(7, recursos, "2026-09-24", null)).toBeNull();
    const lista = await listarDisponibilidadProgramacionDia(7, "2026-09-24", null);
    expect(lista.personal.size).toBe(0);
    expect(lista.unidades.size).toBe(0);
  });

  it.each(recursos)("%s: mismo día bloquea aunque cambie la hora", async (recurso) => {
    const conflicto = await primerConflictoProgramacionDia(7, [recurso], "2026-09-23", null);
    expect(conflicto?.codigoConflicto).toBe("PLAN-100");
    expect(mensajeConflictoProgramacionDia(conflicto!)).toContain("23/09/2026");
    const llamadas = vi.mocked(query).mock.calls;
    expect(llamadas.length).toBe(1);
    expect(String(llamadas[0][0])).toContain("p.fecha_plan = ?");
    expect(String(llamadas[0][0])).not.toContain("regreso_estimado");
  });

  it("dos consultas máximas para tres recursos, con tenant del servidor", async () => {
    await primerConflictoProgramacionDia(7, recursos, "2026-09-23", null);
    expect(query).toHaveBeenCalledTimes(2);
    expect(vi.mocked(query).mock.calls.every(([, params]) => params?.[0] === 7)).toBe(true);
    expect(await primerConflictoProgramacionDia(8, recursos, "2026-09-23", null)).toBeNull();
  });

  it("selector devuelve ocupación por empleado/placa, no por rol; dos queries", async () => {
    const r = await listarDisponibilidadProgramacionDia(7, "2026-09-23", null);
    expect(r.personal.get(101)?.planCodigo).toBe("PLAN-100");
    expect(r.personal.get(102)?.planCodigo).toBe("PLAN-100");
    expect(r.unidades.get("C-987CBV")?.planCodigo).toBe("PLAN-100");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("edición excluye su propio plan", async () => {
    expect(await primerConflictoProgramacionDia(7, recursos, "2026-09-23", 100)).toBeNull();
    expect((await listarDisponibilidadProgramacionDia(7, "2026-09-23", 100)).personal.size).toBe(0);
  });

  it("PATCH usa current read bajo la transacción para no conservar un snapshot anterior al candado", async () => {
    const conexion = { query: vi.fn().mockResolvedValue([[]]) };
    await primerConflictoProgramacionDia(7, [recursos[0]], "2026-09-23", 100, conexion as never);
    expect(String(conexion.query.mock.calls[0][0])).toMatch(/FOR UPDATE$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("Cancelado no bloquea; Cerrado sí consume esa fecha", async () => {
    filas.push({ recurso_id: 60, nombre: "C-CANCEL", plan_id: 101, codigo: "PLAN-101", fecha: "2026-09-23", estado: "Cancelado", empresa_id: 7 });
    filas.push({ recurso_id: 61, nombre: "C-CERRADO", plan_id: 102, codigo: "PLAN-102", fecha: "2026-09-23", estado: "Cerrado", empresa_id: 7 });
    try {
      expect(await primerConflictoProgramacionDia(7, [{ tipo: "unidad", id: 60 }], "2026-09-23", null)).toBeNull();
      expect((await primerConflictoProgramacionDia(7, [{ tipo: "unidad", id: 61 }], "2026-09-23", null))?.codigoConflicto).toBe("PLAN-102");
    } finally { filas.splice(-2); }
  });
});
