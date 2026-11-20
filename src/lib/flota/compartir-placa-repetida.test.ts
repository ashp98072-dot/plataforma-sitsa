import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import { conflictosAlCompartirTx, exigirComparticionSinDuplicadoTx, mensajeConflictoCompartir, ErrorIdentidadVehiculo, PLACA_REPETIDA_AL_COMPARTIR } from "./vehiculos-escritura";
import { guardasFisicas } from "./identidad-fisica-schema";

type Ficha = { id: number; empresa_id: number; placa: string; activo?: number };
type Mundo = { fichas: Ficha[]; accesos?: { vehiculo_id: number; empresa_id: number }[]; identidades?: { a: number; b: number; estado: "APROBADA" | "PROPUESTA" }[]; esquemaFisico?: boolean; empresas?: Record<number, string> };

/** Conexión simulada con las consultas exactas del helper; registra el SQL para comprobar candados y filtros. */
function conexion(m: Mundo) {
  const sqls: string[] = [];
  const c = {
    query: async (sql: string, args: unknown[] = []) => {
      sqls.push(sql);
      if (sql.includes("information_schema.TABLES")) return [m.esquemaFisico === false ? [] : ["flota_identidades_fisicas", "flota_identidad_miembros", "flota_identidad_empresas", "flota_identidad_aprobaciones"].map(t => ({ TABLE_NAME: t, ENGINE: "InnoDB" }))];
      if (sql.includes("information_schema.TRIGGERS")) return [guardasFisicas.map(t => ({ TRIGGER_NAME: t }))];
      if (sql.startsWith("SELECT id,empresa_id,placa FROM flota_vehiculos WHERE id=?")) return [m.fichas.filter(f => f.id === args[0])];
      if (sql.startsWith("SELECT empresa_id FROM flota_vehiculo_acceso")) return [(m.accesos ?? []).filter(a => a.vehiculo_id === args[0])];
      if (sql.startsWith("SELECT id,placa FROM flota_vehiculos WHERE empresa_id=?")) {
        expect(sql).toContain("activo=1"); expect(sql).toContain("FOR UPDATE");
        return [m.fichas.filter(f => f.empresa_id === args[0] && f.id !== args[1] && (f.activo ?? 1) === 1)];
      }
      if (sql.includes("flota_identidad_miembros a JOIN flota_identidad_miembros b")) {
        expect(sql).toContain("estado='APROBADA'");
        const [vehiculo, local] = args as number[];
        return [(m.identidades ?? []).filter(i => i.estado === "APROBADA" && ((i.a === vehiculo && i.b === local) || (i.a === local && i.b === vehiculo))).map(() => ({ 1: 1 }))];
      }
      if (sql.startsWith("SELECT nombre FROM empresas")) return [[{ nombre: (m.empresas ?? {})[args[0] as number] ?? `Empresa ${args[0]}` }]];
      throw new Error(`consulta inesperada: ${sql}`);
    },
  } as unknown as PoolConnection;
  return { c, sqls };
}

/** Parejas conocidas: [ficha de la empresa dueña, empresa dueña, ficha local de Mónaco (empresa 1), placa de la dueña, placa local]. */
const PAREJAS: [number, number, number, string, string][] = [
  [651, 4, 1300, "C-092BXF", "C092BXF"], [602, 4, 1296, "C-034BXR", "c 034 bxr"], [603, 4, 1297, "C-035BXR", "C-035BXR"], [684, 4, 1301, "C-558BSJ", "C–558BSJ"], [638, 5, 1299, "C-845BXG", "C845BXG"],
];

describe.each(PAREJAS)("compartir #%i (empresa %i) con la empresa 1, que ya tiene #%i", (idDuena, empresaDuena, idLocal, placaDuena, placaLocal) => {
  const fichas = [{ id: idDuena, empresa_id: empresaDuena, placa: placaDuena }, { id: idLocal, empresa_id: 1, placa: placaLocal }];
  const empresas = { 1: "Kuiqtrans / Logiservicios Mónaco" };
  it("avisa del conflicto (placa comparable, sin IDs ni datos de la otra ficha)", async () => {
    const { c } = conexion({ fichas, empresas });
    const r = await conflictosAlCompartirTx(c, idDuena, [1]);
    expect(r).toEqual([{ empresaId: 1, nombre: "Kuiqtrans / Logiservicios Mónaco" }]);
    const msg = mensajeConflictoCompartir(r, placaDuena);
    expect(msg).toContain("Kuiqtrans / Logiservicios Mónaco"); expect(msg).toContain("Identidades físicas");
    expect(msg).not.toContain(String(idLocal)); expect(msg).not.toMatch(/#\d/);
  });
  it("la variante estricta (importación) lanza 409 con el código y no deja pasar", async () => {
    const { c } = conexion({ fichas, empresas });
    await expect(exigirComparticionSinDuplicadoTx(c, idDuena, [1])).rejects.toMatchObject({ status: 409, codigo: PLACA_REPETIDA_AL_COMPARTIR });
    await expect(exigirComparticionSinDuplicadoTx(c, idDuena, [1])).rejects.toBeInstanceOf(ErrorIdentidadVehiculo);
  });
  it("con identidad física APROBADA entre ambas fichas se comparte sin conflicto; PROPUESTA todavía no basta", async () => {
    expect(await conflictosAlCompartirTx(conexion({ fichas, empresas, identidades: [{ a: idDuena, b: idLocal, estado: "APROBADA" }] }).c, idDuena, [1])).toEqual([]);
    expect(await conflictosAlCompartirTx(conexion({ fichas, empresas, identidades: [{ a: idDuena, b: idLocal, estado: "PROPUESTA" }] }).c, idDuena, [1])).toHaveLength(1);
  });
  it("sin el esquema de identidades sigue avisando (no hay forma de que estén unidas)", async () => {
    expect(await conflictosAlCompartirTx(conexion({ fichas, empresas, esquemaFisico: false }).c, idDuena, [1])).toHaveLength(1);
  });
  it("una comparticion que YA existía no se vuelve a revisar (editar otros datos no se bloquea)", async () => {
    const { c, sqls } = conexion({ fichas, empresas, accesos: [{ vehiculo_id: idDuena, empresa_id: 1 }] });
    expect(await conflictosAlCompartirTx(c, idDuena, [1])).toEqual([]);
    expect(sqls.some(s => s.startsWith("SELECT id,placa FROM flota_vehiculos WHERE empresa_id=?"))).toBe(false);
  });
  it("una ficha local INACTIVA no cuenta", async () => {
    expect(await conflictosAlCompartirTx(conexion({ fichas: [fichas[0], { ...fichas[1], activo: 0 }], empresas }).c, idDuena, [1])).toEqual([]);
  });
});

describe("compartir sin conflicto (no bloquea lo legítimo)", () => {
  it("empresa destino sin ficha con esa placa, placa distinta, empresa dueña en la lista, listas vacías o inválidas", async () => {
    const fichas = [{ id: 684, empresa_id: 4, placa: "C-558BSJ" }, { id: 1301, empresa_id: 1, placa: "C-558BSK" }, { id: 700, empresa_id: 2, placa: "P-100AAA" }];
    const { c } = conexion({ fichas });
    expect(await conflictosAlCompartirTx(c, 684, [1])).toEqual([]);  // otra placa
    expect(await conflictosAlCompartirTx(c, 684, [2])).toEqual([]);  // sin ficha local
    expect(await conflictosAlCompartirTx(c, 684, [4])).toEqual([]);  // la dueña no cuenta como destino
    expect(await conflictosAlCompartirTx(c, 684, [])).toEqual([]);
    expect(await conflictosAlCompartirTx(c, 684, [0, -3, Number.NaN])).toEqual([]);
  });
  it("solo informa las empresas con conflicto cuando se comparte con varias a la vez", async () => {
    const fichas = [{ id: 684, empresa_id: 4, placa: "C-558BSJ" }, { id: 1301, empresa_id: 1, placa: "C558BSJ" }];
    expect(await conflictosAlCompartirTx(conexion({ fichas, empresas: { 1: "Mónaco" } }).c, 684, [1, 2, 3])).toEqual([{ empresaId: 1, nombre: "Mónaco" }]);
  });
  it("un vehículo inexistente responde 404", async () => {
    await expect(conflictosAlCompartirTx(conexion({ fichas: [] }).c, 999, [1])).rejects.toMatchObject({ status: 404 });
  });
  it("bloquea el vehículo y las fichas locales con FOR UPDATE (sin carreras con altas simultáneas)", async () => {
    const { c, sqls } = conexion({ fichas: [{ id: 684, empresa_id: 4, placa: "C-558BSJ" }, { id: 1301, empresa_id: 1, placa: "C-558BSJ" }] });
    await conflictosAlCompartirTx(c, 684, [1]);
    expect(sqls.find(s => s.startsWith("SELECT id,empresa_id,placa FROM flota_vehiculos WHERE id=?"))).toContain("FOR UPDATE");
  });
});

describe("integración en las rutas (por código fuente)", () => {
  const vehiculos = readFileSync("src/app/api/empresas/[slug]/flota/vehiculos/route.ts", "utf8");
  const importacion = readFileSync("src/app/api/empresas/[slug]/flota/import/route.ts", "utf8");
  const cliente = readFileSync("src/app/e/[slug]/flota/flota-client.tsx", "utf8");
  it("PATCH: revisa antes de compartir, exige confirmación explícita, audita y devuelve el código", () => {
    expect(vehiculos).toMatch(/conflictosAlCompartirTx\(conn, d\.id, d\.accesoEmpresaIds\)/);
    expect(vehiculos.indexOf("conflictosAlCompartirTx(conn")).toBeLessThan(vehiculos.lastIndexOf("await guardarAccesoVehiculo("));
    expect(vehiculos).toContain("!d.confirmarPlacaRepetida");
    expect(vehiculos).toContain("confirmarPlacaRepetida: z.boolean().optional()");
    expect(vehiculos).toContain('accion: "compartir_con_placa_repetida"');
    expect(vehiculos).toMatch(/err\.codigo \? \{ codigo: err\.codigo \}/);
  });
  it("importación: revisa antes de cada alta de acceso (fila con error, sin confirmación)", () => {
    expect(importacion.match(/exigirComparticionSinDuplicadoTx\(conn,/g)).toHaveLength(2);
    for (const llamada of [/exigirComparticionSinDuplicadoTx\(conn, vid, acc\)/, /exigirComparticionSinDuplicadoTx\(conn, nuevoId, acc\)/]) expect(importacion).toMatch(llamada);
  });
  it("pantalla: solo reintenta con confirmación explícita del usuario y solo en 409 con el código", () => {
    expect(cliente).toContain('data.codigo === "PLACA_REPETIDA_AL_COMPARTIR" && window.confirm(');
    expect(cliente).toContain("confirmarPlacaRepetida: true");
    expect(cliente).toContain("accesoEmpresaIds: editId && !ajeno ? accesoEmpresaIds : undefined"); // contrato previo intacto
  });
});

describe("script de vista previa de conflictos", () => {
  it("es de SOLO LECTURA: únicamente SELECT (sin escritura, DDL, CALL, PREPARE ni SET) fuera de comentarios y literales", () => {
    const sql = readFileSync("sql/vista-previa-2026-11-flota-conflictos-pareja.sql", "utf8").replace(/^\s*--.*$/gm, "").replace(/'[^']*'/g, "''");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL|REPLACE\s+INTO|PREPARE|EXECUTE|RENAME|LOCK|USE|SET|LOAD|INTO)\b/i);
    for (const sentencia of sql.split(";").map(s => s.trim()).filter(Boolean)) expect(sentencia).toMatch(/^SELECT\b/i);
  });
});
