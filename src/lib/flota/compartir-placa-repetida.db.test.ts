import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { conflictosAlCompartirTx } from "./vehiculos-escritura";
import { guardasFisicas } from "./identidad-fisica-schema";

/**
 * Las MISMAS consultas del helper contra una MariaDB LOCAL y DESECHABLE (127.0.0.1, root sin contraseña). Se OMITE sin `FLOTA_CANON_DB_PORT`.
 * Esquema reducido y datos sintéticos; crea y borra su propia base. Nada toca producción.
 */
const PUERTO = process.env.FLOTA_CANON_DB_PORT;
let pool: mysql.Pool, admin: mysql.Connection;
const base = `compartir_placa_${process.pid}`;
const conn = async () => (await pool.getConnection()) as unknown as import("mysql2/promise").PoolConnection;

describe.skipIf(!PUERTO)("conflictosAlCompartirTx contra MariaDB", () => {
  beforeAll(async () => {
    admin = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", multipleStatements: true });
    await admin.query(`DROP DATABASE IF EXISTS ${base}; CREATE DATABASE ${base} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE ${base}`);
    await admin.query(`
      CREATE TABLE empresas (id INT PRIMARY KEY, nombre VARCHAR(80)) ENGINE=InnoDB;
      CREATE TABLE flota_vehiculos (id INT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL, activo TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
      CREATE TABLE flota_vehiculo_acceso (vehiculo_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY (vehiculo_id, empresa_id)) ENGINE=InnoDB;
      CREATE TABLE flota_identidades_fisicas (id INT PRIMARY KEY, estado VARCHAR(20) NOT NULL) ENGINE=InnoDB;
      CREATE TABLE flota_identidad_miembros (vehiculo_id INT PRIMARY KEY, identidad_id INT NOT NULL) ENGINE=InnoDB;
      CREATE TABLE flota_identidad_empresas (identidad_id INT NOT NULL, empresa_id INT NOT NULL) ENGINE=InnoDB;
      CREATE TABLE flota_identidad_aprobaciones (identidad_id INT NOT NULL, empresa_id INT NOT NULL) ENGINE=InnoDB;
      INSERT INTO empresas VALUES (1,'Kuiqtrans / Logiservicios Mónaco'),(2,'Otra'),(4,'Frescofresh');`);
    // El helper solo mide el esquema físico como COMPLETO si existen las 4 tablas InnoDB y TODAS sus guardas: se crean guardas vacías con esos nombres.
    const tablas = ["flota_identidades_fisicas", "flota_identidad_miembros", "flota_identidad_empresas", "flota_identidad_aprobaciones"];
    const combos = tablas.flatMap(t => ["BEFORE", "AFTER"].flatMap(m => ["INSERT", "UPDATE", "DELETE"].map(e => [t, m, e])));
    for (const [i, n] of guardasFisicas.entries()) { const [t, m, e] = combos[i]; await admin.query(`CREATE TRIGGER \`${n}\` ${m} ${e} ON ${t} FOR EACH ROW SET @guarda_vacia = 1`); }
    pool = mysql.createPool({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", database: base });
  }, 120_000);
  afterAll(async () => { try { await pool?.end(); await admin?.query(`DROP DATABASE IF EXISTS ${base}`); await admin?.end(); } catch { /* mejor esfuerzo */ } });
  const limpiar = () => admin.query("DELETE FROM flota_vehiculo_acceso; DELETE FROM flota_identidad_miembros; DELETE FROM flota_identidades_fisicas; DELETE FROM flota_vehiculos");
  async function conflictos(vehiculo: number, empresas: number[]) { const c = await conn(); try { return await conflictosAlCompartirTx(c, vehiculo, empresas); } finally { c.release(); } }

  it("detecta la ficha propia de la empresa destino con la misma placa comparable (guiones, espacios, mayúsculas)", async () => {
    await limpiar();
    await admin.query("INSERT INTO flota_vehiculos VALUES (651,4,'C-092BXF',1),(1300,1,' c092 bxf ',1),(9001,1,'P-000AAA',1)");
    expect(await conflictos(651, [1])).toEqual([{ empresaId: 1, nombre: "Kuiqtrans / Logiservicios Mónaco" }]);
    expect(await conflictos(651, [2])).toEqual([]); // la empresa 2 no tiene esa placa
  });
  it("una ficha local inactiva, una comparticion ya existente y la empresa dueña no generan conflicto", async () => {
    await limpiar();
    await admin.query("INSERT INTO flota_vehiculos VALUES (684,4,'C-558BSJ',1),(1301,1,'C-558BSJ',0)");
    expect(await conflictos(684, [1])).toEqual([]); // inactiva
    await admin.query("UPDATE flota_vehiculos SET activo=1 WHERE id=1301; INSERT INTO flota_vehiculo_acceso VALUES (684,1)");
    expect(await conflictos(684, [1])).toEqual([]); // ya compartida: no se vuelve a revisar
    await admin.query("DELETE FROM flota_vehiculo_acceso");
    expect(await conflictos(684, [4])).toEqual([]); // la dueña no es destino
  });
  it("identidad física APROBADA entre las dos fichas permite compartir; PROPUESTA no", async () => {
    await limpiar();
    await admin.query("INSERT INTO flota_vehiculos VALUES (602,4,'C-034BXR',1),(1296,1,'C-034BXR',1); INSERT INTO flota_identidades_fisicas VALUES (1,'PROPUESTA'); INSERT INTO flota_identidad_miembros VALUES (602,1),(1296,1)");
    expect(await conflictos(602, [1])).toHaveLength(1);
    await admin.query("UPDATE flota_identidades_fisicas SET estado='APROBADA' WHERE id=1");
    expect(await conflictos(602, [1])).toEqual([]);
  });
  it("una identidad aprobada con OTRA ficha no resuelve el conflicto", async () => {
    await limpiar();
    await admin.query("INSERT INTO flota_vehiculos VALUES (603,4,'C-035BXR',1),(1297,1,'C-035BXR',1),(1400,2,'C-035BXR',1); INSERT INTO flota_identidades_fisicas VALUES (1,'APROBADA'); INSERT INTO flota_identidad_miembros VALUES (603,1),(1400,1)");
    expect(await conflictos(603, [1])).toHaveLength(1); // 603 está unida a 1400, no a 1297
  });
  it("las consultas son de solo lectura sobre datos: no cambia ninguna fila", async () => {
    await limpiar();
    await admin.query("INSERT INTO flota_vehiculos VALUES (651,4,'C-092BXF',1),(1300,1,'C-092BXF',1)");
    const antes = JSON.stringify((await admin.query("SELECT * FROM flota_vehiculos ORDER BY id"))[0]);
    await conflictos(651, [1]);
    expect(JSON.stringify((await admin.query("SELECT * FROM flota_vehiculos ORDER BY id"))[0])).toBe(antes);
    expect((await admin.query("SELECT COUNT(*) n FROM flota_vehiculo_acceso") as unknown as [{ n: number }[]])[0][0].n).toBe(0);
  });
});
