// Preflight de SOLO LECTURA «CB2 Shell en uso real» (`sql/preflight-2026-11-cb2-shell-uso-real.sql`) contra MariaDB 11.8.9 REAL y desechable (pipe sin red).
// Recorre la instalación con las migraciones REALES (N1→N4 + tablas Shell) y comprueba el veredicto en cada etapa, los estados parciales/inconsistentes, la lectura exclusiva de @esquema
// y que el script no escribe nada. Se omite sin CB2_587_PIPE.
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });
const pipe = process.env.CB2_587_PIPE ?? "", BARRA = String.fromCharCode(92), LAB = "cb2_shell_preflight", OTRA = "cb2_shell_preflight_vacia";
const sql = (f: string) => readFileSync(path.join("sql", f), "utf8").replace(/^﻿/, "");
const PREFLIGHT = "preflight-2026-11-cb2-shell-uso-real.sql";
let admin: mysql.Connection;
const aplicar = (f: string) => admin.query(sql(f));
/** Ejecuta el preflight; `activa` = base seleccionada (DATABASE()); `esquema` = valor de @esquema (null = NULL). */
async function correr(esquema: string | null = null, activa = LAB) {
  const texto = sql(PREFLIGHT).replace("SET @esquema = NULL;", esquema === null ? "SET @esquema = NULL;" : `SET @esquema = ${admin.escape(esquema)};`);
  await admin.query(`USE ${activa}`);
  const r = ((await admin.query(texto))[0] as unknown[]).filter(Array.isArray) as RowDataPacket[][];
  return { veredicto: r[0][0] as RowDataPacket, hechos: r[1] ?? [] };
}
const hecho = (h: RowDataPacket[], objeto: string) => String(h.find(x => String(x.objeto).startsWith(objeto))?.actual);
const fila = (tabla: string) => admin.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${tabla}`).then(([x]) => Number(x[0].n));

describe.skipIf(!pipe)("preflight CB2 Shell en uso real: solo lectura, por etapas y fail-closed (MariaDB 11.8.9)", () => {
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
  });
  afterAll(async () => { await admin?.query(`DROP DATABASE IF EXISTS ${LAB}; DROP DATABASE IF EXISTS ${OTRA}`).catch(() => undefined); await admin?.end(); });

  it("etapa base (nivel 0): NO APTO, con los hechos de la base y sin la cadena", async () => {
    const r = await correr(); expect(r.veredicto.veredicto).toMatch(/^NO APTO: falta la cadena/); expect(r.veredicto).toMatchObject({ esquema: LAB, tablas_shell: "AUSENTE" }); expect(Number(r.veredicto.nivel_cadena)).toBe(0);
    expect(hecho(r.hechos, "flota_cb2_consumos InnoDB")).toBe("1"); expect(hecho(r.hechos, "uq_cb2c_ambito")).toBe("1");
  });
  it("niveles 1 y 2: insuficientes; nivel 3 sin tablas Shell: NO APTO por las tablas Shell", async () => {
    await aplicar("migrate-2026-11-cb2-terceros.sql"); expect((await correr()).veredicto.veredicto).toMatch(/^NO APTO: falta la cadena/);
    await aplicar("migrate-2026-11-cb2-terceros-directos.sql"); const n2 = await correr(); expect(Number(n2.veredicto.nivel_cadena)).toBe(2); expect(n2.veredicto.veredicto).toMatch(/^NO APTO: falta la cadena/);
    await aplicar("migrate-2026-11-cb2-identidades-independientes.sql"); const n3 = await correr(); expect(Number(n3.veredicto.nivel_cadena)).toBe(3); expect(n3.veredicto.veredicto).toMatch(/^NO APTO: faltan las 3 tablas Shell/);
  });
  it("nivel 3 + tablas Shell: APTO PARA PREFLIGHT con la limitación del nivel 4; con nivel 4: APTO PARA PREFLIGHT (pendientes: flags y despliegue)", async () => {
    await aplicar("migrate-2026-11-cb2-pilotos-reportados.sql");
    const n3 = await correr(); expect(n3.veredicto.veredicto).toMatch(/^APTO PARA PREFLIGHT con limitación: nivel 3/); expect(n3.veredicto.tablas_shell).toBe("COMPLETO");
    await aplicar("migrate-2026-11-cb2-piloto-reportado.sql");
    const n4 = await correr(); expect(n4.veredicto.veredicto).toMatch(/^APTO PARA PREFLIGHT: esquema listo/); expect(Number(n4.veredicto.nivel_cadena)).toBe(4); expect(String(n4.veredicto.pendiente)).toContain("CB2_TERCEROS_DIRECTOS_APROBADA=1");
    expect(hecho(n4.hechos, "guardas")).toBe("15"); expect(hecho(n4.hechos, "índices únicos exactos")).toBe("4"); expect(hecho(n4.hechos, "estado del registro")).toBe("COMPLETO");
    expect(hecho(n4.hechos, "ck_cb2c_unidad_tipo contiene")).toBe("1 / 1");
  });
  it("hechos de apoyo: empleados Activo/Baja/otros, bajas sin fecha, identidades externas y consumos (solo conteos)", async () => {
    await admin.query("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(1,1,'Activa Uno','Activo'),(2,1,'Baja Uno','Baja'),(3,1,'Suspendida Uno','Suspendido')");
    await admin.query("INSERT INTO flota_cb2_externos_unidades(empresa_id,referencia,referencia_hash,placa,tipo,descripcion) VALUES(1,'shell:M1',REPEAT('a',64),'M123ABC','MOTOCICLETA','x')");
    const h = (await correr()).hechos;
    expect(hecho(h, "Activo / Baja / otros")).toBe("1 / 1 / 1"); expect(hecho(h, "unidades externas / pilotos externos")).toBe("1 / 0"); expect(hecho(h, "consumos CB2")).toBe("0 / 0");
    expect(hecho(h, "columna fecha_egreso")).toBe("0");   // sin la columna: solo avisos en la interfaz, y se informa
  });
  it("lectura exclusiva de @esquema: con otra base activa (o information_schema) se lee el esquema pedido; un esquema vacío da otro veredicto; inválidos → ESQUEMA_INVALIDO", async () => {
    const desdeOtra = await correr(LAB, OTRA), desdeInfo = await correr(LAB, "information_schema"), propio = await correr();
    expect(desdeOtra.veredicto.veredicto).toBe(propio.veredicto.veredicto); expect(desdeInfo.veredicto.veredicto).toBe(propio.veredicto.veredicto); expect(JSON.stringify(desdeInfo.hechos)).toBe(JSON.stringify(propio.hechos));
    const vacia = await correr(OTRA, LAB); expect(vacia.veredicto).toMatchObject({ esquema: OTRA }); expect(vacia.veredicto.veredicto).toMatch(/^NO APTO: falta la base CB2/);
    for (const malo of ["no_existe_xyz", "a`b", `${LAB}${BARRA}`, "x' OR '1'='1"]) { const r = await correr(malo); expect(r.veredicto.veredicto, malo).toBe("ESQUEMA_INVALIDO"); expect(r.hechos).toEqual([]); }
  });
  it("estados parciales o inconsistentes → DETENER Y AUDITAR (registro de pilotos parcial; CHECK de nivel 4 sin su antecesor)", async () => {
    await admin.query(`USE ${LAB}; ALTER TABLE flota_cb2_pilotos_equivalencias DROP CONSTRAINT ck_cb2pe_nombre`);
    const parcial = await correr(); expect(parcial.veredicto.tablas_shell).toBe("PARCIAL"); expect(parcial.veredicto.veredicto).toMatch(/^DETENER Y AUDITAR/); expect(hecho(parcial.hechos, "guardas")).toBe("14");
    await admin.query("ALTER TABLE flota_cb2_pilotos_equivalencias ADD CONSTRAINT ck_cb2pe_nombre CHECK (nombre_normalizado <> '')").catch(() => undefined);
    await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2_piloto_unico");
    const incons = await correr(); expect(Number(incons.veredicto.nivel_cadena)).toBe(-1); expect(incons.veredicto.veredicto).toMatch(/^DETENER Y AUDITAR/);
  });
  it("SOLO LECTURA: el archivo no contiene sentencias de escritura ni DDL; ejecutarlo no cambia filas ni esquema", async () => {
    const sinComentarios = sql(PREFLIGHT).split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(sinComentarios).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+(TABLE|DATABASE|INDEX|CONSTRAINT)|TRUNCATE|CREATE\s+(TABLE|TEMPORARY|INDEX|TRIGGER|DATABASE)|RENAME\s+TABLE|GRANT\s|REPLACE\s+INTO)\b/i);
    await admin.query(`USE ${LAB}`);
    const antes = JSON.stringify([await fila("empleados"), await fila("flota_cb2_externos_unidades"), await fila("flota_cb2_consumos"), (await admin.query<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"))[0][0].n]);
    await correr(); await correr(LAB, "information_schema"); await admin.query(`USE ${LAB}`);
    expect(JSON.stringify([await fila("empleados"), await fila("flota_cb2_externos_unidades"), await fila("flota_cb2_consumos"), (await admin.query<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"))[0][0].n])).toBe(antes);
  });
});
