import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { hoyLocal } from "./dates";
import { obtenerSituacionEmpleadosHoy } from "./dashboard";

/**
 * RRHH-DASHBOARD-SITUACION-1 — "Situación del personal". Base en memoria que
 * responde a las TRES lecturas planas reales (empleados activos, jornadas de
 * hoy, incidencias vigentes hoy) filtrando por los parámetros que la función
 * envía: si una consulta olvidara empresa_id/fecha, los datos de otra empresa
 * o de otro día aparecerían y estos tests fallarían.
 */
type Emp = { id: number; empresa_id: number; codigo: string; nombre: string; estado: string };
type Ses = { empresa_id: number; id_empleado: number; fecha_jornada: string };
type Inc = { empresa_id: number; id_empleado: number; tipo: string | null; fecha_inicio: string; fecha_fin: string };

const HOY = hoyLocal();
let empleados: Emp[];
let sesiones: Ses[];
let incidencias: Inc[];
const consultas: { sql: string; params: unknown[] }[] = [];

const emp = (id: number, nombre: string, over: Partial<Emp> = {}): Emp => ({ id, empresa_id: 7, codigo: `E${id}`, nombre, estado: "Activo", ...over });
const ses = (id: number, over: Partial<Ses> = {}): Ses => ({ empresa_id: 7, id_empleado: id, fecha_jornada: HOY, ...over });
const inc = (id: number, tipo: string | null, over: Partial<Inc> = {}): Inc => ({ empresa_id: 7, id_empleado: id, tipo, fecha_inicio: HOY, fecha_fin: HOY, ...over });

function emular(sql: string, params: unknown[]): RowDataPacket[] {
  const s = String(sql);
  consultas.push({ sql: s, params });
  if (s.includes("FROM empleados")) {
    return empleados.filter((e) => e.empresa_id === params[0] && e.estado === "Activo").sort((a, b) => a.nombre.localeCompare(b.nombre)) as never;
  }
  if (s.includes("FROM sesiones_trabajo")) {
    return sesiones.filter((x) => x.empresa_id === params[0] && x.fecha_jornada === params[1]).map((x) => ({ id_empleado: x.id_empleado })) as never;
  }
  if (s.includes("FROM incidencias")) {
    return incidencias.filter((x) => x.empresa_id === params[0] && String(params[1]) >= x.fecha_inicio && String(params[1]) <= x.fecha_fin)
      .map((x) => ({ id_empleado: x.id_empleado, tipo: x.tipo })) as never;
  }
  throw new Error(`consulta inesperada: ${s}`);
}

const situacion = () => obtenerSituacionEmpleadosHoy(7);
const de = async (id: number) => (await situacion()).find((x) => x.idEmpleado === id);

beforeEach(() => {
  vi.resetAllMocks();
  consultas.length = 0;
  empleados = []; sesiones = []; incidencias = [];
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => emular(sql, params)) as never);
});

describe("clasificación por empleado", () => {
  it("con jornada hoy y sin incidencia -> NO aparece", async () => {
    empleados = [emp(1, "Ana")]; sesiones = [ses(1)];
    expect(await situacion()).toEqual([]);
  });

  it("sin jornada y sin incidencia -> Sin marcaje", async () => {
    empleados = [emp(1, "Ana")];
    expect(await situacion()).toEqual([{ idEmpleado: 1, codigo: "E1", nombre: "Ana", situacion: "Sin marcaje", detalle: "No registra jornada hoy" }]);
  });

  it("con vacaciones vigentes -> Vacaciones", async () => {
    empleados = [emp(1, "Ana")]; incidencias = [inc(1, "Vacaciones", { fecha_inicio: "2000-01-01", fecha_fin: "2999-12-31" })];
    expect(await de(1)).toMatchObject({ situacion: "Vacaciones", detalle: "Vacaciones vigentes" });
  });

  it("'A cuenta de Vacaciones' también cuenta como vacaciones (mismo criterio LIKE '%Vacaciones%' del resto del dashboard)", async () => {
    empleados = [emp(1, "Ana")]; incidencias = [inc(1, "A cuenta de Vacaciones")];
    expect((await de(1))!.situacion).toBe("Vacaciones");
  });

  it("con otra incidencia -> Otra incidencia, con el tipo como detalle", async () => {
    empleados = [emp(1, "Ana")]; incidencias = [inc(1, "Permiso con goce")];
    expect(await de(1)).toMatchObject({ situacion: "Otra incidencia", detalle: "Permiso con goce" });
  });

  it("vacaciones + otra incidencia -> Vacaciones (prioridad)", async () => {
    empleados = [emp(1, "Ana")]; incidencias = [inc(1, "Permiso con goce"), inc(1, "Vacaciones")];
    expect(await de(1)).toMatchObject({ situacion: "Vacaciones", detalle: "Vacaciones vigentes" });
  });

  it("incidencia + sin jornada -> la incidencia, nunca 'Sin marcaje'", async () => {
    empleados = [emp(1, "Ana")]; incidencias = [inc(1, "IGSS")];
    const r = await situacion();
    expect(r).toHaveLength(1);
    expect(r[0].situacion).toBe("Otra incidencia");
  });

  it("incidencia + con jornada hoy -> igual aparece como incidencia (una jornada no la borra)", async () => {
    empleados = [emp(1, "Ana")]; sesiones = [ses(1)]; incidencias = [inc(1, "Enfermedad")];
    expect((await de(1))!.situacion).toBe("Otra incidencia");
  });

  it("varias incidencias -> detalle legible: únicas, ordenadas y separadas por coma", async () => {
    empleados = [emp(1, "Ana")];
    incidencias = [inc(1, "Permiso con goce"), inc(1, "IGSS"), inc(1, "Permiso con goce"), inc(1, "Enfermedad")];
    expect((await de(1))!.detalle).toBe("Enfermedad, IGSS, Permiso con goce");
  });

  it("incidencias sin tipo (NULL o vacío) se ignoran: no inventan una 'Otra incidencia'", async () => {
    empleados = [emp(1, "Ana"), emp(2, "Beto")]; sesiones = [ses(1)]; incidencias = [inc(1, null), inc(2, "  ")];
    expect((await situacion()).map((x) => [x.idEmpleado, x.situacion])).toEqual([[2, "Sin marcaje"]]);
  });

  it("incidencias vencidas o futuras no cuentan", async () => {
    empleados = [emp(1, "Ana")]; sesiones = [ses(1)];
    incidencias = [inc(1, "Vacaciones", { fecha_inicio: "2000-01-01", fecha_fin: "2000-01-10" }), inc(1, "IGSS", { fecha_inicio: "2999-01-01", fecha_fin: "2999-01-10" })];
    expect(await situacion()).toEqual([]);
  });

  it("una jornada de OTRO día no cuenta como marcaje de hoy", async () => {
    empleados = [emp(1, "Ana")]; sesiones = [ses(1, { fecha_jornada: "2000-01-01" })];
    expect((await de(1))!.situacion).toBe("Sin marcaje");
  });
});

describe("aislamiento, elegibilidad y forma del resultado", () => {
  it("empleado no Activo (Baja) -> no aparece aunque no tenga jornada ni incidencias", async () => {
    empleados = [emp(1, "Ana", { estado: "Baja" }), emp(2, "Beto")];
    expect((await situacion()).map((x) => x.idEmpleado)).toEqual([2]);
  });

  it("empleado, jornada e incidencia de OTRA empresa no aparecen ni afectan a la propia", async () => {
    empleados = [emp(1, "Ana"), emp(9, "Zoe", { empresa_id: 8 })];
    sesiones = [ses(1, { empresa_id: 8 })]; // jornada de otra empresa con el mismo id_empleado: no debe ocultar a Ana
    incidencias = [inc(1, "Vacaciones", { empresa_id: 8 }), inc(9, "IGSS", { empresa_id: 8 })];
    const r = await situacion();
    expect(r.map((x) => [x.idEmpleado, x.situacion])).toEqual([[1, "Sin marcaje"]]);
  });

  it("las TRES consultas van acotadas por la empresa recibida (nunca por el cliente) y la de datos del día por la fecha de hoy", async () => {
    empleados = [emp(1, "Ana")];
    await obtenerSituacionEmpleadosHoy(42);
    expect(consultas).toHaveLength(3);
    for (const c of consultas) {
      expect(c.sql).toContain("empresa_id = ?");
      expect(c.params[0]).toBe(42);
    }
    expect(consultas[1].params).toEqual([42, HOY]);
    expect(consultas[2].params).toEqual([42, HOY]);
  });

  it("no duplica empleados aunque tengan varias jornadas e incidencias repetidas", async () => {
    empleados = [emp(1, "Ana"), emp(2, "Beto")];
    sesiones = [ses(1), ses(1), ses(1)];
    incidencias = [inc(1, "IGSS"), inc(1, "IGSS"), inc(1, "Vacaciones"), inc(1, "Vacaciones"), inc(2, "Enfermedad"), inc(2, "Enfermedad")];
    const ids = (await situacion()).map((x) => x.idEmpleado);
    expect(ids).toEqual([1, 2]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orden: Vacaciones, luego Otra incidencia, luego Sin marcaje; por nombre dentro de cada grupo", async () => {
    empleados = [emp(1, "Ana"), emp(2, "Beto"), emp(3, "Carla"), emp(4, "Diego"), emp(5, "Elena")];
    incidencias = [inc(4, "Vacaciones"), inc(2, "IGSS"), inc(5, "Vacaciones")];
    expect((await situacion()).map((x) => `${x.situacion}:${x.nombre}`)).toEqual([
      "Vacaciones:Diego", "Vacaciones:Elena", "Otra incidencia:Beto", "Sin marcaje:Ana", "Sin marcaje:Carla",
    ]);
  });

  it("solo lectura y sin las construcciones frágiles de la consulta anterior", () => {
    const src = readFileSync("src/lib/rrhh/dashboard.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function obtenerSituacionEmpleadosHoy"), src.indexOf("export async function obtenerResumenGerencial"));
    expect(fn).not.toMatch(/GROUP_CONCAT|GROUP BY|HAVING|COUNT\(DISTINCT|MAX\(CASE|LEFT JOIN/i);
    expect(fn).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
  });
});
