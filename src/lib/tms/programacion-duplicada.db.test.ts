// TMS-PROGRAMACION-DUPLICADA-1 — prueba contra MariaDB 11.8.9 REAL y desechable (pipe sin red). Se omite sin CB2_587_PIPE.
// Verifica (1) el SQL real del anti-duplicado por contenido (`gemelosExactosEnDestino`) y (2) que el diagnóstico de SOLO LECTURA localiza los 33 pares,
// sus relaciones y su origen, sin modificar ni una fila. Las tablas son un subconjunto mínimo con los nombres y columnas reales que usan ambas consultas.
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });
const pipe = process.env.CB2_587_PIPE ?? "", BARRA = String.fromCharCode(92), LAB = "tms_prog_duplicada", OTRA = "tms_prog_duplicada_otra";
const state = vi.hoisted(() => ({ conn: null as null | { query: (sql: string, p?: unknown[]) => Promise<[unknown, unknown]> } }));
vi.mock("@/lib/db", () => ({ query: async (sql: string, p?: unknown[]) => (await state.conn!.query(sql, p))[0], execute: vi.fn(), getPool: vi.fn() }));
import { claveGemelo, gemelosExactosEnDestino } from "./programacion-lote";

let admin: mysql.Connection;
const DDL = `
CREATE TABLE tms_unidades(id INT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL);
CREATE TABLE tms_personal(id INT PRIMARY KEY, empresa_id INT NOT NULL, id_empleado INT NULL, tipo VARCHAR(20));
CREATE TABLE tms_planes_viaje(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(80) NOT NULL, cliente_id INT NULL, unidad_id INT NULL, piloto_id INT NULL,
  fecha_plan DATE NOT NULL, hora_carga VARCHAR(20) NULL, regreso_estimado DATETIME NULL, tarifa_comercial DECIMAL(12,2) NULL, ruta_id INT NULL, ruta_codigo_historico VARCHAR(40) NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Programado', tipo_viaje VARCHAR(20) NOT NULL DEFAULT 'Propio', notas TEXT NULL, UNIQUE KEY uq_plan(empresa_id, codigo)) ENGINE=InnoDB;
CREATE TABLE tms_plan_auxiliares(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NOT NULL, personal_id INT NOT NULL);
CREATE TABLE tms_plan_paradas(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NOT NULL);
CREATE TABLE tms_viaticos(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NOT NULL);
CREATE TABLE tms_evidencias(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NOT NULL);
CREATE TABLE tms_gastos_operativos(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NULL);
CREATE TABLE flota_viajes(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NULL);
CREATE TABLE fact_factura_viajes(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NOT NULL);
CREATE TABLE tms_viaje_liquidaciones(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NOT NULL);
CREATE TABLE tms_viaje_cargos_adicionales(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NOT NULL);
CREATE TABLE tms_solicitudes_cliente(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NULL);
CREATE TABLE tms_plan_origen(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NOT NULL, tipo VARCHAR(20) NOT NULL, plan_origen_id INT NULL, fecha_destino DATE NOT NULL, creado_por VARCHAR(100) NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE auditoria(id BIGINT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NULL, usuario VARCHAR(100) NULL, accion VARCHAR(80) NOT NULL, modulo VARCHAR(40) NULL, detalle TEXT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);`;
const TABLAS = ["tms_planes_viaje", "tms_plan_auxiliares", "tms_plan_paradas", "tms_viaticos", "tms_evidencias", "tms_gastos_operativos", "flota_viajes", "fact_factura_viajes", "tms_viaje_liquidaciones", "tms_viaje_cargos_adicionales", "tms_solicitudes_cliente", "tms_plan_origen", "auditoria"];
const conteos = async () => Object.fromEntries(await Promise.all(TABLAS.map(async (t) => [t, Number((await admin.query<RowDataPacket[]>(`SELECT COUNT(*) c FROM ${LAB}.${t}`))[0][0].c)])));
const cod = (n: number) => `PLAN-20261119-${String(n).padStart(3, "0")}`;

async function diagnostico(esquema: string | null, fecha = "2026-11-19", empresa: number | null = null, activa = LAB) {
  const texto = readFileSync(path.join("sql", "diagnostico-2026-11-tms-programacion-duplicada.sql"), "utf8").replace(/^﻿/, "")
    .replace("SET @esquema = NULL;", esquema === null ? "SET @esquema = NULL;" : `SET @esquema = ${admin.escape(esquema)};`)
    .replace("SET @fecha   = '2026-11-19';", `SET @fecha = ${admin.escape(fecha)};`).replace("SET @empresa = NULL;", `SET @empresa = ${empresa === null ? "NULL" : empresa};`);
  await admin.query(`USE ${activa}`);
  return ((await admin.query(texto))[0] as unknown[]).filter(Array.isArray) as RowDataPacket[][];
}

describe.skipIf(!pipe)("programación duplicada: anti-duplicado por contenido y diagnóstico de solo lectura (MariaDB 11.8.9)", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    admin = await mysql.createConnection({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v"); expect(v.v).toMatch(/^11\.8\.9-MariaDB/);
    await admin.query(`DROP DATABASE IF EXISTS ${LAB}; DROP DATABASE IF EXISTS ${OTRA}; CREATE DATABASE ${OTRA} CHARACTER SET utf8mb4; CREATE DATABASE ${LAB} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; USE ${LAB}`);
    await admin.query(DDL);
    await admin.query(`INSERT INTO tms_unidades VALUES (1,7,'P-1'),(2,7,'P-2'),(3,8,'P-1'); INSERT INTO tms_personal VALUES (10,7,101,'Piloto'),(11,7,102,'Piloto'),(12,7,201,'Auxiliar'),(30,8,101,'Piloto')`);
    // Lote original 001..033 (alta por Excel/manual: SIN tms_plan_origen) y su gemelo 034..066 nacido de una COPIA de otro día (CON tms_plan_origen).
    const vals: string[] = [];
    for (let i = 1; i <= 33; i++) { const h = `${String(Math.floor((i - 1) / 4)).padStart(2, "0")}:${String(((i - 1) % 4) * 15).padStart(2, "0")}`; vals.push(`(7,'${cod(i)}',3,1,10,'2026-11-19','${h}',10,'R${i}')`); }
    for (let i = 1; i <= 33; i++) { const h = `${String(Math.floor((i - 1) / 4)).padStart(2, "0")}:${String(((i - 1) % 4) * 15).padStart(2, "0")}:00`; vals.push(`(7,'${cod(i + 33)}',3,1,10,'2026-11-19','${h}',10,'R${i}')`); }   // hora con segundos: la comparación usa HH:mm
    await admin.query(`INSERT INTO tms_planes_viaje(empresa_id,codigo,cliente_id,unidad_id,piloto_id,fecha_plan,hora_carga,ruta_id,ruta_codigo_historico) VALUES ${vals.join(",")}`);
    // Casos que NO son duplicado: misma ruta/unidad/piloto con otra hora; gemelo CANCELADO; otra empresa con la misma placa/empleado; viaje tercerizado.
    await admin.query(`INSERT INTO tms_planes_viaje(empresa_id,codigo,cliente_id,unidad_id,piloto_id,fecha_plan,hora_carga,ruta_id,estado,tipo_viaje) VALUES
      (7,'PLAN-20261119-100',3,1,10,'2026-11-19','23:59',10,'Programado','Propio'),
      (7,'PLAN-20261119-101',3,2,11,'2026-11-19','06:00',77,'Cancelado','Propio'),
      (7,'PLAN-20261119-102',3,2,11,'2026-11-19','06:00',77,'Programado','Propio'),
      (8,'PLAN-20261119-001',3,3,30,'2026-11-19','00:00',10,'Programado','Propio'),
      (7,'PLAN-20261119-103',3,NULL,NULL,'2026-11-19','07:00',78,'Programado','Tercerizado'),
      (7,'PLAN-20261119-104',3,NULL,NULL,'2026-11-19','07:00',78,'Programado','Tercerizado')`);
    await admin.query(`INSERT INTO tms_plan_origen(empresa_id,plan_id,tipo,plan_origen_id,fecha_destino,creado_por) SELECT 7,id,'COPIA',id-33,'2026-11-19','jefe' FROM tms_planes_viaje WHERE empresa_id=7 AND codigo BETWEEN 'PLAN-20261119-034' AND 'PLAN-20261119-066'`);
    await admin.query(`INSERT INTO tms_plan_paradas(plan_id) SELECT id FROM tms_planes_viaje WHERE empresa_id=7 AND codigo BETWEEN 'PLAN-20261119-001' AND 'PLAN-20261119-066'; INSERT INTO fact_factura_viajes(plan_id) SELECT id FROM tms_planes_viaje WHERE empresa_id=7 AND codigo='PLAN-20261119-005'; INSERT INTO tms_plan_auxiliares(plan_id,personal_id) SELECT id,12 FROM tms_planes_viaje WHERE empresa_id=7 AND codigo IN ('PLAN-20261119-001','PLAN-20261119-034')`);
    await admin.query(`INSERT INTO auditoria(empresa_id,usuario,accion,modulo,detalle) VALUES (7,'jefe','copiar_programacion','tms','Copió programación 18/11/2026 → 19/11/2026. 33 plan(es) creados: PLAN-20261119-034, PLAN-20261119-035.'),(7,'otro','importar_programacion','tms','{"archivo":"x.xlsx"}'),(7,'otro','login','auth','x')`);
    state.conn = admin as never;
  });
  afterAll(async () => { await admin?.query(`DROP DATABASE IF EXISTS ${LAB}; DROP DATABASE IF EXISTS ${OTRA}`).catch(() => undefined); await admin?.end(); });

  it("gemelosExactosEnDestino (SQL real): 33 claves del día; compara HH:mm aunque la hora traiga segundos; ignora cancelados, tercerizados y otra empresa", async () => {
    await admin.query(`USE ${LAB}`);
    const m = await gemelosExactosEnDestino(7, "2026-11-19");
    expect(m.get(claveGemelo(10, "00:00", "p-1", 101))).toBe("PLAN-20261119-001");   // el de menor id gana; placa normalizada; también existe su gemelo -034 (hora 00:00:00)
    expect(m.get(claveGemelo(10, "08:00", "P-1", 101))).toBe(cod(33));
    expect(m.get(claveGemelo(10, "23:59", "P-1", 101))).toBe("PLAN-20261119-100");
    expect(m.get(claveGemelo(77, "06:00", "P-2", 102))).toBe("PLAN-20261119-102");   // el cancelado (-101) NO cuenta
    expect(m.has(claveGemelo(78, "07:00", "P-1", 101))).toBe(false);   // tercerizado: sin recursos internos
    expect(m.size).toBe(33 + 2);   // 33 (001..033/034..066 comparten clave) + 23:59 + 77/06:00
    expect((await gemelosExactosEnDestino(8, "2026-11-19")).get(claveGemelo(10, "00:00", "P-1", 101))).toBe("PLAN-20261119-001");   // la empresa 8 solo ve lo suyo (id distinto)
    expect((await gemelosExactosEnDestino(7, "2026-11-20")).size).toBe(0);
  });

  it("diagnóstico de solo lectura: R2 devuelve los 33 pares (a<b, distancia 33, origen de la copia) y NO inventa pares por ruta igual con otra hora", async () => {
    const antes = await conteos();
    const r = await diagnostico(null);
    expect(r[0][0].verificacion).toMatch(/^OK: se leerá el esquema tms_prog_duplicada/);
    const resumen = r[1] as RowDataPacket[]; expect(resumen.reduce((s, x) => s + Number(x.planes), 0)).toBe(66 + 5 + 1);   // empresa 7: 66 + 5 sueltos; empresa 8: 1
    const pares = r[2] as RowDataPacket[];
    const reales = pares.filter((x) => /^PLAN-20261119-0(0[1-9]|[12]\d|3[0-3])$/.test(String(x.codigo_a)));
    expect(reales).toHaveLength(33);
    for (const x of reales) { const n = Number(String(x.codigo_a).slice(-3)); expect(x.codigo_b).toBe(cod(n + 33)); expect(Number(x.distancia_id)).toBe(33); expect(x.origen_a_tipo).toBeNull(); expect(x.origen_b_tipo).toBe("COPIA"); expect(x.creado_por_b).toBe("jefe"); expect(Number(x.misma_tarifa)).toBe(1); }
    // Los únicos otros pares son el cancelado/activo (101/102: se muestran con su estado) y los dos tercerizados idénticos (103/104): R2 los reporta y decide la revisión humana.
    expect(pares.filter((x) => !reales.includes(x)).map((x) => `${x.codigo_a}/${x.estado_a}→${x.codigo_b}/${x.estado_b}`)).toEqual(["PLAN-20261119-101/Cancelado→PLAN-20261119-102/Programado", "PLAN-20261119-103/Programado→PLAN-20261119-104/Programado"]);
    expect(pares.every((x) => x.codigo_a !== "PLAN-20261119-100" && x.codigo_b !== "PLAN-20261119-100")).toBe(true);   // misma ruta/unidad/piloto con OTRA hora: no es par
    expect(reales[0].auxiliares_a).toBe("12"); expect(reales[0].auxiliares_b).toBe("12"); expect(reales[1].auxiliares_a).toBeNull();
    expect(await conteos()).toEqual(antes);   // no modificó ni una fila
  });

  it("R3 muestra las relaciones de cada plan del par (facturas, paradas…) y R4 el lote que los creó (usuario y hora); la empresa 8 no se mezcla", async () => {
    const r = await diagnostico(null, "2026-11-19", 7);
    const rel = r[3] as RowDataPacket[];
    expect(rel.length).toBeGreaterThanOrEqual(66);
    const c5 = rel.find((x) => x.codigo === cod(5))!; expect(Number(c5.facturas)).toBe(1); expect(Number(c5.paradas)).toBe(1);
    const c38 = rel.find((x) => x.codigo === cod(38))!; expect(Number(c38.facturas)).toBe(0);   // la copia -038 (de -005) NO tiene factura
    expect(Number(rel.find((x) => x.codigo === cod(1))!.copias_que_nacieron_de_este)).toBe(1);
    expect(rel.every((x) => Number(x.empresa_id) === 7)).toBe(true);
    const aud = r[4] as RowDataPacket[]; expect(aud.map((a) => a.accion)).toEqual(["copiar_programacion", "importar_programacion"]); expect(aud[0].usuario).toBe("jefe");
  });

  it("CONCURRENCIA real (MariaDB): el 2.º GET_LOCK ESPERA al 1.º; tras su COMMIT + RELEASE_LOCK el 2.º ve el viaje y detecta el gemelo (misma clave)", async () => {
    const abrir = () => mysql.createConnection({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: "root", password: "", database: LAB });
    const [c1, c2] = [await abrir(), await abrir()];
    try {
      const K = "tms_traslape_7_prueba";
      expect(((await c1.query<RowDataPacket[]>("SELECT GET_LOCK(?, 8) AS l", [K]))[0][0]).l).toBe(1);
      let c2Obtuvo = false;
      const espera = c2.query<RowDataPacket[]>("SELECT GET_LOCK(?, 8) AS l", [K]).then(([r]) => { c2Obtuvo = true; return r[0].l; });
      await new Promise((r) => setTimeout(r, 300)); expect(c2Obtuvo).toBe(false);   // sigue esperando mientras c1 lo tiene
      await c1.beginTransaction();
      await c1.query("INSERT INTO tms_planes_viaje(empresa_id,codigo,cliente_id,unidad_id,piloto_id,fecha_plan,hora_carga,ruta_id,estado,tipo_viaje) VALUES (7,'PLAN-20261125-001',3,1,10,'2026-11-25','09:00',5,'Programado','Propio')");
      await c1.commit();   // primero commit…
      await c1.query("SELECT RELEASE_LOCK(?)", [K]);   // …después liberar (mismo orden que confirmarLote)
      expect(await espera).toBe(1);
      expect((await gemelosExactosEnDestino(7, "2026-11-25")).get(claveGemelo(5, "09:00", "P-1", 101))).toBe("PLAN-20261125-001");   // el 2.º ya ve el viaje del 1.º
      await c2.query("SELECT RELEASE_LOCK(?)", [K]);
    } finally { await c1.end(); await c2.end(); }
  });

  it("parámetros inválidos no ejecutan nada; el script no contiene escritura; otro esquema y fecha sin datos devuelven vacío", async () => {
    for (const malo of ["no_existe_xyz", "a`b", "x' OR '1'='1"]) { const r = await diagnostico(malo); expect(r[0][0].verificacion, malo).toMatch(/^PARAMETROS_INVALIDOS/); }
    expect((await diagnostico(null, "2026-11-19; DROP TABLE x"))[0][0].verificacion).toMatch(/^PARAMETROS_INVALIDOS/);
    expect(((await diagnostico(OTRA).catch(() => [[{}]])) as RowDataPacket[][]).length).toBeGreaterThan(0);
    const sinComentarios = readFileSync(path.join("sql", "diagnostico-2026-11-tms-programacion-duplicada.sql"), "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join(" ");
    expect(sinComentarios).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+(TABLE|DATABASE|INDEX|CONSTRAINT)|TRUNCATE|CREATE\s+(TABLE|TEMPORARY|INDEX|TRIGGER|DATABASE)|RENAME\s+TABLE|GRANT\s)/i);
    const vacio = await diagnostico(null, "2030-01-01"); expect((vacio[2] as RowDataPacket[])).toHaveLength(0);
  });
});
