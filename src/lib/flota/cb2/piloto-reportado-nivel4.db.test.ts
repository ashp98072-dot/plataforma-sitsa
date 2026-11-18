// Migración `piloto-reportado` (nivel 4) en MariaDB 11.8.9 REAL y desechable (pipe sin red). Preflight exacto (original y variante con esquema explícito ejecutada con
// DATABASE() = information_schema), impacto sobre filas existentes, ejecución, postcheck, reinstalación y fail-closed.
// Con CB2_RESTORE_DB (respaldo restaurado en el laboratorio) usa los datos reales; los CHECK del nivel 3 se instalan desde el repositorio porque el respaldo no los trae.
import { readFileSync } from "node:fs";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 240000, hookTimeout: 240000 });
const pipe = process.env.CB2_587_PIPE ?? "", RESTAURADA = process.env.CB2_RESTORE_DB ?? "";
const D = "docs/operaciones/cb2-piloto-reportado-nivel4-20261118/", LAB = "cb2_nivel4", PROD = "u611730801_Plataforma";
const NL = String.fromCharCode(10), BARRA = String.fromCharCode(92);
const sqlRepo = (f: string) => readFileSync("sql/" + f, "utf8").replace(/^﻿/, "");
const doc = (f: string) => readFileSync(D + f, "utf8");
const quitarComentarios = (s: string) => s.split(NL).filter((l) => !l.trim().startsWith("--")).join(NL);
const conEsquema = (t: string, e: string | null) => t.replace(/SET @esquema = [^;]*;/, e === null ? "SET @esquema = NULL;" : `SET @esquema = '${e}';`);
let admin: mysql.Connection;
/** Ejecuta el archivo en la base indicada y devuelve la primera fila del ÚLTIMO resultado (el SELECT final). */
async function correr(texto: string, db: string): Promise<Record<string, unknown>> {
  await admin.query(`USE \`${db}\``);
  const r = (await admin.query(texto))[0] as unknown as unknown[];
  const sets = r.filter((x) => Array.isArray(x)) as RowDataPacket[][];
  return sets[sets.length - 1][0] as Record<string, unknown>;
}
const veredicto = (r: Record<string, unknown>) => String(r.veredicto);
const num = (r: Record<string, unknown>, ...ks: string[]) => Object.fromEntries(ks.map((k) => [k, Number(r[k])]));
const n = async () => Number(((await admin.query<RowDataPacket[]>("SELECT COUNT(*) n FROM flota_cb2_consumos"))[0] as RowDataPacket[])[0].n);

describe.skipIf(!pipe)("migrate-2026-11-cb2-piloto-reportado: preflight, impacto, ejecución y postcheck (MariaDB 11.8.9 real)", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    admin = await mysql.createConnection({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v"); expect(v.v).toMatch(/^11\.8\.9-MariaDB/);
  });
  afterAll(async () => { await admin?.query(`DROP DATABASE IF EXISTS ${LAB}; DROP DATABASE IF EXISTS cb2_nivel4_vacio; DROP DATABASE IF EXISTS \`${PROD}\``).catch(() => undefined); await admin?.end(); });

  it("las variantes original y con esquema explícito solo difieren en la línea SET @esquema", () => {
    for (const [a, b] of [["30-preflight-nivel4.sql", "30-preflight-nivel4-esquema.sql"], ["40-postcheck-nivel4.sql", "40-postcheck-nivel4-esquema.sql"]]) {
      const norm = (t: string) => t.split(NL).filter((l) => !/^(SET @esquema|--)/.test(l)).join(NL);
      expect(norm(doc(a))).toBe(norm(doc(b)));
    }
  });

  it("el script de ejecución es la migración sin cambios salvo el calificador de la tabla", () => {
    const cuerpo = (t: string) => quitarComentarios(t).replace(/\s+/g, " ").trim();
    const mig = cuerpo(sqlRepo("migrate-2026-11-cb2-piloto-reportado.sql").replace(/^[\s\S]*?(?=ALTER TABLE)/, ""));
    const ejec = cuerpo(doc("35-ejecutar-nivel4-esquema.sql"));
    expect(ejec).toBe(mig.replace("ALTER TABLE flota_cb2_consumos", "ALTER TABLE `u611730801_Plataforma`.`flota_cb2_consumos`"));
    expect(doc("35-ejecutar-nivel4-esquema.sql").match(/^ALTER TABLE/gm)).toHaveLength(1);
  });

  it.skipIf(!RESTAURADA)("EXACTAMENTE los archivos de Hostinger sobre el respaldo restaurado en una base llamada u611730801_Plataforma (DATABASE() = information_schema): preflight APTO → ejecución → postcheck OK → ya instalado → no se reaplica", async () => {
    // El respaldo se restauró directamente en una base con el nombre productivo (u611730801_Plataforma) para ejecutar los archivos SIN editar. Los CHECK del nivel 3 se instalan desde el repositorio (el respaldo no los trae).
    expect(RESTAURADA).toBe(PROD);
    const n3 = quitarComentarios(sqlRepo("migrate-2026-11-cb2-identidades-independientes.sql")).replace("DROP CONSTRAINT ck_cb2c_unidad_tipo,", "");
    await admin.query(`USE \`${PROD}\``); const antes = await n(); await admin.query(n3);
    const pre = await correr(doc("30-preflight-nivel4-esquema.sql"), "information_schema"); console.log("PRE_EXACTO", JSON.stringify(pre));
    expect(veredicto(pre)).toBe("APTO PARA APLICAR NIVEL 4");
    expect(num(pre, "version_ck_unidad_tipo", "ck_piloto_reportado_presente", "filas_consumos", "filas_ya_reportado_v1", "filas_que_violarian_el_nuevo_check")).toEqual({ version_ck_unidad_tipo: 3, ck_piloto_reportado_presente: 0, filas_consumos: antes, filas_ya_reportado_v1: 0, filas_que_violarian_el_nuevo_check: 0 });
    expect(await correr(doc("30-preflight-nivel4.sql"), PROD)).toEqual(pre);   // la variante original (con la base seleccionada) coincide
    // Ejecución: el archivo tal cual, con information_schema como base seleccionada.
    await admin.query("USE information_schema"); await admin.query(doc("35-ejecutar-nivel4-esquema.sql"));
    const post = await correr(doc("40-postcheck-nivel4-esquema.sql"), "information_schema"); console.log("POST_EXACTO", JSON.stringify(post));
    expect(veredicto(post)).toBe("OK: NIVEL 4 INSTALADO"); expect(num(post, "version_ck_unidad_tipo", "filas_consumos", "filas_incompatibles")).toEqual({ version_ck_unidad_tipo: 4, filas_consumos: antes, filas_incompatibles: 0 });
    expect(veredicto(await correr(doc("40-postcheck-nivel4.sql"), PROD))).toBe("OK: NIVEL 4 INSTALADO");
    expect(veredicto(await correr(doc("30-preflight-nivel4-esquema.sql"), "information_schema"))).toMatch(/^YA INSTALADO/);
    await admin.query("USE information_schema"); await expect(admin.query(doc("35-ejecutar-nivel4-esquema.sql"))).rejects.toThrow();   // no se reaplica
    await admin.query(`USE \`${PROD}\``); expect(await n()).toBe(antes);
    // Un CHECK de nivel 4 vigente rechaza la combinación inválida y acepta el reportado sobre unidad externa (lo que habilita a Luis Escobar)
    const [cols] = await admin.query<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME IN ('ck_cb2_piloto_reportado','ck_cb2c_unidad_tipo','ck_cb2_piloto_unico')", [PROD]); expect(Number(cols[0].n)).toBe(3);
  });

  it("fail-closed: base sin la cadena → DETENER; esquema no fijado, inexistente, del sistema o con nombre inválido; base sin la tabla", async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${LAB}; CREATE DATABASE ${LAB} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; USE ${LAB}`);
    await admin.query("CREATE TABLE empleados(id INT PRIMARY KEY) ENGINE=InnoDB");
    await admin.query(readFileSync("scripts/ci/combustibles-pr2-lab/base.sql", "utf8"));
    for (const malo of [LAB, null, "", "information_schema", "no_existe_xyz", "a`b"]) expect(veredicto(await correr(conEsquema(doc("30-preflight-nivel4-esquema.sql"), malo), "information_schema")), String(malo)).toBe("DETENER Y AUDITAR");
    await admin.query("CREATE DATABASE cb2_nivel4_vacio");
    expect(veredicto(await correr(conEsquema(doc("30-preflight-nivel4-esquema.sql"), "cb2_nivel4_vacio"), "information_schema"))).toBe("DETENER Y AUDITAR");
    // ALTER sobre el nivel 2 (sin ck_cb2_piloto_unico) falla entero y no cambia nada
    await admin.query(`USE ${LAB}`);
    await expect(admin.query(quitarComentarios(sqlRepo("migrate-2026-11-cb2-piloto-reportado.sql")))).rejects.toThrow();
  });
});
