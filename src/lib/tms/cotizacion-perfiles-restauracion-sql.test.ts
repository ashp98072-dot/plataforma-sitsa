import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calcularCosteoServicio, CODIGOS_PERFIL_COSTEO, type PerfilCosteoUnidad } from "./cotizacion-costeo";

const leer = (nombre: string) => readFileSync(`sql/${nombre}`, "utf8");
const migracion = leer("migrate-2026-09-restaurar-perfiles-cotizaciones.sql");
const preflight = leer("preflight-2026-09-restaurar-perfiles-cotizaciones.sql");
const sinComentarios = (sql: string) => sql.split("\n").filter((s) => !s.trim().startsWith("--")).join("\n");
const codigos = CODIGOS_PERFIL_COSTEO.map((p) => p.codigo);

// Estos son los parámetros del primer bloque de cada hoja principal del Excel.
// El test de contrato impide que el preview y el INSERT se separen.
const filas = [
  ["CAMION_2_7T", 30, 140, 1150, 1350, 5000, 5000, 50000, 22, 150000, 5, 26, null, null, null],
  ["CAMION_5T", 30, 140, 1150, 1500, 5000, 6900, 50000, 17, 182142.86, 5, 26, null, null, null],
  ["CAMION_5T_REFRIGERADO", 30, 140, 1150, 1500, 5000, 7800, 50000, 14, 182142.86, 5, 26, 100000, 5, 26],
  ["CAMION_10T", 30, 140, 1150, 2500, 5000, 9900, 50000, 9.5, 120000, 5, 26, null, null, null],
  ["CABEZAL", 30, 140, 1150, 3000, 5000, 10200, 50000, 8, 250000, 5, 26, null, null, null],
] as const;

function valoresDeSql(sql: string) {
  const filasSql = [...sql.matchAll(/(?:SELECT|UNION ALL SELECT)\s+'(CAMION_2_7T|CAMION_5T|CAMION_5T_REFRIGERADO|CAMION_10T|CABEZAL)'\s*,?[^\n]*/g)]
    .map((m) => m[0]);
  expect(filasSql).toHaveLength(5);
  return filasSql;
}

describe("Restauración de perfiles de unidad desde Excel", () => {
  it("reutiliza los cinco códigos estables y mantiene iguales las cinco filas del preflight y la migración", () => {
    expect(filas.map((r) => r[0])).toEqual(codigos);
    const a = valoresDeSql(preflight);
    const b = valoresDeSql(migracion);
    // Las columnas y literales deben coincidir incluso si cambia la presentación.
    expect(a.map((x) => x.replace(/\s+/g, " ").replace(/^UNION ALL /, "")))
      .toEqual(b.map((x) => x.replace(/\s+/g, " ").replace(/^UNION ALL /, "")));
    for (const [i, fila] of filas.entries()) {
      const sql = b[i];
      expect(sql).toContain(`'${fila[0]}'`);
    }
    expect(migracion).toContain("1350 aceite, 5000 vida_aceite, 5000 llantas, 50000 vida_llantas, 22 rendimiento");
    expect(migracion).toContain("'CABEZAL', 'Cabezal', 30, 140, 1150, 3000, 5000, 10200, 50000, 8, 250000, 5, 26");
  });

  it("es aditiva y no duplica/sobrescribe perfiles existentes, ni toca snapshots", () => {
    const sql = sinComentarios(migracion);
    expect(sql).toMatch(/INSERT INTO tms_cotizacion_costeo_perfiles\s*\(/i);
    expect(sql).toMatch(/@restauracion_perfiles_codigos_existentes = 0/);
    expect(sql).toMatch(/empresa_id = @restauracion_perfiles_empresa_id/);
    expect(sql).toMatch(/@restauracion_perfiles_slug <> 'REEMPLAZAR_SLUG_EMPRESA'/);
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|REPLACE|ALTER|DROP)\b/i);
    expect(sql).not.toMatch(/tms_cotizacion_costeos|tms_cotizaciones|tms_cotizacion_lineas/i);
  });

  it("preflight es solo lectura y distingue APLICAR, NOOP y DETENER", () => {
    const sql = sinComentarios(preflight);
    expect(sql).not.toMatch(/information_schema/i);
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|REPLACE|ALTER|DROP|CREATE)\b/im);
    expect(sql).toContain("SHOW CREATE TABLE tms_cotizacion_costeo_perfiles");
    expect(sql).toContain("THEN 'APLICAR'");
    expect(sql).toContain("THEN 'NOOP'");
    expect(sql).toContain("THEN 'DETENER'");
    expect(sql).toContain("p.refrig_dias_operacion_mes <=> x.refrig_dias");
  });

  it("todos están activos, tienen importes y rendimientos válidos; el motor acepta perfil recuperado", () => {
    for (const r of filas) {
      expect(r[1]).toBeGreaterThan(0);
      expect(r[2]).toBeGreaterThanOrEqual(0);
      expect(r[3]).toBeGreaterThanOrEqual(0);
      expect(r[4]).toBeGreaterThanOrEqual(0);
      expect(r[5]).toBeGreaterThan(0);
      expect(r[6]).toBeGreaterThanOrEqual(0);
      expect(r[7]).toBeGreaterThan(0);
      expect(r[8]).toBeGreaterThan(0);
      const perfil: PerfilCosteoUnidad = {
        codigo: r[0], nombre: r[0], diasOperacionMes: r[1], gpsMensual: r[2],
        seguroVehiculoMensual: r[3], costoAceiteServicio: r[4], vidaUtilAceiteKm: r[5],
        costoJuegoLlantas: r[6], vidaUtilLlantasKm: r[7], rendimientoKmGalon: r[8],
        depreciacion: { valorBase: r[9], anios: r[10], diasOperacionMes: r[11] },
        costoRefrigeracion: r[12] === null ? null : { valorBase: r[12], anios: r[13]!, diasOperacionMes: r[14]! },
      };
      const resultado = calcularCosteoServicio({
        perfil, parametros: { precioCombustibleGalon: 30, ivaTasa: 0.12, costoPilotoDia: 0,
          costoAuxiliarDia: 0, viaticoPilotoDia: 0, viaticoAuxiliarDia: 0, viaticoGuiaDia: 0 },
        distanciaKm: 100, diasServicio: 1, cantidadPilotos: 0, cantidadAuxiliares: 0,
        incluirGps: true, incluirSeguroVehiculo: true, usarRefrigeracion: r[12] !== null,
      });
      expect(resultado.combustible).toBeCloseTo(100 / r[8] * 30);
      expect(resultado.gps).toBeCloseTo(r[2] / r[1]);
      expect(resultado.seguroVehiculo).toBeCloseTo(r[3] / r[1]);
      expect(resultado.aceite).toBeCloseTo(100 * r[4] / r[5]);
      expect(resultado.llantas).toBeCloseTo(100 * r[6] / r[7]);
    }
  });
});
