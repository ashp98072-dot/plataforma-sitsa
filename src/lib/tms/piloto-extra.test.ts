import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("./personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(), validarPersonalId: vi.fn() }));

import { query } from "@/lib/db";
import { personalDesdeEmpleado } from "./personal-resolucion";
import { ESTADOS_ASIGNACION_DIARIA } from "./disponibilidad-programacion-dia";
import { primerConflictoProgramacionIntervalo } from "./disponibilidad-programacion-intervalos";
import { primerConflictoTraslape } from "./disponibilidad-traslapes";
import { evaluarDisponibilidadPersonal, type DisponibilidadPersonalRegla } from "./programacion-validacion-recursos";
import { emularConsultaConflictoPersonal, type ModeloPersonal } from "./personal-identidad.fixture";
import {
  MAX_PILOTOS_EXTRA, MSG_EXTRA_INVALIDO, MSG_EXTRA_SOLO_PROPIO, MSG_PERSONA_DUPLICADA, guardarPilotoExtraPlan, hayPersonaDuplicada,
  pilotoExtraDePlanes, pilotoExtraIdDePlan, resolverPilotoExtraDesdeEmpleado, textoPilotos, validarPilotoExtraPersonalId,
} from "./piloto-extra";
import { lineaPilotosMensaje } from "./piloto-extra-comun";

/**
 * PROGRAMACIÓN — PILOTO EXTRA (máximo 1 por viaje Propio; tabla tms_plan_pilotos_adicionales; el principal sigue en piloto_id).
 */
const src = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
beforeEach(() => vi.resetAllMocks());

describe("reglas puras: duplicados, textos y límite", () => {
  it("límite de negocio: 1 piloto extra", () => expect(MAX_PILOTOS_EXTRA).toBe(1));
  it("4) mismo piloto dos veces / 5) principal también extra / 6) piloto también auxiliar → duplicado", () => {
    expect(hayPersonaDuplicada(1, 1, [])).toBe(true); // principal == extra
    expect(hayPersonaDuplicada(1, 2, [2])).toBe(true); // extra también auxiliar
    expect(hayPersonaDuplicada(1, 2, [1])).toBe(true); // principal también auxiliar
    expect(hayPersonaDuplicada(1, null, [3, 3])).toBe(true); // auxiliar repetido
    expect(MSG_PERSONA_DUPLICADA).toBe("Una persona no puede estar asignada más de una vez al mismo viaje.");
  });
  it("2/3) distintos o sin extra: permitido (1 piloto = comportamiento de siempre)", () => {
    expect(hayPersonaDuplicada(1, 2, [3, 4])).toBe(false);
    expect(hayPersonaDuplicada(1, null, [3])).toBe(false);
    expect(hayPersonaDuplicada(null, null, [])).toBe(false);
    expect(hayPersonaDuplicada(undefined, undefined, [])).toBe(false);
  });
  it("texto de pilotos: 'Principal / Extra'; sin extra queda exactamente el principal", () => {
    expect(textoPilotos("Juan Pérez", "Carlos López")).toBe("Juan Pérez / Carlos López");
    expect(textoPilotos("Juan Pérez", null)).toBe("Juan Pérez");
    expect(textoPilotos(null, null)).toBe("");
  });
  it("mensaje de notificación: 'Piloto:' con uno, 'Pilotos:' con extra", () => {
    expect(lineaPilotosMensaje("Juan Pérez", null)).toBe("Piloto: Juan Pérez");
    expect(lineaPilotosMensaje("Juan Pérez", "Carlos López")).toBe("Pilotos: Juan Pérez, Carlos López");
    expect(lineaPilotosMensaje(null, null)).toBe("Piloto: Pendiente");
  });
  it("mensajes claros de negocio", () => {
    expect(MSG_EXTRA_SOLO_PROPIO).toContain("solo aplica a viajes Propios");
    expect(MSG_EXTRA_INVALIDO).toContain("empleado activo");
  });
});

describe("lectura y escritura (misma conexión/transacción; sin N+1)", () => {
  it("pilotoExtraDePlanes: UNA consulta para todos los planes (no una por plan) y solo el primero de cada plan", async () => {
    vi.mocked(query).mockResolvedValue([
      { plan_id: 1, personal_id: 30, id_empleado: 300, nombre: "Carlos López", telefono: "5555-1234" },
      { plan_id: 2, personal_id: 31, id_empleado: null, nombre: "Otro", telefono: null },
    ] as never);
    const mapa = await pilotoExtraDePlanes([1, 2, 3, 2]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain("WHERE x.plan_id IN (?,?,?)");
    expect(mapa.get(1)).toEqual({ personalId: 30, empleadoId: 300, nombre: "Carlos López", telefono: "5555-1234" });
    expect(mapa.get(2)).toMatchObject({ personalId: 31, empleadoId: null, telefono: null });
    expect(mapa.has(3)).toBe(false);
  });
  it("sin planes no consulta; si la tabla aún no existe devuelve vacío (no rompe el listado)", async () => {
    expect((await pilotoExtraDePlanes([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
    vi.mocked(query).mockRejectedValue(new Error("Table 'tms_plan_pilotos_adicionales' doesn't exist"));
    expect((await pilotoExtraDePlanes([5])).size).toBe(0);
  });
  it("pilotoExtraIdDePlan: por la conexión dada, o null si no tiene / no existe la tabla", async () => {
    const conn = { query: vi.fn().mockResolvedValue([[{ personal_id: 30 }]]) };
    expect(await pilotoExtraIdDePlan(9, conn as never)).toBe(30);
    expect(conn.query).toHaveBeenCalledTimes(1);
    conn.query.mockRejectedValueOnce(new Error("no existe"));
    expect(await pilotoExtraIdDePlan(9, conn as never)).toBeNull();
  });
  it("guardarPilotoExtraPlan: DELETE + INSERT en la MISMA conexión, por plan y empresa (orden 1); null solo quita", async () => {
    const conn = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) };
    await guardarPilotoExtraPlan(7, 40, 30, conn as never);
    expect(conn.execute.mock.calls.map((c) => String(c[0]).trim().split(" ").slice(0, 3).join(" "))).toEqual(["DELETE FROM tms_plan_pilotos_adicionales", "INSERT INTO tms_plan_pilotos_adicionales"]);
    expect(conn.execute.mock.calls[0][1]).toEqual([40, 7]);
    expect(conn.execute.mock.calls[1][1]).toEqual([7, 40, 30]);
    conn.execute.mockClear();
    await guardarPilotoExtraPlan(7, 40, null, conn as never);
    expect(conn.execute).toHaveBeenCalledTimes(1);
    expect(String(conn.execute.mock.calls[0][0])).toContain("DELETE FROM tms_plan_pilotos_adicionales");
  });
  it("los errores de escritura se PROPAGAN (permiten el rollback del plan)", async () => {
    const conn = { execute: vi.fn().mockRejectedValue(new Error("fallo")) };
    await expect(guardarPilotoExtraPlan(7, 40, 30, conn as never)).rejects.toThrow("fallo");
  });
});

describe("origen RRHH: empleado activo con puesto de piloto, de esta empresa (tenant)", () => {
  it("21) consulta acotada por empresa, estado Activo y puesto/categoría de piloto (misma regla del catálogo del principal)", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 300 }] as never);
    vi.mocked(personalDesdeEmpleado).mockResolvedValue(30);
    const r = await resolverPilotoExtraDesdeEmpleado(7, 300);
    expect(r).toEqual({ ok: true, personalId: 30 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("empresa_id = ?");
    expect(String(sql)).toContain("estado = 'Activo'");
    expect(String(sql)).toContain("categoria_ops = 'Piloto'");
    expect(String(sql)).toContain("LIKE '%piloto%'");
    expect(params).toEqual([300, 7]);
    expect(personalDesdeEmpleado).toHaveBeenCalledWith(7, 300, "Piloto", undefined); // mismo tms_personal tipo Piloto que el principal
  });
  it("empleado de otra empresa, inactivo o sin puesto de piloto → 400 y NO se crea personal", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await resolverPilotoExtraDesdeEmpleado(7, 999)).toEqual({ ok: false, status: 400, error: MSG_EXTRA_INVALIDO });
    expect(personalDesdeEmpleado).not.toHaveBeenCalled();
  });
  it("por tms_personal.id exacto: tipo Piloto + Activo + empresa", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 30 }] as never);
    expect(await validarPilotoExtraPersonalId(7, 30)).toEqual({ ok: true, personalId: 30 });
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain("empresa_id = ? AND tipo = 'Piloto' AND estado = 'Activo'");
    vi.mocked(query).mockResolvedValue([] as never);
    expect((await validarPilotoExtraPersonalId(8, 30)).ok).toBe(false);
  });
});

describe("disponibilidad: el piloto extra consume EXACTAMENTE igual que el principal (mismo motor)", () => {
  const A = { id: 22, empresa_id: 7, nombre: "Juan Pérez", tipo: "Piloto" as const, id_empleado: 55 }; // principal del plan 900
  const B = { id: 23, empresa_id: 7, nombre: "Carlos López", tipo: "Piloto" as const, id_empleado: 56 }; // extra del plan 900
  const plan = (over: Record<string, unknown> = {}) => ({
    id: 900, empresa_id: 7, codigo: "PLAN-900", estado: "Programado", inicio: "2026-09-30 08:00:00", regreso_estimado: "2026-09-30 12:00:00", piloto_id: 22, pilotoExtra: 23, ...over,
  });
  let modelo: ModeloPersonal;
  let sqls: string[];
  beforeEach(() => {
    sqls = [];
    modelo = { personal: [A, B], planes: [plan()] };
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      sqls.push(String(sql));
      return String(sql).includes("FROM tms_personal tp") ? emularConsultaConflictoPersonal(modelo, String(sql), params) : [];
    }) as never);
  });
  const ventana = (hora: string, regreso: string | null, fecha = "2026-09-30") => ({ fechaPlan: fecha, horaCarga: hora, regresoEstimado: regreso });

  it("7) piloto extra OCUPADO en otro viaje incompatible → conflicto (motor por intervalos)", async () => {
    const c = await primerConflictoProgramacionIntervalo(7, [{ tipo: "piloto", id: 23 }], ventana("10:00", "2026-09-30T14:00"), []);
    expect(c).toMatchObject({ id: 23, nombre: "Carlos López" });
  });
  it("8) piloto extra DISPONIBLE (otra persona / otro horario) → permitido", async () => {
    expect(await primerConflictoProgramacionIntervalo(7, [{ tipo: "piloto", id: 22 + 100 }], ventana("10:00", "2026-09-30T14:00"), [])).toBeNull();
    modelo.planes = [plan({ pilotoExtra: null })]; // B ya no está en ese plan
    expect(await primerConflictoProgramacionIntervalo(7, [{ tipo: "piloto", id: 23 }], ventana("10:00", "2026-09-30T14:00"), [])).toBeNull();
  });
  it("9) traslape cross-midnight → rechazo", async () => {
    modelo.planes = [plan({ inicio: "2026-09-30 22:00:00", regreso_estimado: "2026-10-01 02:00:00" })];
    expect(await primerConflictoProgramacionIntervalo(7, [{ tipo: "piloto", id: 23 }], ventana("01:00", "2026-10-01T04:00", "2026-10-01"), [])).not.toBeNull();
  });
  it("10) fin == siguiente inicio → permitido (intervalo semiabierto, igual que el principal)", async () => {
    expect(await primerConflictoProgramacionIntervalo(7, [{ tipo: "piloto", id: 23 }], ventana("12:00", "2026-09-30T14:00"), [])).toBeNull();
  });
  it("el propio plan se autoexcluye al editar (el extra no choca contra sí mismo)", async () => {
    expect(await primerConflictoProgramacionIntervalo(7, [{ tipo: "piloto", id: 23 }], ventana("10:00", "2026-09-30T14:00"), [900])).toBeNull();
  });
  it("el mismo resultado por el motor de traslapes con ventana explícita (persona = empleado, sin importar rol)", async () => {
    const c = await primerConflictoTraslape(7, [{ tipo: "piloto", id: 23 }], { inicio: "2026-09-30 10:00:00", fin: "2026-09-30 14:00:00" }, null);
    expect(c).toMatchObject({ id: 23, planIdConflicto: 900 });
    expect(await primerConflictoTraslape(7, [{ tipo: "piloto", id: 23 }], { inicio: "2026-09-30 12:00:00", fin: "2026-09-30 14:00:00" }, null)).toBeNull();
  });
  it("el extra de UN viaje bloquea a esa persona como AUXILIAR de otro (una persona es una persona)", async () => {
    expect(await primerConflictoProgramacionIntervalo(7, [{ tipo: "auxiliar", id: 23 }], ventana("10:00", "2026-09-30T14:00"), [])).not.toBeNull();
  });
  it("tenant: otra empresa no ve el viaje", async () => {
    expect(await primerConflictoProgramacionIntervalo(8, [{ tipo: "piloto", id: 23 }], ventana("10:00", "2026-09-30T14:00"), [])).toBeNull();
  });
  it("todas las consultas del motor cuentan al piloto extra (texto del SQL; deben coincidir con el emulador)", async () => {
    await primerConflictoProgramacionIntervalo(7, [{ tipo: "piloto", id: 23 }], ventana("10:00", "2026-09-30T14:00"), []);
    await primerConflictoTraslape(7, [{ tipo: "piloto", id: 23 }], { inicio: "2026-09-30 10:00:00", fin: "2026-09-30 14:00:00" }, null);
    for (const s of sqls.filter((x) => x.includes("FROM tms_personal tp"))) {
      expect(s).toContain("tms_plan_pilotos_adicionales pe WHERE pe.plan_id = p.id AND pe.personal_id = eq.id");
    }
    for (const f of ["disponibilidad-programacion-intervalos.ts", "disponibilidad-programacion-dia.ts", "disponibilidad-traslapes.ts"]) {
      expect(src(`src/lib/tms/${f}`)).toContain("tms_plan_pilotos_adicionales pe WHERE pe.plan_id = p.id AND pe.personal_id = eq.id");
    }
    expect(src("src/lib/tms/disponibilidad-programacion-intervalos.ts").match(/tms_plan_pilotos_adicionales pe/g)).toHaveLength(2); // personal por intervalos (2 consultas)
    expect(src("src/lib/tms/disponibilidad-recursos-lista.ts")).toContain("tms_plan_pilotos_adicionales pe WHERE pe.plan_id = p.id AND pe.personal_id = tp.id");
    expect(ESTADOS_ASIGNACION_DIARIA.length).toBeGreaterThan(0);
  });
  it("disponibilidad de personal (viaje en curso / planes del día) incluye al extra", () => {
    const f = src("src/lib/operaciones/disponibilidad-personal.ts");
    expect(f).toContain("tms_plan_pilotos_adicionales");
    expect(f).toContain('rol: "piloto" });'); // el extra en un viaje abierto figura como PILOTO
    expect(f).toContain("for (const personalId of extraDiaMap.get(planId) ?? []) agregarPlanDia(personalId, plan);");
  });

  it("11) incidencia bloqueante / baja / viaje en curso del extra → rechazo (mismas reglas que el principal, rol 'piloto')", () => {
    const disp = (over: Partial<DisponibilidadPersonalRegla>): DisponibilidadPersonalRegla[] => [{
      personalId: 23, nombre: "Carlos López", incidenciasBloqueantes: [], viajeActual: null, estadoDisponibilidad: "disponible", otrosPlanesDelDia: [], advertencias: [], ...over,
    }];
    const ctx = { fechaEfectiva: "2026-09-30", esHoy: true, planId: 900 };
    const r = [{ personalId: 23, rol: "piloto" as const }];
    expect(evaluarDisponibilidadPersonal(disp({ incidenciasBloqueantes: [{ tipo: "Vacaciones", fechaInicio: "2026-09-29", fechaFin: "2026-10-03" }] }), r, ctx).error?.error).toContain("El piloto seleccionado tiene una incidencia (Vacaciones)");
    expect(evaluarDisponibilidadPersonal(disp({ estadoDisponibilidad: "no_disponible" }), r, { ...ctx, esHoy: false }).error?.error).toContain("de baja");
    expect(evaluarDisponibilidadPersonal(disp({ viajeActual: {} }), r, ctx).error?.error).toBe("El piloto seleccionado tiene un viaje en curso.");
    expect(evaluarDisponibilidadPersonal(disp({}), r, ctx).error).toBeNull(); // disponible → permitido
  });
});
