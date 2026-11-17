// CB2 — instalación mínima de la cadena de identidades externas, sobre MariaDB 11.8.9 REAL y desechable (pipe sin red; lo lanza `scripts/ci/cb2-identidades/run-windows.mjs`). Prueba, con las migraciones REALES del repositorio:
// el detector de nivel (`sql/preflight-2026-11-cb2-nivel-instalacion.sql`), el ORDEN obligatorio, que ningún paso es idempotente (repetirlo falla sin cambiar nada), qué permite cada nivel, y la sintaxis de
// `sql/migrate-2026-10-fondos-vehiculos-compartidos.sql`. Los stubs de tablas TMS solo reproducen las columnas/índices/FK que las migraciones tocan.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120000 });   // consultas a information_schema + varias bases desechables por prueba: el límite por omisión (5 s) es insuficiente

const pipe = process.env.CB2_587_PIPE ?? "";
const sql = (f: string) => readFileSync(path.join("sql", f), "utf8").replace(/^﻿/, "");
const M = { terceros: "migrate-2026-11-cb2-terceros.sql", directos: "migrate-2026-11-cb2-terceros-directos.sql", independientes: "migrate-2026-11-cb2-identidades-independientes.sql", reportado: "migrate-2026-11-cb2-piloto-reportado.sql",
  shell: "migrate-2026-11-cb2-pilotos-reportados.sql", vinculos: "migrate-2026-11-cb2-fondos-vinculos.sql", compartidos: "migrate-2026-10-fondos-vehiculos-compartidos.sql" } as const;
let admin: mysql.Connection;
const q = async (s: string, a: unknown[] = []) => (await admin.query<RowDataPacket[]>(s, a))[0];
const DETECTOR = "preflight-2026-11-cb2-nivel-instalacion.sql";
const VARIANTE = "preflight-2026-11-cb2-nivel-instalacion-esquema.sql";
const BASE_LAB = "cb2_instalacion_minima";
/** Ejecuta la variante con esquema explícito (`esquema` null = SET @esquema = NULL) y devuelve el resumen y los hechos. */
const nivelVariante = async (esquema: string | null) => {
  const texto = sql(VARIANTE).replace(/SET @esquema = '[^']*';/, esquema === null ? "SET @esquema = NULL;" : `SET @esquema = '${esquema}';`);
  const r = (await admin.query<RowDataPacket[][]>(texto))[0] as unknown as RowDataPacket[][]; const principal = r.find((x) => Array.isArray(x) && x.some((f) => f.objeto === "nivel_detectado"))!;
  const dato = (o: string) => String(principal.find((f) => String(f.objeto).startsWith(o))?.observada);
  return { nivel: dato("nivel_detectado"), siguiente: dato("siguiente_paso"), secuencia: dato("secuencia_por_nivel"), version: dato("version_ck"), diagnostico: dato("diagnostico_esquema"), analizado: dato("esquema_analizado"), hechos: principal.filter((f) => f.tipo === "HECHO") };
};
/** Ejecuta `fn` con DATABASE() apuntando a otro esquema (como phpMyAdmin parado en information_schema) y vuelve a la base de laboratorio. */
const conDatabase = async <T>(otro: string, fn: () => Promise<T>): Promise<T> => { await admin.query(`USE ${otro}`); try { return await fn(); } finally { await admin.query(`USE ${BASE_LAB}`); } };
const detector = async () => (await admin.query<RowDataPacket[][]>(sql(DETECTOR)))[0] as unknown as RowDataPacket[][];
const nivel = async () => {
  const [principal] = await detector(); const dato = (o: string) => String(principal.find((r) => String(r.objeto).startsWith(o))?.observada);
  return { nivel: dato("nivel_detectado"), siguiente: dato("siguiente_paso"), secuencia: dato("secuencia_por_nivel"), version: dato("version_ck"), hechos: principal.filter((r) => r.tipo === "HECHO") };
};
/** Firmas OBSERVADAS (solo la CTE `obs` del detector, entre sus marcadores BEGIN-CTE/END-CTE). */
const observar = async () => {
  const t = sql(DETECTOR); const cte = t.slice(t.indexOf("-- BEGIN-CTE") + "-- BEGIN-CTE".length, t.indexOf("-- END-CTE"));
  return (await q(`${cte} SELECT nivel, objeto, presente, firma FROM obs ORDER BY nivel, objeto`)) as RowDataPacket[];
};
const intenta = async (f: string) => { try { await admin.query(sql(f)); return { ok: true as const }; } catch (e) { const x = e as { errno?: number; code?: string }; return { ok: false as const, errno: x.errno, code: x.code }; } };
const postcheckVacio = async (n: number) => { const r = (await admin.query<RowDataPacket[][]>(sql("postcheck-2026-11-cb2-nivel-instalacion.sql").replace(/SET @nivel_esperado = \d;/, `SET @nivel_esperado = ${n};`)))[0] as unknown as RowDataPacket[][]; return { faltantes: r[1].length, superior: r[2].length, motor: r[3].length }; };
const checkClause = async (name: string) => String((await q("SELECT CHECK_CLAUSE c FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME=?", [name]))[0]?.c ?? "");
const snapshotEsquema = async () => JSON.stringify([await q("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' ORDER BY ORDINAL_POSITION"),
  await q("SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' ORDER BY CONSTRAINT_NAME"),
  await q("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' ORDER BY CONSTRAINT_NAME")]);
/** Fila de prueba en consumos (las FK se desactivan SOLO para esta inserción; los CHECK siguen activos). */
const consumo = async (n: string, cols: Record<string, unknown>) => {
  const base: Record<string, unknown> = { empresa_id: 1, proveedor_id: 1, importacion_origen_id: 1, fecha_consumo: "2026-11-01", numero_vale: n, vale_norm: n, placa_original: "P", placa_normalizada: "P", version_clave: 1, clave_candidata: "a".repeat(64),
    version_huella: 1, huella_operacion: n.padEnd(64, "x"), payload_operacion: "{}", galones: 1, precio: 1, monto: 1, galones_calculados: 0, moneda: "GTQ", creado_por: 1, creado_en: "2026-11-01 00:00:00.000000", ...cols };
  await admin.query("SET SESSION foreign_key_checks=0");
  try { await admin.query(`INSERT INTO flota_cb2_consumos (${Object.keys(base).join(",")}) VALUES (${Object.keys(base).map(() => "?").join(",")})`, Object.values(base)); } finally { await admin.query("SET SESSION foreign_key_checks=1"); }
};
const ident = (o: unknown) => JSON.stringify(o);

/** Base desechable con el esquema CB2 previo a la cadena (consumos + asignaciones); se puede reconstruir para probar el orden alterado. */
async function construirBase() {
    await admin.query("DROP DATABASE IF EXISTS cb2_instalacion_minima; CREATE DATABASE cb2_instalacion_minima CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; USE cb2_instalacion_minima");
    await admin.query(readFileSync("scripts/ci/combustibles-pr2-lab/base.sql", "utf8"));
    await admin.query("ALTER TABLE flota_vehiculos ADD placa VARCHAR(40) NOT NULL DEFAULT 'C-001ABC', ADD estado VARCHAR(40) NOT NULL DEFAULT 'Activo', ADD activo TINYINT NOT NULL DEFAULT 1; CREATE TABLE empleados(id INT PRIMARY KEY,empresa_id INT NOT NULL,nombre VARCHAR(160),estado VARCHAR(20)) ENGINE=InnoDB");
    await admin.query("INSERT IGNORE INTO empresas VALUES(1,1),(2,1)"); await admin.query("INSERT IGNORE INTO usuarios VALUES(1,1),(2,1)");
    await admin.query("CREATE TABLE flota_combustible_estaciones(id INT PRIMARY KEY,empresa_id INT,proveedor_id INT,nombre VARCHAR(150),activo TINYINT) ENGINE=InnoDB");
    const ddl = sql("migrate-2026-10-combustibles-pr2-consumos-facturas.sql").match(/^CREATE TABLE [\s\S]*?COLLATE=utf8mb4_bin;/gm)!; for (const s of ddl) await admin.query(s);
    await admin.query(sql("migrate-2026-10-combustibles-pr514-asignaciones.sql"));
}

describe.skipIf(!pipe)("CB2 instalación mínima (MariaDB 11.8.9 real)", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    admin = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[env]] = await admin.query<RowDataPacket[]>("SELECT VERSION() AS v,@@check_constraint_checks AS ck");
    expect(env.v).toMatch(/^11\.8\.9-MariaDB/); expect(Number(env.ck)).toBe(1);
    await construirBase();
  }, 60000);
  afterAll(async () => { await admin?.query("DROP DATABASE IF EXISTS cb2_instalacion_minima").catch(() => undefined); await admin?.end(); });

  it("N0 base sin la cadena: el detector informa nivel 0 y el primer paso; los prerrequisitos del consumo están", async () => {
    const d = await nivel(); expect(d.nivel).toBe("0"); expect(d.siguiente).toBe(M.terceros);
    const [, pre] = (await admin.query<RowDataPacket[][]>(sql("preflight-2026-11-cb2-nivel-instalacion.sql")))[0] as unknown as RowDataPacket[][];
    expect(pre[0]).toMatchObject({ consumos_innodb: 1, uq_cb2c_ambito: 1, cols_asignacion_de_3: 3, uq_fondolin_c2a_empresa_id: 0, tablas_shell_de_3: 0, fondos_vinculos: 0 });
  });
  it("ORDEN: saltarse pasos falla y NO cambia el esquema (directos, independientes y reportado sin sus antecesores)", async () => {
    const antes = await snapshotEsquema();
    for (const f of [M.directos, M.independientes, M.reportado]) { const r = await intenta(f); expect(r.ok, f).toBe(false); }
    expect(await snapshotEsquema()).toBe(antes); expect((await nivel()).nivel).toBe("0");
  });
  it("N1 terceros: nivel 1; repetirlo falla sin cambiar nada; directos requiere el nivel 1 y los demás siguen bloqueados", async () => {
    expect(await intenta(M.terceros)).toEqual({ ok: true }); const d = await nivel(); expect(d.nivel).toBe("1"); expect(await postcheckVacio(1)).toMatchObject({ faltantes: 0, superior: 0, motor: 0 }); expect(d.siguiente).toBe(M.directos);
    const antes = await snapshotEsquema(); const otra = await intenta(M.terceros); expect(otra.ok).toBe(false); expect(await snapshotEsquema()).toBe(antes);
    for (const f of [M.independientes, M.reportado]) expect((await intenta(f)).ok, f).toBe(false); expect(await snapshotEsquema()).toBe(antes);
  });
  it("N2 directos: nivel 2; repetirlo falla; con v2 todavía NO existe la política independiente", async () => {
    expect(await intenta(M.directos)).toEqual({ ok: true }); const d = await nivel(); expect(d.nivel).toBe("2"); expect(await postcheckVacio(2)).toMatchObject({ faltantes: 0, superior: 0, motor: 0 }); expect(d.siguiente).toBe(M.independientes);
    const antes = await snapshotEsquema(); expect((await intenta(M.directos)).ok).toBe(false); expect((await intenta(M.reportado)).ok).toBe(false); expect(await snapshotEsquema()).toBe(antes);   // la guarda de orden de `piloto-reportado` también rechaza el nivel 2
    expect(await checkClause("ck_cb2c_unidad_tipo")).not.toContain("INDEPENDIENTE_V1");
  });
  it("N3 independientes: nivel 3 (suficiente para registro directo, asignación independiente y consumo); un nombre REPORTADO sobre unidad externa AÚN se rechaza por CHECK; repetirlo falla", async () => {
    expect(await intenta(M.independientes)).toEqual({ ok: true }); const d = await nivel(); expect(d.nivel).toBe("3"); expect(await postcheckVacio(3)).toMatchObject({ faltantes: 0, superior: 0, motor: 0 }); expect(d.siguiente).toContain("OPCIONAL");
    const antes = await snapshotEsquema(); expect((await intenta(M.independientes)).ok).toBe(false); expect(await snapshotEsquema()).toBe(antes);
    await admin.query("INSERT INTO flota_cb2_externos_pilotos(empresa_id,referencia,referencia_hash,nombre) VALUES(1,'p1',REPEAT('1',64),'Piloto Directo')");
    await admin.query("INSERT INTO flota_cb2_externos_unidades(empresa_id,referencia,referencia_hash,placa,tipo,descripcion) VALUES(1,'u1',REPEAT('2',64),'M884LAB','MOTOCICLETA','Unidad directa')");
    const [{ p }] = await q("SELECT id p FROM flota_cb2_externos_pilotos LIMIT 1"); const [{ u }] = await q("SELECT id u FROM flota_cb2_externos_unidades LIMIT 1");
    await consumo("OK-INDEP", { vehiculo_id: null, piloto_externo_id: p, unidad_externa_id: u, identidad_externa: ident({ politica: "INDEPENDIENTE_V1", piloto: { tipo: "EXTERNO", id: p }, unidad: { tipo: "EXTERNA", id: u } }) });
    await expect(consumo("REP-SIN-V4", { vehiculo_id: null, unidad_externa_id: u, identidad_externa: ident({ politica: "REPORTADO_V1", piloto: { tipo: "REPORTADO", id: null }, unidad: { tipo: "EXTERNA", id: u } }) })).rejects.toMatchObject({ errno: 4025 });
  });
  it("N4 piloto-reportado (singular, opcional): nivel 4; permite REPORTADO_V1 sobre unidad externa y sigue prohibiendo mezclarlo con empleado/piloto; las filas previas se conservan; repetirlo falla", async () => {
    const filasAntes = (await q("SELECT COUNT(*) n FROM flota_cb2_consumos"))[0].n;
    expect(await intenta(M.reportado)).toEqual({ ok: true }); const d = await nivel(); expect(d.nivel).toBe("4"); expect(await postcheckVacio(4)).toMatchObject({ faltantes: 0, superior: 0, motor: 0 }); expect(d.siguiente).toContain("NINGUNO");
    expect((await q("SELECT COUNT(*) n FROM flota_cb2_consumos"))[0].n).toBe(filasAntes);
    const antes = await snapshotEsquema(); expect((await intenta(M.reportado)).ok).toBe(false); expect(await snapshotEsquema()).toBe(antes);
    const [{ u }] = await q("SELECT id u FROM flota_cb2_externos_unidades LIMIT 1");
    await consumo("OK-REP", { vehiculo_id: null, unidad_externa_id: u, identidad_externa: ident({ politica: "REPORTADO_V1", piloto: { tipo: "REPORTADO", id: null }, unidad: { tipo: "EXTERNA", id: u } }) });
    await expect(consumo("REP-CON-EMPLEADO", { vehiculo_id: null, unidad_externa_id: u, empleado_id: 1, identidad_externa: ident({ politica: "REPORTADO_V1", piloto: { tipo: "REPORTADO", id: null }, unidad: { tipo: "EXTERNA", id: u } }) })).rejects.toMatchObject({ errno: 4025 });
  });
  it("INCONSISTENTE: una instalación parcial o manual (p. ej. se quita ck_cb2_piloto_unico con el nivel 4) se detecta y manda DETENER Y AUDITAR", async () => {
    await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2_piloto_unico"); const d = await nivel(); expect(d.nivel).toBe("INCONSISTENTE"); expect(d.siguiente).toBe("DETENER Y AUDITAR"); expect((await postcheckVacio(4)).faltantes).toBeGreaterThan(0);
    await admin.query("ALTER TABLE flota_cb2_consumos ADD CONSTRAINT ck_cb2_piloto_unico CHECK (empleado_id IS NULL OR piloto_externo_id IS NULL)"); expect((await nivel()).nivel).toBe("4");
  });
  it("Shell y vínculos con fondos exigen sus prerrequisitos: las tablas de nombres reportados se instalan sobre el nivel ≥1 de consumos; el vínculo con fondos EXIGE `uq_fondolin_c2a_empresa_id` en líneas de fondo", async () => {
    expect(await intenta(M.shell)).toEqual({ ok: true });
    const sinLineas = await intenta(M.vinculos); expect(sinLineas.ok).toBe(false);   // falta tms_solicitud_fondo_lineas / su índice único
    await admin.query("CREATE TABLE tms_solicitud_fondo_lineas(id INT PRIMARY KEY, empresa_id INT NOT NULL, vehiculo_id INT NULL, UNIQUE KEY uq_fondolin_c2a_empresa_id(empresa_id,id)) ENGINE=InnoDB");
    expect(await intenta(M.vinculos)).toEqual({ ok: true });
    const [, pre] = (await admin.query<RowDataPacket[][]>(sql("preflight-2026-11-cb2-nivel-instalacion.sql")))[0] as unknown as RowDataPacket[][];
    expect(pre[0]).toMatchObject({ uq_fondolin_c2a_empresa_id: 1, tablas_shell_de_3: 3, fondos_vinculos: 1 });
  });
  it("fondos-vehiculos-compartidos (opcional, ajeno al consumo CB2): la sintaxis original `ADD CONSTRAINT IF NOT EXISTS … FOREIGN KEY` era inválida en 11.8.9; el archivo corregido se aplica, es idempotente y deja solo las FK simples a flota_vehiculos(id)", async () => {
    const texto = sql(M.compartidos).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"); expect(texto).not.toMatch(/ADD CONSTRAINT IF NOT EXISTS/); expect(texto).toMatch(/FOREIGN KEY IF NOT EXISTS \(vehiculo_id\)/);
    await admin.query("ALTER TABLE flota_vehiculos ADD UNIQUE KEY IF NOT EXISTS uq_veh_ambito_stub(empresa_id,id)");
    await expect(admin.query("ALTER TABLE IF EXISTS tms_solicitud_fondo_lineas ADD CONSTRAINT IF NOT EXISTS fk_x FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos (id)")).rejects.toMatchObject({ code: "ER_PARSE_ERROR" });   // la forma antigua
    await admin.query("ALTER TABLE tms_solicitud_fondo_lineas ADD CONSTRAINT fk_fondolin_vehiculo_ambito FOREIGN KEY (empresa_id,vehiculo_id) REFERENCES flota_vehiculos (empresa_id,id) ON DELETE RESTRICT");
    await admin.query("CREATE TABLE tms_gastos_operativos(id INT PRIMARY KEY, empresa_id INT NOT NULL, vehiculo_id INT NULL, CONSTRAINT fk_gasto_vehiculo_ambito FOREIGN KEY (empresa_id,vehiculo_id) REFERENCES flota_vehiculos (empresa_id,id) ON DELETE RESTRICT) ENGINE=InnoDB");
    const fks = async () => (await q("SELECT TABLE_NAME t,CONSTRAINT_NAME n,GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) c FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('tms_gastos_operativos','tms_solicitud_fondo_lineas') AND REFERENCED_TABLE_NAME='flota_vehiculos' GROUP BY TABLE_NAME,CONSTRAINT_NAME ORDER BY 1,2")).map((r) => `${r.t}.${r.n}(${r.c})`);
    expect(await fks()).toEqual(["tms_gastos_operativos.fk_gasto_vehiculo_ambito(empresa_id,vehiculo_id)", "tms_solicitud_fondo_lineas.fk_fondolin_vehiculo_ambito(empresa_id,vehiculo_id)"]);
    expect(await intenta(M.compartidos)).toEqual({ ok: true });
    const despues = ["tms_gastos_operativos.fk_gasto_vehiculo(vehiculo_id)", "tms_solicitud_fondo_lineas.fk_fondolin_vehiculo(vehiculo_id)"]; expect(await fks()).toEqual(despues);
    expect(await intenta(M.compartidos)).toEqual({ ok: true }); expect(await fks()).toEqual(despues);   // idempotente
    // el comportamiento que se buscaba: un vehículo de OTRA empresa ya se puede referenciar desde la línea de fondo
    await admin.query("INSERT INTO flota_vehiculos(id,empresa_id) VALUES(9001,2)"); await admin.query("INSERT INTO tms_solicitud_fondo_lineas(id,empresa_id,vehiculo_id) VALUES(77,1,9001)");
  });
  it("GUARDA DE ORDEN: `piloto-reportado` sobre el nivel 2 FALLA sin cambiar nada (antes se aplicaba y después `identidades-independientes` degradaba el CHECK perdiendo REPORTADO_V1); en el orden correcto la cadena completa termina en nivel 4 con REPORTADO_V1 aceptado", async () => {
    await construirBase(); expect(await intenta(M.terceros)).toEqual({ ok: true }); expect(await intenta(M.directos)).toEqual({ ok: true });
    const antes = await snapshotEsquema(); const salto = await intenta(M.reportado); expect(salto.ok).toBe(false); expect(await snapshotEsquema()).toBe(antes); expect((await nivel()).nivel).toBe("2");
    expect(await intenta(M.independientes)).toEqual({ ok: true }); expect(await intenta(M.reportado)).toEqual({ ok: true }); const d = await nivel(); expect(d.nivel).toBe("4"); expect(await checkClause("ck_cb2c_unidad_tipo")).toContain("REPORTADO_V1");
  });

  // ---- Detector robusto (firmas de estructura): instalaciones PARCIALES o ALTERADAS nunca dan un nivel válido ----
  const cadena = [M.terceros, M.directos, M.independientes, M.reportado];
  const hasta = async (n: number) => { await construirBase(); for (const f of cadena.slice(0, n)) expect(await intenta(f), f).toEqual({ ok: true }); };
  const exigirDetener = async (motivo: string) => { const d = await nivel(); expect(d.nivel, `${motivo}: ${d.secuencia}/${d.version}`).toBe("INCONSISTENTE"); expect(d.siguiente, motivo).toBe("DETENER Y AUDITAR"); return d; };
  const bloqueEsperado = () => { const t = sql(DETECTOR); const b = t.slice(t.indexOf("-- BEGIN-ESPERADO"), t.indexOf("-- END-ESPERADO")); return Object.fromEntries([...b.matchAll(/'([^']+)'\s*(?:objeto)?\s*,\s*'([0-9a-f]{64})'/g)].map((m) => [m[1], m[2]])); };
  it("FIRMAS: el bloque ESPERADO del detector coincide EXACTAMENTE con lo que dejan las migraciones reales en cada nivel (si el SQL de una migración o la versión del motor cambia, esta prueba falla) y las firmas de un nivel no cambian en los siguientes", async () => {
    await construirBase(); const generado: Record<string, string> = {}; const porNivel: Array<Map<string, string>> = [];
    for (let k = 1; k <= 4; k++) {
      expect(await intenta(cadena[k - 1])).toEqual({ ok: true }); const o = await observar(); porNivel[k] = new Map(o.map((r) => [String(r.objeto), String(r.firma)]));
      for (const r of o) { if (Number(r.nivel) === k) generado[String(r.objeto)] = String(r.firma); if (Number(r.nivel) === 0) generado[`ck_cb2c_unidad_tipo v${k}`] = String(r.firma); }
    }
    for (const [objeto, firma] of Object.entries(generado)) if (!objeto.startsWith("ck_cb2c_unidad_tipo v")) expect(porNivel[4].get(objeto), `estabilidad de ${objeto}`).toBe(firma);
    const lineas = Object.entries(generado).map(([o, f], i) => (i === 0 ? `  SELECT '${o}' objeto, '${f}' firma` : `  UNION ALL SELECT '${o}', '${f}'`)).join("\n");
    if (existsSync(path.join(".lab-runtime", "REGENERAR_FIRMAS"))) writeFileSync(path.join(".lab-runtime", "esperado.sql"), lineas + "\n");   // solo para regenerar el bloque tras revisar un cambio de migración
    expect(bloqueEsperado()).toEqual(generado); expect(Object.keys(generado)).toHaveLength(Object.keys(generado).length);
  });
  it("DETECTOR robusto, esquemas parciales/alterados: CHECK ELIMINADO (nivel 2 sin ck_cb2c_unidad_tipo; nivel 3 sin ck_cb2_piloto_unico) → INCONSISTENTE, no un nivel válido", async () => {
    await hasta(2); expect((await nivel()).nivel).toBe("2"); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_unidad_tipo"); await exigirDetener("nivel 2 sin ck_cb2c_unidad_tipo");
    await hasta(1); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_unidad_tipo"); await exigirDetener("nivel 1 sin ck_cb2c_unidad_tipo");
    await hasta(3); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2_piloto_unico"); await exigirDetener("nivel 3 sin ck_cb2_piloto_unico");
  }, 60000);
  it("DETECTOR robusto, CHECK MODIFICADO: una expresión que CONTIENE el texto INDEPENDIENTE_V1/REPORTADO_V1 pero es trivial, otra versión, o con ck_cb2_piloto_unico alterado → INCONSISTENTE (no se acredita por subcadenas)", async () => {
    await hasta(3);
    await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_unidad_tipo, ADD CONSTRAINT ck_cb2c_unidad_tipo CHECK (COALESCE(JSON_VALUE(identidad_externa,'$.politica'),'')='INDEPENDIENTE_V1' OR 1=1)"); const señuelo = await exigirDetener("CHECK señuelo con INDEPENDIENTE_V1"); expect(señuelo.version).toBe("9");
    await hasta(3); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2_piloto_unico, ADD CONSTRAINT ck_cb2_piloto_unico CHECK (1=1)"); await exigirDetener("ck_cb2_piloto_unico trivial");
    await hasta(4); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2_piloto_reportado, ADD CONSTRAINT ck_cb2_piloto_reportado CHECK (COALESCE(JSON_VALUE(identidad_externa,'$.politica'),'')<>'REPORTADO_V1')"); await exigirDetener("ck_cb2_piloto_reportado alterado");
    await hasta(2); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_unidad_tipo, ADD CONSTRAINT ck_cb2c_unidad_tipo CHECK (vehiculo_id IS NOT NULL OR vehiculo_id IS NULL)"); await exigirDetener("CHECK de nivel 2 reemplazado por otro");
    await hasta(4); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_unidad_tipo, ADD CONSTRAINT ck_cb2c_unidad_tipo CHECK (vehiculo_id IS NOT NULL AND asociacion_externa_id IS NULL AND identidad_externa IS NULL AND piloto_externo_id IS NULL AND unidad_externa_id IS NULL)"); await exigirDetener("CHECK v4 degradado a una sola rama");
  }, 90000);
  it("DETECTOR robusto, FK INCORRECTA: otra regla ON DELETE, otras columnas o otra tabla referenciada → INCONSISTENTE", async () => {
    await hasta(2);
    await admin.query("ALTER TABLE flota_cb2_consumos DROP FOREIGN KEY fk_cb2c_piloto_directo"); await admin.query("ALTER TABLE flota_cb2_consumos ADD CONSTRAINT fk_cb2c_piloto_directo FOREIGN KEY(empresa_id,piloto_externo_id) REFERENCES flota_cb2_externos_pilotos(empresa_id,id) ON DELETE NO ACTION ON UPDATE NO ACTION"); await exigirDetener("FK con otra regla (NO ACTION en lugar de RESTRICT)");
    await hasta(2);
    await admin.query("ALTER TABLE flota_cb2_consumos DROP FOREIGN KEY fk_cb2c_unidad_directa"); await admin.query("ALTER TABLE flota_cb2_consumos ADD CONSTRAINT fk_cb2c_unidad_directa FOREIGN KEY(empresa_id,unidad_externa_id) REFERENCES flota_cb2_externos_pilotos(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT"); await exigirDetener("FK de la unidad que apunta a la TABLA equivocada (pilotos)");
    await hasta(1);
    await admin.query("ALTER TABLE flota_cb2_consumos DROP FOREIGN KEY fk_cb2c_externo"); await admin.query("ALTER TABLE flota_cb2_consumos ADD CONSTRAINT fk_cb2c_externo FOREIGN KEY(empresa_id,asociacion_externa_id) REFERENCES flota_cb2_externos_asociaciones(empresa_id,id) ON DELETE NO ACTION"); await exigirDetener("fk_cb2c_externo con otra regla");
    await hasta(2);
    await admin.query("ALTER TABLE flota_cb2_consumos DROP FOREIGN KEY fk_cb2c_piloto_directo"); await exigirDetener("FK de nivel 2 ausente");
    await hasta(2);
    await admin.query("ALTER TABLE flota_cb2_consumos DROP FOREIGN KEY fk_cb2c_piloto_directo"); await admin.query("ALTER TABLE flota_cb2_consumos ADD CONSTRAINT fk_cb2c_piloto_directo FOREIGN KEY(empresa_id,piloto_externo_id) REFERENCES flota_cb2_externos_pilotos(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT"); expect((await nivel()).nivel).toBe("2");   // control: la misma FK recreada con la definición correcta SÍ vuelve a nivel 2
  }, 90000);
  it("DETECTOR robusto, COLUMNA FALTANTE o con otro tipo: columna de nivel 2 eliminada, columna de nivel 1 con otro tipo, vehiculo_id vuelto NOT NULL, tabla externa con columna de más o índice de menos → INCONSISTENTE", async () => {
    await hasta(2);
    await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_unidad_tipo, DROP FOREIGN KEY fk_cb2c_unidad_directa, DROP INDEX ix_cb2c_unidad_directa, DROP COLUMN unidad_externa_id"); await exigirDetener("columna unidad_externa_id eliminada");
    await hasta(1); await admin.query("ALTER TABLE flota_cb2_consumos MODIFY identidad_externa TEXT NULL"); await exigirDetener("identidad_externa con otro tipo");
    await hasta(1); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_unidad_tipo, MODIFY vehiculo_id INT NOT NULL"); await exigirDetener("vehiculo_id NOT NULL");
    await hasta(1); await admin.query("ALTER TABLE flota_cb2_externos_pilotos ADD COLUMN extra INT NULL"); await exigirDetener("tabla externa con columna de más");
    await hasta(2); await admin.query("ALTER TABLE flota_cb2_externos_unidades DROP INDEX uq_cb2eu_ref"); await exigirDetener("tabla externa sin índice único");
    await hasta(2); await admin.query("ALTER TABLE flota_cb2_consumos DROP FOREIGN KEY fk_cb2c_piloto_directo, DROP INDEX ix_cb2c_piloto_directo"); await exigirDetener("índice y FK de nivel 2 ausentes");
    await hasta(1); await admin.query("SET SESSION foreign_key_checks=0; DROP TABLE flota_cb2_externos_unidades; SET SESSION foreign_key_checks=1"); await exigirDetener("tabla externa ausente");
  }, 120000);
  it("DETECTOR robusto, nivel superior a medias (objeto de un nivel posterior presente sin el resto) → INCONSISTENTE; los niveles legítimos 0-4 siguen detectándose con su secuencia C/V exacta", async () => {
    await hasta(1); await admin.query("ALTER TABLE flota_cb2_consumos ADD COLUMN piloto_externo_id INT NULL"); const parcial = await exigirDetener("columna de nivel 2 suelta"); expect(parcial.secuencia).toBe("CPVV");
    for (const [n, seq] of [[0, "VVVV"], [1, "CVVV"], [2, "CCVV"], [3, "CCCV"], [4, "CCCC"]] as const) { await hasta(n); const d = await nivel(); expect([d.nivel, d.secuencia, d.version]).toEqual([String(n), seq, String(n)]); expect(d.hechos.every((h) => (n === 0 ? Number(h.presente) === 0 : true))).toBe(true); }
  }, 120000);

  // ---- Variante con ESQUEMA EXPLÍCITO (no depende de DATABASE()) ----
  const resumen = (d: { nivel: string; secuencia: string; version: string; hechos: RowDataPacket[] }) => ({ nivel: d.nivel, secuencia: d.secuencia, version: d.version, hechos: d.hechos.map((h) => [h.nivel, h.objeto, h.presente, h.ok, h.observada, h.esperada]) });
  it("VARIANTE esquema explícito: idéntica al detector original en los niveles 0-4 (mismo nivel, secuencia C/V/P, versión de CHECK y las MISMAS firmas observadas/esperadas por objeto)", async () => {
    for (const n of [0, 1, 2, 3, 4]) { await hasta(n); const original = await nivel(); const variante = await nivelVariante(BASE_LAB); expect(variante.nivel).toBe(String(n)); expect(variante.diagnostico).toBe("OK"); expect(variante.analizado).toBe(BASE_LAB); expect(resumen(variante)).toEqual(resumen(original)); }
  }, 120000);
  it("VARIANTE con DATABASE() = information_schema (o mysql): el original da un FALSO nivel 0 sobre un esquema de nivel 3; la variante con `@esquema` fijado da el nivel 3 correcto", async () => {
    await hasta(3);
    const original = await conDatabase("information_schema", nivel); expect(original.nivel).toBe("0");   // el defecto operativo que se observó en phpMyAdmin: nivel 0 falso
    for (const otro of ["information_schema", "mysql"]) { const v = await conDatabase(otro, () => nivelVariante(BASE_LAB)); expect([v.nivel, v.secuencia, v.version, v.diagnostico]).toEqual(["3", "CCCV", "3", "OK"]); expect(v.siguiente).toContain("OPCIONAL"); }
    await hasta(4); expect((await conDatabase("information_schema", () => nivelVariante(BASE_LAB))).nivel).toBe("4");
    await hasta(0); expect((await conDatabase("information_schema", () => nivelVariante(BASE_LAB))).nivel).toBe("0");   // un nivel 0 REAL también se reconoce (la base CB2 existe y no hay cadena)
  }, 120000);
  it("VARIANTE fail-closed: esquema no fijado, vacío, inexistente, de sistema o sin `flota_cb2_consumos` → INCONSISTENTE / DETENER Y AUDITAR con el motivo; nunca un nivel", async () => {
    await hasta(3); await admin.query("DROP DATABASE IF EXISTS cb2_esquema_vacio; CREATE DATABASE cb2_esquema_vacio"); await admin.query(`USE ${BASE_LAB}`);
    const casos: Array<[string | null, RegExp]> = [[null, /ESQUEMA_NO_FIJADO/], ["", /ESQUEMA_NO_FIJADO/], ["no_existe_ni_en_sueños", /ESQUEMA_NO_FIJADO/], ["information_schema", /ESQUEMA_NO_FIJADO/], ["mysql", /ESQUEMA_NO_FIJADO/], ["performance_schema", /ESQUEMA_NO_FIJADO/], ["cb2_esquema_vacio", /BASE_CB2_AUSENTE/]];
    for (const [esq, motivo] of casos) { const v = await conDatabase("information_schema", () => nivelVariante(esq)); expect(v.nivel, String(esq)).toBe("INCONSISTENTE"); expect(v.siguiente, String(esq)).toBe("DETENER Y AUDITAR"); expect(v.diagnostico, String(esq)).toMatch(motivo); }
    await admin.query("DROP DATABASE cb2_esquema_vacio");
  }, 60000);
  it("VARIANTE: las instalaciones parciales o alteradas siguen dando INCONSISTENTE aunque DATABASE() sea information_schema (CHECK eliminado, CHECK señuelo, FK distinta, columna faltante)", async () => {
    const detenerVariante = async (motivo: string) => { const v = await conDatabase("information_schema", () => nivelVariante(BASE_LAB)); expect(v.nivel, `${motivo}: ${v.secuencia}/${v.version}`).toBe("INCONSISTENTE"); expect(v.siguiente, motivo).toBe("DETENER Y AUDITAR"); };
    await hasta(2); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_unidad_tipo"); await detenerVariante("CHECK eliminado");
    await hasta(3); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_unidad_tipo, ADD CONSTRAINT ck_cb2c_unidad_tipo CHECK (COALESCE(JSON_VALUE(identidad_externa,'$.politica'),'')='INDEPENDIENTE_V1' OR 1=1)"); await detenerVariante("CHECK señuelo");
    await hasta(2); await admin.query("ALTER TABLE flota_cb2_consumos DROP FOREIGN KEY fk_cb2c_piloto_directo"); await admin.query("ALTER TABLE flota_cb2_consumos ADD CONSTRAINT fk_cb2c_piloto_directo FOREIGN KEY(empresa_id,piloto_externo_id) REFERENCES flota_cb2_externos_pilotos(empresa_id,id) ON DELETE NO ACTION ON UPDATE NO ACTION"); await detenerVariante("FK con otra regla");
    await hasta(2); await admin.query("ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_unidad_tipo, DROP FOREIGN KEY fk_cb2c_unidad_directa, DROP INDEX ix_cb2c_unidad_directa, DROP COLUMN unidad_externa_id"); await detenerVariante("columna faltante");
  }, 120000);
});
