import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { ESTADOS_ASIGNACION_DIARIA } from "./disponibilidad-programacion-dia";
import { listarOcupacionProgramacionIntervalo, primerConflictoProgramacionIntervalo } from "./disponibilidad-programacion-intervalos";

/**
 * A2.2 — buscadores de Programación (disponibilidad-recursos) con la MISMA política por intervalos que POST/PATCH/
 * importación/lote. Modelo de BD en memoria que respeta el SQL real que se envía (ventana, estados, NOT IN,
 * Tercerizado, empresa, equivalencia por id_empleado); la decisión de solape es la del código de producción.
 */
type Personal = { id: number; empresa_id: number; nombre: string; id_empleado: number | null };
type Plan = {
  id: number; empresa_id: number; codigo: string; estado: string; fecha: string; hora: string | null; regreso: string | null; tipo_viaje?: string;
  piloto_id?: number | null; auxiliar_id?: number | null; aux?: number[]; unidad_placa?: string | null; tc_placa?: string | null;
};
let personal: Personal[];
let planes: Plan[];

const JUAN = { id: 10, empresa_id: 7, nombre: "Juan", id_empleado: 55 };
const JUAN_AUX = { id: 11, empresa_id: 7, nombre: "Juan", id_empleado: 55 }; // misma persona física, otra fila
const ANA = { id: 20, empresa_id: 7, nombre: "Ana", id_empleado: 66 };
const plan = (over: Partial<Plan> = {}): Plan => ({ id: 1, empresa_id: 7, codigo: "PLAN-1", estado: "Programado", fecha: "2026-09-24", hora: "05:00:00", regreso: "2026-09-24 08:00:00", piloto_id: 10, ...over });

beforeEach(() => {
  vi.resetAllMocks();
  personal = [JUAN, JUAN_AUX, ANA];
  planes = [];
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql);
    const n = ESTADOS_ASIGNACION_DIARIA.length;
    const empresa = Number(params[0]);
    const estados = params.slice(1, 1 + n) as string[];
    const fechaFin = String(params[1 + n]);
    const fechaInicio = String(params[2 + n]);
    const inicio = String(params[3 + n]);
    const nEx = (/p\.id NOT IN \(([?,]+)\)/.exec(s)?.[1].split(",").length) ?? 0;
    const excl = (nEx ? params.slice(-nEx) : []) as number[];
    const excluyeTercerizado = s.includes("<> 'Tercerizado'");
    const visibles = planes.filter((p) => p.empresa_id === empresa && estados.includes(p.estado) && !excl.includes(p.id)
      && !(excluyeTercerizado && p.tipo_viaje === "Tercerizado") && p.fecha <= fechaFin && (p.fecha >= fechaInicio || (p.regreso != null && p.regreso > inicio)));
    const fila = (p: Plan, recurso_id: unknown, nombre: unknown) => ({ recurso_id, nombre, plan_id: p.id, codigo: p.codigo, fecha_plan: p.fecha, hora_carga: p.hora, regreso_estimado: p.regreso });
    if (s.includes("FROM tms_personal tp") && s.includes("tp.id IN")) { // consulta de UN recurso ya elegido (motor de guardado)
      const ids = params.slice(5 + n, params.length - nEx).map(Number);
      return personal.filter((tp) => tp.empresa_id === empresa && ids.includes(tp.id)).flatMap((tp) => {
        const eq = new Set(personal.filter((x) => x.empresa_id === empresa && (x.id === tp.id || (tp.id_empleado != null && x.id_empleado === tp.id_empleado))).map((x) => x.id));
        return visibles.filter((p) => (p.piloto_id != null && eq.has(p.piloto_id)) || (p.auxiliar_id != null && eq.has(p.auxiliar_id)) || (p.aux ?? []).some((a) => eq.has(a))).map((p) => fila(p, tp.id, tp.nombre));
      });
    }
    if (s.includes("FROM tms_personal tp")) {
      return personal.filter((tp) => tp.empresa_id === empresa && tp.id_empleado != null).flatMap((tp) => {
        const eq = new Set(personal.filter((x) => x.empresa_id === empresa && (x.id === tp.id || x.id_empleado === tp.id_empleado)).map((x) => x.id));
        return visibles.filter((p) => (p.piloto_id != null && eq.has(p.piloto_id)) || (p.auxiliar_id != null && eq.has(p.auxiliar_id)) || (p.aux ?? []).some((a) => eq.has(a))).map((p) => fila(p, tp.id_empleado, tp.nombre));
      });
    }
    if (s.includes("FROM tms_unidades u")) return visibles.filter((p) => p.unidad_placa).map((p) => fila(p, p.unidad_placa, p.unidad_placa));
    if (s.includes("p.tc_vehiculo_id = v.id")) return visibles.filter((p) => p.tc_placa).map((p) => fila(p, p.tc_placa, p.tc_placa));
    return [];
  }) as never);
});

const v = (fechaPlan: string, horaCarga: string | null, regresoEstimado: string | null) => ({ fechaPlan, horaCarga, regresoEstimado });
const consultar = (ventana: ReturnType<typeof v>, excluir: number[] = []) => listarOcupacionProgramacionIntervalo(7, ventana, excluir);

describe("buscadores: la ocupación es un solape real con la ventana consultada", () => {
  it("17) existente 05:00-08:00, consulta 08:00-11:00 => libre; 18) consulta 07:59-10:00 => ocupado", async () => {
    planes = [plan()];
    expect((await consultar(v("2026-09-24", "08:00", "2026-09-24T11:00"))).personal.size).toBe(0);
    const ocupado = await consultar(v("2026-09-24", "07:59", "2026-09-24T10:00"));
    expect(ocupado.personal.get(55)).toEqual({ planId: 1, planCodigo: "PLAN-1", horaInicio: "", horaFin: null }); // contrato sin cambios
  });

  it("19) cruce de medianoche: existente 24/09 22:00 -> 25/09 02:00; consulta 25/09 01:00-04:00 ocupado, 02:00-05:00 libre", async () => {
    planes = [plan({ hora: "22:00:00", regreso: "2026-09-25 02:00:00" })];
    expect((await consultar(v("2026-09-25", "01:00", "2026-09-25T04:00"))).personal.has(55)).toBe(true);
    expect((await consultar(v("2026-09-25", "02:00", "2026-09-25T05:00"))).personal.has(55)).toBe(false);
  });

  it("20) sin regreso => consulta el día completo: ocupa aunque el viaje existente sea de otra hora; el día siguiente queda libre", async () => {
    planes = [plan({ hora: "21:00:00", regreso: "2026-09-24 23:00:00" })];
    expect((await consultar(v("2026-09-24", "08:00", null))).personal.has(55)).toBe(true); // 08:00 sin regreso: NO 08:00 -> infinito ni +8 h
    expect((await consultar(v("2026-09-25", "08:00", null))).personal.has(55)).toBe(false);
  });

  it("21) sin hora => consulta el día completo (aunque traiga regreso)", async () => {
    planes = [plan({ hora: "21:00:00", regreso: "2026-09-24 23:00:00" })];
    expect((await consultar(v("2026-09-24", null, "2026-09-24T08:00"))).personal.has(55)).toBe(true);
    expect((await consultar(v("2026-09-24", null, null))).personal.has(55)).toBe(true);
  });

  it("existente SIN regreso reserva solo su día (no el siguiente)", async () => {
    planes = [plan({ regreso: null })];
    expect((await consultar(v("2026-09-24", "20:00", "2026-09-24T22:00"))).personal.has(55)).toBe(true);
    expect((await consultar(v("2026-09-25", "01:00", "2026-09-25T03:00"))).personal.has(55)).toBe(false);
  });

  it("22) excluirPlanId: el plan que se edita no se marca contra sí mismo; otros planes siguen ocupando", async () => {
    planes = [plan({ id: 1 }), plan({ id: 2, codigo: "PLAN-2", piloto_id: 20 })];
    const r = await consultar(v("2026-09-24", "06:00", "2026-09-24T07:00"), [1]);
    expect([...r.personal.keys()]).toEqual([66]);
    expect(r.personal.get(66)!.planCodigo).toBe("PLAN-2");
  });

  it("23/24) piloto y auxiliar (principal y adicional) ocupan por igual", async () => {
    planes = [plan({ piloto_id: null, auxiliar_id: 10 }), plan({ id: 2, codigo: "PLAN-2", piloto_id: null, aux: [20] })];
    const r = await consultar(v("2026-09-24", "07:59", "2026-09-24T10:00"));
    expect([...r.personal.keys()].sort()).toEqual([55, 66]);
    const libre = await consultar(v("2026-09-24", "08:00", "2026-09-24T10:00"));
    expect(libre.personal.size).toBe(0);
  });

  it("25/26) unidad y TC (por placa en mayúsculas) usan la misma semántica", async () => {
    planes = [plan({ piloto_id: null, unidad_placa: "P-123ABC", tc_placa: "TC-045" })];
    const ocupado = await consultar(v("2026-09-24", "07:59", "2026-09-24T10:00"));
    expect(ocupado.unidades.get("P-123ABC")?.planCodigo).toBe("PLAN-1");
    expect(ocupado.tcs.get("TC-045")?.planCodigo).toBe("PLAN-1");
    const libre = await consultar(v("2026-09-24", "08:00", "2026-09-24T10:00"));
    expect([libre.unidades.size, libre.tcs.size]).toEqual([0, 0]);
  });

  it("27) misma persona física por id_empleado: la clave es el empleado, sin importar la fila/rol de tms_personal", async () => {
    planes = [plan({ piloto_id: null, aux: [11] })]; // ocupa la fila 11 (Auxiliar) del empleado 55
    const r = await consultar(v("2026-09-24", "06:00", "2026-09-24T07:00"));
    expect([...r.personal.keys()]).toEqual([55]);
  });

  it("28) Tercerizado no bloquea (el SQL lo excluye) y Cancelado libera; Cerrado sigue reservando su ventana", async () => {
    planes = [plan({ tipo_viaje: "Tercerizado", unidad_placa: "EXT" })];
    const r = await consultar(v("2026-09-24", "06:00", "2026-09-24T07:00"));
    expect([r.personal.size, r.unidades.size]).toEqual([0, 0]);
    planes = [plan({ estado: "Cancelado" })];
    expect((await consultar(v("2026-09-24", "06:00", "2026-09-24T07:00"))).personal.size).toBe(0);
    planes = [plan({ estado: "Cerrado" })];
    expect((await consultar(v("2026-09-24", "06:00", "2026-09-24T07:00"))).personal.size).toBe(1);
  });

  it("aislamiento por empresa: la consulta va acotada por la empresa y no ve planes de otra", async () => {
    planes = [plan({ empresa_id: 8 })];
    expect((await consultar(v("2026-09-24", "06:00", "2026-09-24T07:00"))).personal.size).toBe(0);
    for (const [, params] of vi.mocked(query).mock.calls) expect((params as unknown[])[0]).toBe(7);
  });

  it("ventana incoherente (regreso <= carga) => reserva diaria, sin lanzar", async () => {
    planes = [plan({ hora: "21:00:00", regreso: "2026-09-24 23:00:00" })];
    expect((await consultar(v("2026-09-24", "08:00", "2026-09-24T07:00"))).personal.has(55)).toBe(true);
  });
});

describe("29) buscador, POST/PATCH, importación y lote comparten la misma semántica", () => {
  const casos: [string, ReturnType<typeof v>, boolean][] = [
    ["borde exacto fin == inicio", v("2026-09-24", "08:00", "2026-09-24T11:00"), false],
    ["solape de 1 minuto", v("2026-09-24", "07:59", "2026-09-24T11:00"), true],
    ["sin regreso (día completo)", v("2026-09-24", "20:00", null), true],
    ["sin hora (día completo)", v("2026-09-24", null, "2026-09-24T09:00"), true],
    ["otro día", v("2026-09-25", "05:00", "2026-09-25T08:00"), false],
  ];
  it.each(casos)("%s: el buscador marca ocupado exactamente cuando el motor de guardado detecta conflicto", async (_n, ventana, choca) => {
    planes = [plan()];
    const buscador = (await consultar(ventana)).personal.has(55);
    const guardado = (await primerConflictoProgramacionIntervalo(7, [{ tipo: "piloto", id: 10 }], ventana, [])) != null;
    expect(buscador).toBe(choca);
    expect(guardado).toBe(choca);
  });
});

describe("30) no quedan usos productivos de la política diaria", () => {
  const productivos = [
    "src/app/api/empresas/[slug]/tms/planes/route.ts",
    "src/app/api/empresas/[slug]/tms/planes/disponibilidad-recursos/route.ts",
    "src/lib/tms/programacion-import.ts",
    "src/lib/tms/programacion-lote.ts",
    "src/lib/tms/programacion-copia.ts",
    "src/lib/tms/disponibilidad-programacion-intervalos.ts",
  ];
  it("ningún flujo productivo llama a primerConflictoProgramacionDia / listarDisponibilidadProgramacionDia", () => {
    for (const archivo of productivos) {
      const fuente = readFileSync(archivo, "utf8");
      expect(fuente, archivo).not.toMatch(/primerConflictoProgramacionDia\s*\(/);
      expect(fuente, archivo).not.toMatch(/listarDisponibilidadProgramacionDia\s*\(/);
    }
  });

  it("solo queda como código LEGADO documentado en disponibilidad-programacion-dia.ts (constantes y tipos siguen en uso)", () => {
    const dia = readFileSync("src/lib/tms/disponibilidad-programacion-dia.ts", "utf8");
    expect(dia).toContain("LEGADO");
    expect(readFileSync("src/lib/tms/disponibilidad-programacion-intervalos.ts", "utf8")).toContain("ESTADOS_ASIGNACION_DIARIA");
  });
});
