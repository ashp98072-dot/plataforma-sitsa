// Discovery de vehículos duplicados (SOLO LECTURA) ejecutado contra MariaDB 11.8.9 REAL y desechable (pipe sin red). Se omite sin CB2_587_PIPE.
// Esquema mínimo sintético con las mismas restricciones relevantes de producción (UNIQUE empresa+placa exacta, FK a flota_vehiculos, referencias sin FK).
import { readFileSync } from "node:fs";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });
const pipe = process.env.CB2_587_PIPE ?? "", BARRA = String.fromCharCode(92), DB = "flota_dup_lab", OTRA = "flota_dup_otra";
let admin: mysql.Connection;
const rowsDe = (r: unknown) => (r as unknown[]).filter(Array.isArray) as RowDataPacket[][];
/** Ejecuta el archivo completo con parámetros y devuelve los resultados de cada SELECT en orden. */
async function correr(params: { ids?: string; empresa?: number | null; esquema?: string | null; activa?: string } = {}) {
  let sql = readFileSync("sql/discovery-2026-11-flota-vehiculos-duplicados.sql", "utf8");
  // Los parámetros se escapan con el cliente (mysql2): un valor malicioso llega como TEXTO al archivo, que es quien debe rechazarlo.
  const lit = (v: unknown) => (v === null || v === undefined ? "NULL" : admin.escape(v));
  sql = sql.replace("SET @esquema = NULL;", `SET @esquema = ${lit(params.esquema)};`).replace("SET @ids = '2,3,6';", `SET @ids = ${lit(params.ids ?? "2,3,6")};`).replace("SET @empresa = NULL;", `SET @empresa = ${lit(params.empresa)};`);
  await admin.query(`USE ${params.activa ?? DB}`);
  const [r] = await admin.query(sql); return rowsDe(r);
}

describe.skipIf(!pipe)("discovery de vehículos duplicados: solo lectura, por empresa y sin asumir IDs libres (MariaDB 11.8.9)", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    admin = await mysql.createConnection({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v"); expect(v.v).toMatch(/^11\.8\.9-MariaDB/);
    await admin.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB} CHARACTER SET utf8mb4; USE ${DB};
      CREATE TABLE flota_vehiculos (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL, marca VARCHAR(80), modelo VARCHAR(80), tipo_unidad VARCHAR(20) NOT NULL DEFAULT 'VEHICULO', chasis VARCHAR(80), km_actual INT, en_taller TINYINT(1) NOT NULL DEFAULT 0, estado VARCHAR(40) NOT NULL DEFAULT 'Activo', activo TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uq_flota_placa (empresa_id, placa), UNIQUE KEY uq_flota_vehiculos_empresa_id (empresa_id, id)) ENGINE=InnoDB;
      CREATE TABLE flota_viajes (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, vehiculo_id INT NOT NULL, estado VARCHAR(20), CONSTRAINT fk_v FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE CASCADE) ENGINE=InnoDB;
      CREATE TABLE flota_cb2_consumos (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, vehiculo_id INT NULL, vale VARCHAR(20), UNIQUE KEY uq_vale_unidad (empresa_id, vehiculo_id, vale), CONSTRAINT fk_c FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE RESTRICT) ENGINE=InnoDB;
      CREATE TABLE tms_planes_viaje (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, tc_vehiculo_id INT NULL, estado VARCHAR(20)) ENGINE=InnoDB;
      CREATE TABLE tms_unidades (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, flota_vehiculo_id INT NULL) ENGINE=InnoDB;
      CREATE TABLE tms_solicitud_fondo_lineas (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, vehiculo_id INT NULL) ENGINE=InnoDB;
      CREATE TABLE flota_vehiculo_acceso (vehiculo_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY (vehiculo_id, empresa_id)) ENGINE=InnoDB;
      INSERT INTO flota_vehiculos (id, empresa_id, placa, marca, tipo_unidad, chasis, km_actual) VALUES
        (2, 1, '558 BSJ', 'Hino', 'VEHICULO', 'CH-111', 1000), (3, 1, '558BSJ', 'Hino', 'VEHICULO', 'CH-111', 1500), (4, 1, 'C-001ABC', 'Isuzu', 'VEHICULO', 'CH-222', 10),
        (6, 2, '558-BSJ', 'Otra', 'VEHICULO', 'CH-999', 5), (7, 2, 'P-777XYZ', NULL, 'VEHICULO', NULL, NULL);
      INSERT INTO flota_viajes (empresa_id, vehiculo_id, estado) VALUES (1, 2, 'cerrado'), (1, 3, 'cerrado'), (1, 3, 'abierto');
      INSERT INTO flota_cb2_consumos (empresa_id, vehiculo_id, vale) VALUES (1, 2, 'A1'), (1, 3, 'A1'), (1, 3, 'A2');
      INSERT INTO tms_planes_viaje (empresa_id, tc_vehiculo_id, estado) VALUES (1, 2, 'Programado'), (1, 3, 'Cerrado');
      INSERT INTO tms_unidades (empresa_id, flota_vehiculo_id) VALUES (1, 3);
      INSERT INTO tms_solicitud_fondo_lineas (empresa_id, vehiculo_id) VALUES (1, 2);
      INSERT INTO flota_vehiculo_acceso VALUES (3, 2);`);
    // Segundo esquema con datos DISTINGUIBLES: misma estructura, otros IDs/placas/empresas, tablas y alias propios.
    await admin.query(`DROP DATABASE IF EXISTS ${OTRA}; CREATE DATABASE ${OTRA} CHARACTER SET utf8mb4; USE ${OTRA};
      CREATE TABLE flota_vehiculos (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL, marca VARCHAR(80), modelo VARCHAR(80), tipo_unidad VARCHAR(20) NOT NULL DEFAULT 'VEHICULO', chasis VARCHAR(80), km_actual INT, en_taller TINYINT(1) NOT NULL DEFAULT 0, estado VARCHAR(40) NOT NULL DEFAULT 'Activo', activo TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uq_flota_placa (empresa_id, placa)) ENGINE=InnoDB AUTO_INCREMENT=500;
      CREATE TABLE flota_viajes (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, vehiculo_id INT NOT NULL, estado VARCHAR(20), CONSTRAINT fk_vo FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE RESTRICT) ENGINE=InnoDB;
      CREATE TABLE solo_en_otra (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, vehiculo_id INT NULL) ENGINE=InnoDB;
      CREATE TABLE flota_vehiculos_fusiones (origen_id INT PRIMARY KEY, destino_id INT NOT NULL, empresa_id INT NOT NULL, motivo VARCHAR(1000) NOT NULL) ENGINE=InnoDB;
      INSERT INTO flota_vehiculos (id, empresa_id, placa, marca, chasis) VALUES (10, 5, 'P 777 XYZ', 'Otra', 'OX-1'), (11, 5, 'P777XYZ', 'Otra', 'OX-1'), (12, 5, 'T-100AAA', 'Otra', 'OX-2'), (2, 9, 'Z-001ZZZ', 'IdDistinto', NULL);
      INSERT INTO flota_viajes (empresa_id, vehiculo_id, estado) VALUES (5, 10, 'cerrado'), (5, 10, 'cerrado'), (5, 10, 'cerrado'), (5, 10, 'cerrado'), (5, 11, 'cerrado');
      INSERT INTO solo_en_otra (empresa_id, vehiculo_id) VALUES (5, 10);
      INSERT INTO flota_vehiculos_fusiones VALUES (11, 10, 5, 'alias de la otra base');`);
  });
  afterAll(async () => { await admin?.query(`DROP DATABASE IF EXISTS ${DB}; DROP DATABASE IF EXISTS ${OTRA}`).catch(() => undefined); await admin?.end(); });

  it("agrupa duplicados SOLO dentro de la misma empresa: «558 BSJ» y «558BSJ» (empresa 1); la misma placa de la empresa 2 no se mezcla", async () => {
    const [grupos, detalle] = await correr();
    expect(grupos).toHaveLength(1); expect(grupos[0]).toMatchObject({ empresa_id: 1, placa_normalizada: "558BSJ", vehiculos: 2, ids: "2,3" });
    expect(detalle.map(d => Number(d.id))).toEqual([2, 3, 6]);   // los inspeccionados, incluida la unidad 6 de OTRA empresa
    expect((await correr({ empresa: 2 }))[0]).toHaveLength(0);
  });
  it("el ID candidato 6 NO se asume libre: aparece ocupado por otra empresa, con el siguiente AUTO_INCREMENT", async () => {
    const [, , disponibilidad] = await correr();
    const seis = disponibilidad.find(r => Number(r.id_consultado) === 6)!;
    expect(Number(seis.ocupado)).toBe(1); expect(seis).toMatchObject({ empresa_id: 2, placa: "558-BSJ" }); expect(Number(seis.siguiente_auto_increment)).toBeGreaterThan(7); expect(Number(seis.id_maximo)).toBe(7);
    const libre = (await correr({ ids: "5" }))[2][0]; expect(Number(libre.ocupado)).toBe(0);
  });
  it("inventario dinámico de referencias (con y sin FK) y conteo real por ID, sin tocar datos", async () => {
    const r = await correr(), inventario = r[3], conteos = r[4];
    const col = (t: string, c: string) => inventario.find(x => x.tabla === t && x.columna === c);
    expect(col("flota_viajes", "vehiculo_id")?.fk).toContain("flota_vehiculos(id)"); expect(col("flota_viajes", "vehiculo_id")?.reglas_fk).toContain("CASCADE");
    expect(col("flota_cb2_consumos", "vehiculo_id")?.reglas_fk).toContain("RESTRICT");
    expect(col("tms_planes_viaje", "tc_vehiculo_id")?.fk).toBeNull(); expect(col("tms_unidades", "flota_vehiculo_id")?.fk).toBeNull();   // referencias SIN FK: no las protege el motor
    const n = (t: string, id: number) => Number(conteos.find(x => x.tabla === t && Number(x.vehiculo_id) === id)?.filas ?? 0);
    expect(n("flota_viajes", 2)).toBe(1); expect(n("flota_viajes", 3)).toBe(2); expect(n("flota_cb2_consumos", 3)).toBe(2); expect(n("tms_planes_viaje", 2)).toBe(1); expect(n("tms_unidades", 3)).toBe(1); expect(n("tms_solicitud_fondo_lineas", 2)).toBe(1);
    expect(await admin.query("SELECT COUNT(*) n FROM flota_vehiculos").then(([x]) => Number((x as RowDataPacket[])[0].n))).toBe(5);
  });
  it("claves únicas con columnas de vehículo, accesos compartidos y conflicto de pares con diferencias de datos", async () => {
    const r = await correr();
    expect(r[5].some(x => x.tabla === "flota_cb2_consumos" && x.indice === "uq_vale_unidad" && x.columnas === "empresa_id,vehiculo_id,vale")).toBe(true);   // reasignar 3→2 chocaría con el vale A1
    const aux = r[7]; expect(aux.some(x => x.fuente === "acceso" && Number(x.id_a) === 3 && Number(x.id_b) === 2)).toBe(true);
    expect(aux.some(x => x.fuente === "fusion" && String(x.detalle).includes("ausente"))).toBe(true);
    const par = r[8]; expect(par).toHaveLength(1); expect(par[0]).toMatchObject({ empresa_id: 1, id_a: 2, id_b: 3, placa_a: "558 BSJ", placa_b: "558BSJ" });
    expect(Number(par[0].mismo_chasis)).toBe(1); expect(par[0].km_a).toBe(1000); expect(par[0].km_b).toBe(1500);
  });
  it("con la tabla de fusiones instalada informa los alias; el modo @esquema explícito produce el mismo resultado", async () => {
    await admin.query(`USE ${DB}; CREATE TABLE flota_vehiculos_fusiones (origen_id INT PRIMARY KEY, destino_id INT NOT NULL, empresa_id INT NOT NULL, motivo VARCHAR(1000) NOT NULL) ENGINE=InnoDB; INSERT INTO flota_vehiculos_fusiones VALUES (3, 4, 1, 'prueba')`);
    const normal = await correr(), explicito = await correr({ esquema: DB });
    expect(normal[7].some(x => x.fuente === "fusion" && Number(x.id_a) === 3 && Number(x.id_b) === 4)).toBe(true);
    expect(explicito.map(x => x.length)).toEqual(normal.map(x => x.length));
    await admin.query("DROP TABLE flota_vehiculos_fusiones");
  });
  it("el archivo es de SOLO LECTURA: sin INSERT/UPDATE/DELETE/ALTER/DROP/TRUNCATE/CREATE", () => {
    const sin = readFileSync("sql/discovery-2026-11-flota-vehiculos-duplicados.sql", "utf8").split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(sin).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|RENAME|REPLACE\s+INTO|GRANT)\b/i.source ? /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+(TABLE|DATABASE|INDEX)|TRUNCATE|CREATE\s+(TABLE|INDEX|TRIGGER)|RENAME\s+TABLE|GRANT\s)/i : /x^/);
  });

  it("@esquema: las 9 consultas leen EXCLUSIVAMENTE el esquema indicado aunque DATABASE() apunte a otra base (dos esquemas con datos distinguibles)", async () => {
    const lab = await correr({ ids: "2,3,6" }), otra = await correr({ esquema: OTRA, ids: "10,11,500" });   // base activa = lab; se pide OTRA
    // 1 y 9: grupos/pares de OTRA (empresa 5, «P 777 XYZ» / «P777XYZ»), nada de la base activa («558 BSJ»)
    expect(otra[0]).toHaveLength(1); expect(otra[0][0]).toMatchObject({ empresa_id: 5, placa_normalizada: "P777XYZ", ids: "10,11" }); expect(JSON.stringify(otra)).not.toContain("558");
    expect(otra[8]).toHaveLength(1); expect(otra[8][0]).toMatchObject({ empresa_id: 5, id_a: 10, id_b: 11 });
    // 2: solo vehículos de OTRA con esos IDs
    expect(otra[1].map(v => Number(v.id))).toEqual([10, 11]);
    // 3: el ID 2 existe en ambos esquemas con datos distintos; AUTO_INCREMENT y máximo salen de OTRA (500/…), no de la base activa
    const d = otra[2]; expect(Number(d.find(r => Number(r.id_consultado) === 500)!.ocupado)).toBe(0); expect(Number(d[0].siguiente_auto_increment)).toBeGreaterThanOrEqual(500); expect(Number(d[0].id_maximo)).toBe(12);
    const dos = (await correr({ esquema: OTRA, ids: "2" }))[2][0]; expect(dos).toMatchObject({ empresa_id: 9, placa: "Z-001ZZZ" }); expect(Number(lab[2].find(r => Number(r.id_consultado) === 2)!.empresa_id)).toBe(1);
    // 4: inventario con la tabla que solo existe en OTRA y con las reglas FK de OTRA (RESTRICT), no las de la base activa (CASCADE)
    expect(otra[3].some(x => x.tabla === "solo_en_otra" && x.columna === "vehiculo_id")).toBe(true); expect(lab[3].some(x => x.tabla === "solo_en_otra")).toBe(false);
    expect(otra[3].find(x => x.tabla === "flota_viajes")!.reglas_fk).toContain("RESTRICT"); expect(lab[3].find(x => x.tabla === "flota_viajes")!.reglas_fk).toContain("CASCADE");
    // 5: conteos de OTRA (4 viajes del vehículo 10), que no existen en la base activa
    const n = (r: RowDataPacket[][], t: string, id: number) => Number(r[4].find(x => x.tabla === t && Number(x.vehiculo_id) === id)?.filas ?? 0);
    expect(n(otra, "flota_viajes", 10)).toBe(4); expect(n(otra, "solo_en_otra", 10)).toBe(1); expect(n(lab, "flota_viajes", 10)).toBe(0); expect(n(otra, "flota_cb2_consumos", 3)).toBe(0);
    // 6 y 7: sin las claves únicas/tablas de la base activa
    expect(otra[5].some(x => x.tabla === "flota_cb2_consumos")).toBe(false);
    // 8: el alias 11→10 de OTRA; la base activa no tiene tabla de fusiones en este punto, sus accesos no aparecen
    expect(otra[7].some(x => x.fuente === "fusion" && Number(x.id_a) === 11 && Number(x.id_b) === 10)).toBe(true); expect(otra[7].some(x => x.fuente === "acceso" && String(x.detalle).includes("ausente"))).toBe(true);
    expect(lab[7].some(x => x.fuente === "fusion" && String(x.detalle).includes("ausente"))).toBe(true);
  });
  it("@esquema = la base activa equivale a NULL; con information_schema activa (phpMyAdmin) y @esquema explícito se lee ese esquema; el inverso tampoco filtra datos", async () => {
    const nulo = await correr(), explicito = await correr({ esquema: DB }), desdeInfo = await correr({ esquema: DB, activa: "information_schema" });
    expect(explicito.map(x => JSON.stringify(x))).toEqual(nulo.map(x => JSON.stringify(x))); expect(desdeInfo.map(x => JSON.stringify(x))).toEqual(nulo.map(x => JSON.stringify(x)));
    const inverso = await correr({ esquema: DB, activa: OTRA, ids: "2,3,6" }); expect(inverso[0][0]).toMatchObject({ empresa_id: 1, placa_normalizada: "558BSJ" }); expect(JSON.stringify(inverso)).not.toContain("777");
  });
  it("esquema inexistente, nombre inválido o parámetros con inyección: ESQUEMA_INVALIDO y ningún dato de ninguna base", async () => {
    for (const p of [{ esquema: "no_existe_xyz" }, { esquema: "a`b" }, { esquema: DB + BARRA }, { esquema: "information_schema' OR '1'='1" }, { ids: "2;DROP TABLE flota_vehiculos" }, { ids: "2,3'" }, { empresa: "1 OR 1=1" as unknown as number }]) {
      const r = await correr(p as Parameters<typeof correr>[0]);
      for (const i of [0, 1, 2, 4, 7, 8]) expect(r[i], JSON.stringify(p) + " #" + (i + 1)).toEqual([expect.objectContaining({ error: "ESQUEMA_INVALIDO" })]);
      for (const i of [3, 5, 6]) expect(r[i]).toEqual([]);
    }
    expect(await admin.query(`SELECT COUNT(*) n FROM ${DB}.flota_vehiculos`).then(([x]) => Number((x as RowDataPacket[])[0].n))).toBe(5);   // nada se modificó
  });
});
