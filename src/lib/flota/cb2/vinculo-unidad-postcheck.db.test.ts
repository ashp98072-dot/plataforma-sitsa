// Postcheck de SOLO LECTURA de `migrate-2026-11-cb2-vinculo-unidad.sql` contra MariaDB 11.8.9 REAL y desechable (pipe sin red). Se omite sin CB2_587_PIPE.
// Comprueba que valida las 4 restricciones CHECK por su definición COMPLETA (firma SHA-256 normalizada) y no por palabras clave: una definición alterada que conserva su nombre
// y todas sus palabras clave se rechaza; las diferencias de formato (mayúsculas, espacios, saltos de línea) se toleran.
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });
const pipe = process.env.CB2_587_PIPE ?? "", BARRA = String.fromCharCode(92), LAB = "cb2_vinculo_postcheck", OTRA = "cb2_vinculo_postcheck_otra";
const sql = (f: string) => readFileSync(path.join("sql", f), "utf8").replace(/^﻿/, "");
const POSTCHECK = "postcheck-2026-11-cb2-vinculo-unidad.sql";
let admin: mysql.Connection;
const NOMBRES = ["ck_cb2_piloto_unico", "ck_cb2_piloto_reportado", "ck_cb2c_unidad_tipo", "ck_cb2c_vinculo"] as const;
async function postcheck(esquema: string | null = null, activa = LAB) {
  const texto = sql(POSTCHECK).replace("SET @esquema = NULL;", esquema === null ? "SET @esquema = NULL;" : `SET @esquema = ${admin.escape(esquema)};`);
  await admin.query(`USE ${activa}`);
  const r = ((await admin.query(texto))[0] as unknown[]).filter(Array.isArray) as RowDataPacket[][];
  return { veredicto: r[0][0] as RowDataPacket, firmas: r[1] ?? [] };
}
const clausula = async (n: string) => String((await admin.query<RowDataPacket[]>("SELECT CHECK_CLAUSE c FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME=?", [n]))[0][0].c);
/** Reemplaza una restricción conservando su nombre. */
const reemplazar = async (n: string, definicion: string) => { await admin.query(`USE ${LAB}; ALTER TABLE flota_cb2_consumos DROP CONSTRAINT IF EXISTS ${n}, ADD CONSTRAINT ${n} CHECK (${definicion})`); };

describe.skipIf(!pipe)("postcheck de vínculo de unidad: definiciones completas, no palabras clave (MariaDB 11.8.9)", () => {
  const originales: Record<string, string> = {};
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    admin = await mysql.createConnection({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v"); expect(v.v).toMatch(/^11\.8\.9-MariaDB/);
    await admin.query(`DROP DATABASE IF EXISTS ${LAB}; DROP DATABASE IF EXISTS ${OTRA}; CREATE DATABASE ${OTRA} CHARACTER SET utf8mb4; CREATE DATABASE ${LAB} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; USE ${LAB}`);
    await admin.query(readFileSync("scripts/ci/combustibles-pr2-lab/base.sql", "utf8"));
    await admin.query("ALTER TABLE flota_vehiculos ADD placa VARCHAR(40) NOT NULL DEFAULT 'C-001ABC', ADD estado VARCHAR(40) NOT NULL DEFAULT 'Activo', ADD activo TINYINT NOT NULL DEFAULT 1; CREATE TABLE empleados(id INT PRIMARY KEY,empresa_id INT NOT NULL,nombre VARCHAR(160),estado VARCHAR(20)) ENGINE=InnoDB");
    await admin.query("INSERT IGNORE INTO empresas VALUES(1,1),(2,1)"); await admin.query("INSERT IGNORE INTO usuarios VALUES(1,1),(2,1)");
    await admin.query("CREATE TABLE flota_combustible_estaciones(id INT PRIMARY KEY,empresa_id INT,proveedor_id INT,nombre VARCHAR(150),activo TINYINT) ENGINE=InnoDB");
    for (const s of sql("migrate-2026-10-combustibles-pr2-consumos-facturas.sql").match(/^CREATE TABLE [\s\S]*?COLLATE=utf8mb4_bin;/gm)!) await admin.query(s);
    await admin.query(sql("migrate-2026-10-combustibles-pr514-asignaciones.sql"));
    for (const f of ["migrate-2026-11-cb2-terceros.sql", "migrate-2026-11-cb2-terceros-directos.sql", "migrate-2026-11-cb2-identidades-independientes.sql", "migrate-2026-11-cb2-piloto-reportado.sql", "migrate-2026-11-cb2-vinculo-unidad.sql"]) await admin.query(sql(f));
    for (const n of NOMBRES) originales[n] = await clausula(n);
  });
  afterAll(async () => { await admin?.query(`DROP DATABASE IF EXISTS ${LAB}; DROP DATABASE IF EXISTS ${OTRA}`).catch(() => undefined); await admin?.end(); });

  /** Tras cada mutación se restaura el estado original para que las pruebas sean independientes. */
  const restaurar = async () => { for (const n of NOMBRES) await reemplazar(n, originales[n]); await admin.query(`USE ${LAB}; ALTER TABLE flota_cb2_consumos MODIFY vinculo_unidad VARCHAR(20) NULL`); };

  it("instalación correcta: OK, con las 4 firmas esperadas, la columna exacta y el conteo de filas", async () => {
    const r = await postcheck(); expect(r.veredicto.veredicto).toBe("OK: VÍNCULO DE UNIDAD INSTALADO"); expect(Number(r.veredicto.checks_con_firma_esperada_de_4)).toBe(4); expect(r.veredicto.checks_distintos).toBe("");
    expect(r.firmas.map(f => [f.nombre, Number(f.coincide)])).toEqual(NOMBRES.map(n => [n, 1]));
  });

  // Mutaciones que CONSERVAN el nombre de la restricción y TODAS las palabras clave (AMBIGUA, SIN_VINCULO, REPORTADO_V1, INDEPENDIENTE_V1…): un LIKE las aceptaría.
  const mutaciones: Record<string, (c: string) => string> = {
    ck_cb2c_vinculo: c => c.replace(/in\s*\('AMBIGUA',\s*'SIN_VINCULO'\)/i, "in ('AMBIGUA','SIN_VINCULO','OTRO')"),
    // Rama nueva (la última ocurrencia): exige JSON en vez de NULL; sigue conteniendo SIN_VINCULO / REPORTADO_V1 / INDEPENDIENTE_V1.
    ck_cb2c_unidad_tipo: c => { const m = [...c.matchAll(/`?identidad_externa`?\s+is\s+null/gi)].at(-1)!; return c.slice(0, m.index) + "`identidad_externa` is not null" + c.slice(m.index! + m[0].length); },
    ck_cb2_piloto_reportado: c => c.replace(/<>/g, "="),
    ck_cb2_piloto_unico: c => c.replace(/\bor\b/i, "and"),
  };
  for (const n of NOMBRES) it(`${n}: una definición alterada que conserva nombre y palabras clave se RECHAZA (y se restaura OK)`, async () => {
    const alterada = mutaciones[n](originales[n]); expect(alterada, "la mutación debe cambiar la definición").not.toBe(originales[n]);
    const palabras = ["SIN_VINCULO", "AMBIGUA", "REPORTADO_V1", "INDEPENDIENTE_V1"].filter(p => originales[n].includes(p));
    await reemplazar(n, alterada);
    try {
      expect(await clausula(n)).not.toBe(originales[n]); for (const p of palabras) expect(await clausula(n), "conserva la palabra clave " + p).toContain(p);   // un LIKE por palabra clave seguiría aprobándola
      const r = await postcheck(); expect(r.veredicto.veredicto).toMatch(/^FALLA: .*definiciones distintas/); expect(r.veredicto.checks_distintos).toBe(n); expect(Number(r.veredicto.checks_con_firma_esperada_de_4)).toBe(3);
      expect(r.firmas.filter(f => !Number(f.coincide)).map(f => f.nombre)).toEqual([n]);
    } finally { await restaurar(); }
    expect((await postcheck()).veredicto.veredicto).toBe("OK: VÍNCULO DE UNIDAD INSTALADO");
  });

  it("restricción ausente o columna distinta: FALLA", async () => {
    await admin.query(`USE ${LAB}; ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_vinculo`);
    try { const r = await postcheck(); expect(r.veredicto.veredicto).toMatch(/^FALLA/); expect(r.veredicto.checks_distintos).toBe("ck_cb2c_vinculo"); } finally { await restaurar(); await reemplazar("ck_cb2c_vinculo", originales.ck_cb2c_vinculo); }
    await admin.query(`USE ${LAB}; ALTER TABLE flota_cb2_consumos MODIFY vinculo_unidad VARCHAR(30) NULL`);
    try { const r = await postcheck(); expect(r.veredicto.veredicto).toMatch(/^FALLA/); expect(Number(r.veredicto.columna_vinculo)).toBe(0); } finally { await restaurar(); }
    expect((await postcheck()).veredicto.veredicto).toBe("OK: VÍNCULO DE UNIDAD INSTALADO");
  });

  it("tolera SOLO diferencias de formato: mayúsculas, espacios, saltos de línea y comillas de identificadores", async () => {
    const reformateada = (c: string) => c.toUpperCase().replace(/\s+/g, "\n   ").replace(/\b(vehiculo_id|empleado_id|identidad_externa|vinculo_unidad|unidad_externa_id|asociacion_externa_id|piloto_externo_id)\b/gi, m => "`" + m + "`");
    // Las cadenas literales conservan su mayúscula/minúscula original: se reformatea solo fuera de comillas simples y sin los acentos graves previos.
    const fuera = (c: string) => c.replace(/`/g, "").split(/('(?:[^']|'')*')/).map((t, i) => i % 2 ? t : reformateada(t)).join("");
    for (const n of NOMBRES) await reemplazar(n, fuera(originales[n]));
    try { const r = await postcheck(); expect(r.veredicto.veredicto, JSON.stringify(r.firmas)).toBe("OK: VÍNCULO DE UNIDAD INSTALADO"); } finally { await restaurar(); }
  });

  it("lee exclusivamente @esquema, no cambia nada y no contiene escritura", async () => {
    const otra = await postcheck(OTRA, LAB); expect(otra.veredicto.veredicto).toMatch(/^FALLA/); expect(Number(otra.veredicto.columna_vinculo)).toBe(0);   // la base vacía no se confunde con la instalada
    const desdeInfo = await postcheck(LAB, "information_schema"); expect(desdeInfo.veredicto.veredicto).toBe("OK: VÍNCULO DE UNIDAD INSTALADO");
    for (const malo of ["no_existe_xyz", "a`b", "x' OR '1'='1"]) { const r = await postcheck(malo); expect(r.veredicto.veredicto, malo).toBe("ESQUEMA_INVALIDO"); expect(r.firmas).toEqual([]); }
    const sinComentarios = sql(POSTCHECK).split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(sinComentarios).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+(TABLE|DATABASE|INDEX|CONSTRAINT)|TRUNCATE|CREATE\s+(TABLE|TEMPORARY|INDEX|TRIGGER|DATABASE)|RENAME\s+TABLE|GRANT\s)/i);
    expect(await clausula("ck_cb2c_vinculo")).toBe(originales.ck_cb2c_vinculo);
  });
});
