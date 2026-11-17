// Preflight Shell y Fondos con ESQUEMA EXPLÍCITO (`@esquema`) sobre MariaDB 11.8.9 REAL y desechable (pipe sin red; lo lanza `scripts/ci/cb2-identidades/run-windows.mjs`).
// Compara, por mutación del esquema, el preflight ORIGINAL (DATABASE() = base de laboratorio) con la VARIANTE ejecutada con DATABASE() = information_schema: mismos resultados en cada validación (columnas, tipos,
// nulabilidad, motor, índices, objetos nuevos y nombres de FK ocupados) y fail-closed ante esquema inválido.
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120000 });
const pipe = process.env.CB2_587_PIPE ?? "";
const DIR = "docs/operaciones/cb2-cierre-20261116";
const archivo = (f: string) => readFileSync(path.join(DIR, f), "utf8").replace(/^﻿/, "");
const sqlRepo = (f: string) => readFileSync(path.join("sql", f), "utf8").replace(/^﻿/, "");
const LAB = "cb2_preflight_esquema";
let admin: mysql.Connection;
const q = async (s: string) => (await admin.query<RowDataPacket[]>(s))[0];
type Resultado = { raw: unknown[][] };
const jugar = async (texto: string, database: string): Promise<unknown[][]> => { await admin.query(`USE ${database}`); try { const r = (await admin.query(texto))[0] as unknown as unknown[][]; return r; } finally { await admin.query(`USE ${LAB}`); } };
const conEsquema = (texto: string, esquema: string | null) => texto.replace(/SET @esquema = '[^']*';/, esquema === null ? "SET @esquema = NULL;" : `SET @esquema = '${esquema}';`);
/** Resultados de VALIDACIÓN (sin la fila informativa ni SHOW GRANTS): [objetos nuevos, columnas, índices, nombres de FK]. */
const validaciones = (original: unknown[][]) => [original[2], original[3], original[4], original[5]];
/** La variante empieza con `SET @esquema` (paquete OK, no es un conjunto de filas): [0]=SET, [1]=guarda, [2]=estado, [3]=SHOW GRANTS, [4..7]=validaciones. */
const validacionesVariante = (variante: unknown[][]) => [variante[4], variante[5], variante[6], variante[7]];
const vacias = (v: unknown[][]) => v.map((x) => (x as unknown[]).length);

async function construirBase() {
  await admin.query(`DROP DATABASE IF EXISTS ${LAB}; CREATE DATABASE ${LAB} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; USE ${LAB}`);
  await admin.query(readFileSync("scripts/ci/combustibles-pr2-lab/base.sql", "utf8"));
  await admin.query("ALTER TABLE flota_vehiculos ADD placa VARCHAR(40) NOT NULL DEFAULT 'C-001ABC', ADD estado VARCHAR(40) NOT NULL DEFAULT 'Activo', ADD activo TINYINT NOT NULL DEFAULT 1; CREATE TABLE empleados(id INT PRIMARY KEY,empresa_id INT NOT NULL,nombre VARCHAR(160),estado VARCHAR(20)) ENGINE=InnoDB");
  await admin.query("CREATE TABLE flota_combustible_estaciones(id INT PRIMARY KEY,empresa_id INT,proveedor_id INT,nombre VARCHAR(150),activo TINYINT) ENGINE=InnoDB");
  const ddl = sqlRepo("migrate-2026-10-combustibles-pr2-consumos-facturas.sql").match(/^CREATE TABLE [\s\S]*?COLLATE=utf8mb4_bin;/gm)!; for (const s of ddl) await admin.query(s);
  await admin.query(sqlRepo("migrate-2026-10-combustibles-pr514-asignaciones.sql"));
  await admin.query("CREATE TABLE tms_solicitud_fondo_lineas(id INT NOT NULL PRIMARY KEY, empresa_id INT NOT NULL, UNIQUE KEY uq_fondolin_c2a_empresa_id(empresa_id,id)) ENGINE=InnoDB");
}

describe.skipIf(!pipe)("Preflight Shell/Fondos con esquema explícito (MariaDB 11.8.9 real)", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    admin = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[env]] = await admin.query<RowDataPacket[]>("SELECT VERSION() AS v"); expect(env.v).toMatch(/^11\.8\.9-MariaDB/);
    await construirBase();
  }, 90000);
  afterAll(async () => { await admin?.query(`DROP DATABASE IF EXISTS ${LAB}; DROP DATABASE IF EXISTS cb2_esquema_vacio`).catch(() => undefined); await admin?.end(); });

  const paquetes = [["shell", "10-preflight-shell.sql", "10-preflight-shell-esquema.sql"], ["fondos", "10-preflight-fondos.sql", "10-preflight-fondos-esquema.sql"]] as const;
  /** Ejecuta original (con DATABASE() = LAB) y variante (con DATABASE() = information_schema) y devuelve ambas validaciones. */
  const comparar = async (orig: string, vari: string, esquema = LAB) => {
    const o = validaciones(await jugar(archivo(orig), LAB)); const v = validacionesVariante(await jugar(conEsquema(archivo(vari), esquema), "information_schema")); return { o, v };
  };

  it.each(paquetes)("%s — esquema válido con prerrequisitos correctos: original (DATABASE()=base) y variante (DATABASE()=information_schema) dan CERO filas en las 4 validaciones; el ORIGINAL con DATABASE()=information_schema da falsos errores (el defecto observado)", async (_n, orig, vari) => {
    const { o, v } = await comparar(orig, vari); expect(vacias(o)).toEqual([0, 0, 0, 0]); expect(vacias(v)).toEqual([0, 0, 0, 0]); expect(v).toEqual(o);
    const guarda = await jugar(conEsquema(archivo(vari), LAB), "information_schema"); expect(guarda[1]).toEqual([]); expect((guarda[2] as RowDataPacket[])[0]).toMatchObject({ esquema_analizado: LAB, estado_esquema: "ESQUEMA_VALIDO" });
    const falso = validaciones(await jugar(archivo(orig), "information_schema")); expect((falso[1] as unknown[]).length + (falso[2] as unknown[]).length, "el original con DATABASE()=information_schema reporta columnas/índices faltantes que sí existen").toBeGreaterThan(0);
  });

  it("MUTACIONES de columnas/tipos/nulabilidad (Shell): empleados.empresa_id NULL o UNSIGNED, o columna faltante → la variante reporta EXACTAMENTE lo mismo que el original (no vacío)", async () => {
    const [, orig, vari] = paquetes[0];
    for (const [mutar, restaurar] of [["MODIFY empresa_id INT NULL", "MODIFY empresa_id INT NOT NULL"], ["MODIFY empresa_id INT UNSIGNED NOT NULL", "MODIFY empresa_id INT NOT NULL"], ["CHANGE empresa_id empresa_id_x INT NOT NULL", "CHANGE empresa_id_x empresa_id INT NOT NULL"]] as const) {
      await admin.query(`ALTER TABLE empleados ${mutar}`); const { o, v } = await comparar(orig, vari); await admin.query(`ALTER TABLE empleados ${restaurar}`);
      expect((o[1] as unknown[]).length, mutar).toBeGreaterThan(0); expect(v, mutar).toEqual(o);
    }
    const { o, v } = await comparar(orig, vari); expect(vacias(o)).toEqual([0, 0, 0, 0]); expect(v).toEqual(o);   // restaurado
  });
  it("MUTACIONES de motor e índices (Fondos): líneas de fondo en MyISAM, índice único ausente o con otras columnas → la variante reporta lo mismo que el original", async () => {
    const [, orig, vari] = paquetes[1];
    await admin.query("ALTER TABLE tms_solicitud_fondo_lineas ENGINE=MyISAM"); let r = await comparar(orig, vari); await admin.query("ALTER TABLE tms_solicitud_fondo_lineas ENGINE=InnoDB");
    expect((r.o[1] as unknown[]).length, "motor").toBeGreaterThan(0); expect(r.v).toEqual(r.o);
    await admin.query("ALTER TABLE tms_solicitud_fondo_lineas DROP INDEX uq_fondolin_c2a_empresa_id"); r = await comparar(orig, vari);
    expect((r.o[2] as unknown[]).length, "índice ausente").toBeGreaterThan(0); expect(r.v).toEqual(r.o);
    await admin.query("ALTER TABLE tms_solicitud_fondo_lineas ADD UNIQUE KEY uq_fondolin_c2a_empresa_id(id,empresa_id)"); r = await comparar(orig, vari);
    expect((r.o[2] as unknown[]).length, "índice con otro orden de columnas").toBeGreaterThan(0); expect(r.v).toEqual(r.o);
    await admin.query("ALTER TABLE tms_solicitud_fondo_lineas DROP INDEX uq_fondolin_c2a_empresa_id, ADD INDEX uq_fondolin_c2a_empresa_id(empresa_id,id)"); r = await comparar(orig, vari);
    expect((r.o[2] as unknown[]).length, "índice no único").toBeGreaterThan(0); expect(r.v).toEqual(r.o);
    await admin.query("ALTER TABLE tms_solicitud_fondo_lineas DROP INDEX uq_fondolin_c2a_empresa_id, ADD UNIQUE KEY uq_fondolin_c2a_empresa_id(empresa_id,id)"); r = await comparar(orig, vari); expect(vacias(r.v)).toEqual([0, 0, 0, 0]);
  });
  it("OBJETOS NUEVOS ya instalados (instalación previa/parcial): tablas y nombres de FK ocupados → ambos preflight reportan lo mismo (no vacío) y la variante lo ve aunque DATABASE() sea information_schema", async () => {
    await admin.query(sqlRepo("migrate-2026-11-cb2-pilotos-reportados.sql")); let r = await comparar(paquetes[0][1], paquetes[0][2]);
    expect((r.o[0] as unknown[]).length).toBe(3); expect((r.o[3] as unknown[]).length).toBeGreaterThan(0); expect(r.v).toEqual(r.o);
    await admin.query(sqlRepo("migrate-2026-11-cb2-fondos-vinculos.sql")); r = await comparar(paquetes[1][1], paquetes[1][2]);
    expect((r.o[0] as unknown[]).length).toBe(1); expect((r.o[3] as unknown[]).length).toBe(3); expect(r.v).toEqual(r.o);
    await admin.query("DROP TABLE flota_cb2_fondos_vinculos; DROP TABLE flota_cb2_pilotos_equivalencias; DROP TABLE flota_cb2_consumo_piloto_reportado; DROP TABLE flota_cb2_pilotos_reportados");
    for (const [, orig, vari] of paquetes) { const x = await comparar(orig, vari); expect(vacias(x.v)).toEqual([0, 0, 0, 0]); expect(x.v).toEqual(x.o); }
  });
  it.each(paquetes)("%s — FAIL-CLOSED: @esquema NULL, vacío, inexistente, de sistema o sin `flota_cb2_consumos` → filas de problema en la guarda, estado INVALIDO y fila ESQUEMA_INVALIDO en las validaciones «cero esperado»; nunca un resultado vacío que parezca correcto", async (_n, _orig, vari) => {
    await admin.query("DROP DATABASE IF EXISTS cb2_esquema_vacio; CREATE DATABASE cb2_esquema_vacio"); await admin.query(`USE ${LAB}`);
    for (const esq of [null, "", "no_existe_ni_en_sueños", "information_schema", "mysql", "performance_schema", "cb2_esquema_vacio"]) {
      const r = await jugar(conEsquema(archivo(vari), esq), "information_schema"); const guarda = r[1] as RowDataPacket[]; const estado = (r[2] as RowDataPacket[])[0];
      expect(guarda.length, String(esq)).toBeGreaterThan(0); expect(String(guarda[0].problema), String(esq)).toMatch(esq === "cb2_esquema_vacio" ? /BASE_CB2_AUSENTE/ : /ESQUEMA_NO_FIJADO/);
      expect(estado.estado_esquema, String(esq)).toBe(esq === "cb2_esquema_vacio" ? "ESQUEMA_VALIDO" : "ESQUEMA_INVALIDO");   // un esquema existente pero sin la tabla base es válido como esquema y lo detecta la guarda de base CB2
      const v = validacionesVariante(r); if (esq !== "cb2_esquema_vacio") { expect((v[0] as unknown[]).length, `${esq} objetos nuevos`).toBeGreaterThan(0); expect((v[3] as unknown[]).length, `${esq} FK`).toBeGreaterThan(0); }
      expect((v[1] as unknown[]).length + (v[2] as unknown[]).length, `${esq} columnas/índices`).toBeGreaterThan(0);
    }
    await admin.query("DROP DATABASE cb2_esquema_vacio");
  });
});
