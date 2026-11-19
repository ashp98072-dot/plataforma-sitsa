import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";

/**
 * VERIFICACIÓN CONTRA UNA BASE REAL DESECHABLE — incidente #1267 de la migración v2 de guardas de Flota (mezcla ilegal de cotejos).
 *
 * Se OMITE por defecto. Solo corre con `FLOTA_CANON_DB_PORT` apuntando a una MariaDB LOCAL y DESECHABLE (127.0.0.1, root sin contraseña). Crea y destruye
 * bases propias `guardas_v2_col_*` con un esquema REDUCIDO e instala la migración REAL de fusiones (M1). Datos sintéticos; nada toca producción.
 *
 * El incidente: la tabla de respaldo (CREATE TABLE … DEFAULT CHARSET=utf8mb4) tomaba el cotejo por defecto del juego de caracteres (utf8mb4_uca1400_ai_ci),
 * pero los parámetros de los procedimientos usan el cotejo de la BASE (utf8mb4_unicode_ci en Hostinger): comparar ambos lanzaba #1267. Se prueban TRES
 * combinaciones base/tabla de respaldo con cotejos distintos (incluida la de producción y la inversa) para migración, reanudación, rollback y diagnóstico.
 */
const PUERTO = process.env.FLOTA_CANON_DB_PORT;
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 }); // armar una base con triggers reales tarda segundos
const MIGRACION = "sql/migrate-2026-11-flota-fusiones-guardas-v2.sql";
const ROLLBACK = "sql/rollback-2026-11-flota-fusiones-guardas-v2.sql";
const POSTCHECK = "sql/postcheck-2026-11-flota-fusiones-guardas-v2.sql";
const PREFLIGHT = "sql/preflight-2026-11-flota-fusiones-guardas-v2.sql";
const DIAGNOSTICO = "sql/diagnostico-2026-11-flota-fusiones-guardas-v2-parcial.sql";
const FP = "5b8d8fcce363b8262e1c252554757d25"; // hash de tms_planes_viaje:vehiculo_solicitado_perfil_id

const ESQUEMA = `
 CREATE TABLE empresas (id INT PRIMARY KEY, nombre VARCHAR(80)) ENGINE=InnoDB;
 CREATE TABLE usuarios (id INT PRIMARY KEY, activo TINYINT NOT NULL DEFAULT 1, rol_global VARCHAR(30) NOT NULL) ENGINE=InnoDB;
 CREATE TABLE flota_vehiculos (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL, descripcion VARCHAR(200) NULL,
  tipo_unidad VARCHAR(20) NOT NULL DEFAULT 'VEHICULO', chasis VARCHAR(80) NULL, en_taller TINYINT(1) NOT NULL DEFAULT 0, estado VARCHAR(40) NOT NULL DEFAULT 'Activo',
  activo TINYINT(1) NOT NULL DEFAULT 1, UNIQUE KEY uq_placa (empresa_id, placa), UNIQUE KEY uq_emp_id (empresa_id, id)) ENGINE=InnoDB;
 CREATE TABLE flota_vehiculo_acceso (vehiculo_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY (vehiculo_id, empresa_id)) ENGINE=InnoDB;
 CREATE TABLE flota_viajes (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, vehiculo_id INT NOT NULL, FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id)) ENGINE=InnoDB;
 CREATE TABLE tms_cotizacion_costeo_perfiles (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(60)) ENGINE=InnoDB;
 CREATE TABLE tms_planes_viaje (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, tc_vehiculo_id INT NULL, vehiculo_solicitado_perfil_id INT NULL,
  FOREIGN KEY (vehiculo_solicitado_perfil_id) REFERENCES tms_cotizacion_costeo_perfiles(id)) ENGINE=InnoDB;`;

const RESPALDO_DDL = (cotejo: string) => `CREATE TABLE flota_fusion_guardas_v2_respaldo (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, tabla VARCHAR(64) NOT NULL, campo VARCHAR(64) NOT NULL, trigger_nombre VARCHAR(64) NOT NULL, momento VARCHAR(10) NOT NULL,
 evento VARCHAR(10) NOT NULL, accion LONGTEXT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_guardas_v2_trigger (trigger_nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${cotejo}`;

type Config = { nombre: string; baseCotejo: string; respaldoCotejo: string; daError1267: boolean };
const CONFIGS: Config[] = [
  { nombre: "producción: base utf8mb4_unicode_ci, respaldo en utf8mb4_uca1400_ai_ci (cotejo por defecto del juego de caracteres)", baseCotejo: "utf8mb4_unicode_ci", respaldoCotejo: "utf8mb4_uca1400_ai_ci", daError1267: true },
  { nombre: "inversa: base utf8mb4_uca1400_ai_ci, respaldo en utf8mb4_unicode_ci", baseCotejo: "utf8mb4_uca1400_ai_ci", respaldoCotejo: "utf8mb4_unicode_ci", daError1267: true },
  { nombre: "otra mezcla: base utf8mb4_general_ci, respaldo en utf8mb4_bin", baseCotejo: "utf8mb4_general_ci", respaldoCotejo: "utf8mb4_bin", daError1267: false }, // un cotejo _bin tiene precedencia explícita: no falla, pero la migración también debe funcionar
];

const conexiones: mysql.Connection[] = [];
async function conectar(base?: string) {
  const c = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", database: base, multipleStatements: true });
  conexiones.push(c);
  return c;
}
const sinComentarios = (ruta: string) => readFileSync(ruta, "utf8").replace(/^\s*--.*$/gm, "");

class Lab {
  constructor(readonly base: string, readonly c: mysql.Connection) {}
  q = async (sql: string, params: unknown[] = []) => (await this.c.query(sql, params as never))[0] as Record<string, unknown>[];
  /** Script real con DELIMITER // … DELIMITER ; (se parte igual que lo haría el cliente). */
  async script(ruta: string) {
    const sql = sinComentarios(ruta);
    if (!/DELIMITER/i.test(sql)) { await this.c.query(sql); return; }
    const [antes, resto] = sql.split(/DELIMITER\s+\/\//i);
    for (const p of antes.split(";")) if (p.trim()) await this.c.query(p);
    const [bloque, despues] = resto.split(/DELIMITER\s+;/i);
    for (const p of bloque.split("//")) if (p.trim()) await this.c.query(p);
    for (const p of (despues ?? "").split(";")) if (p.trim()) await this.c.query(p);
  }
  /** Sentencias de un script de solo lectura, una por una (A, B, C, D del diagnóstico). */
  async sentencias(ruta: string): Promise<Record<string, unknown>[][]> {
    const partes = sinComentarios(ruta).split(";").filter((p) => p.trim());
    const out: Record<string, unknown>[][] = [];
    for (const p of partes) out.push((await this.c.query(p))[0] as Record<string, unknown>[]);
    return out;
  }
  guardas = () => this.q("SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='tms_planes_viaje' AND TRIGGER_NAME REGEXP '^ff[iu]_' ORDER BY TRIGGER_NAME");
  respaldo = () => this.q("SELECT trigger_nombre, accion FROM flota_fusion_guardas_v2_respaldo ORDER BY id");
  tabla = async () => (await this.q("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo'")).length === 1;
  procedimientos = async () => (await this.q("SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() ORDER BY ROUTINE_NAME")).map((r) => String(r.ROUTINE_NAME));
  veredicto = async () => String((await this.sentencias(DIAGNOSTICO))[3][0].veredicto);
  insertarPlanConPerfil3 = () => this.q("INSERT INTO tms_planes_viaje (empresa_id, codigo, vehiculo_solicitado_perfil_id) VALUES (1, ?, 3)", [`P-${Math.random()}`]);
}

let contador = 0;
/** Base nueva con la migración REAL de fusiones (M1). `respaldo`: pre-crea la tabla de respaldo con ese cotejo (como dejó la revisión 1). */
async function armar(cfg: Config, opciones: { respaldo: boolean }): Promise<Lab> {
  const base = `guardas_v2_col_${process.pid}_${++contador}`;
  const admin = await conectar();
  await admin.query(`DROP DATABASE IF EXISTS ${base}`);
  basesCreadas.push(base);
  await admin.query(`CREATE DATABASE ${base} CHARACTER SET utf8mb4 COLLATE ${cfg.baseCotejo}`);
  const lab = new Lab(base, await conectar(base));
  await lab.c.query(ESQUEMA);
  // Vehículos: el ID 3 será el «absorbido» y coincide con el perfil de costeo 3 (el choque del falso positivo).
  await lab.q("INSERT INTO empresas (id) VALUES (1); INSERT INTO usuarios (id, rol_global) VALUES (1,'Admin')");
  await lab.q("INSERT INTO tms_cotizacion_costeo_perfiles (id, nombre) VALUES (1,'a'),(2,'b'),(3,'c')");
  await lab.q("INSERT INTO flota_vehiculos (id, empresa_id, placa, chasis) VALUES (1,1,'A-001AAA','X1'),(2,1,'A-002AAA','X2'),(3,1,'558BSJ','CH558'),(4,1,'558 BSJ','CH558')");
  await lab.script("sql/migrate-2026-11-flota-fusiones.sql");
  await lab.q("INSERT INTO flota_vehiculos_fusiones (origen_id, destino_id, empresa_id, administrador_id, motivo, origen_snapshot, destino_snapshot) VALUES (3,4,1,1,'alias previo (prueba)','{}','{}')");
  if (opciones.respaldo) await lab.q(RESPALDO_DDL(cfg.respaldoCotejo));
  return lab;
}
const basesCreadas: string[] = [];
afterAll(async () => {
  if (PUERTO && conexiones.length) { try { for (const b of basesCreadas) await conexiones[0].query(`DROP DATABASE IF EXISTS ${b}`); } catch { /* mejor esfuerzo */ } }
  for (const c of conexiones) { try { await c.end(); } catch { /* ya cerrada */ } } });

describe.skipIf(!PUERTO).each(CONFIGS)("migración v2 con cotejos mezclados — $nombre", (cfg) => {
  it("el entorno de prueba REPRODUCE el incidente: comparar la tabla de respaldo con un parámetro de procedimiento lanza #1267", async () => {
    const lab = await armar(cfg, { respaldo: true });
    expect(String((await lab.q("SELECT @@collation_database AS c"))[0].c)).toBe(cfg.baseCotejo);
    expect(String((await lab.q("SELECT TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo'"))[0].c)).toBe(cfg.respaldoCotejo);
    await lab.q("CREATE PROCEDURE ingenuo(IN p VARCHAR(64)) SELECT COUNT(*) FROM flota_fusion_guardas_v2_respaldo WHERE trigger_nombre = p");
    if (cfg.daError1267) await expect(lab.q("CALL ingenuo('x')")).rejects.toMatchObject({ errno: 1267 });
    else await expect(lab.q("CALL ingenuo('x')")).resolves.toBeDefined();
  });

  it("estado del incidente (tabla de respaldo vacía + procedimientos residuales + guardas intactas): el diagnóstico dice SIN CAMBIOS y la REVISIÓN 2 reanuda y completa", async () => {
    const lab = await armar(cfg, { respaldo: true });
    for (const n of ["respaldar_guarda_v2", "retirar_guarda_v2", "corregir_guardas_fusion_v2"]) await lab.q(`CREATE PROCEDURE ${n}() SELECT 'residual de la revisión 1'`);
    const antes = await lab.guardas();
    const [tablero] = await lab.sentencias(DIAGNOSTICO);
    expect(tablero.find((f) => f.orden === 1)?.valor).toBe("1");
    expect(String(tablero.find((f) => f.orden === 5)?.valor)).toContain("respaldar_guarda_v2");
    expect(await lab.veredicto()).toMatch(/^SIN CAMBIOS/);
    await lab.script(MIGRACION);
    expect(await lab.procedimientos()).toEqual([]); // procedimientos recreados y eliminados
    const resp = await lab.respaldo();
    expect(resp.map((r) => r.trigger_nombre).sort()).toEqual([`ffi_${FP}`, `ffu_${FP}`]);
    for (const r of resp) expect(r.accion).toBe(antes.find((g) => g.TRIGGER_NAME === r.trigger_nombre)!.ACTION_STATEMENT); // definición exacta respaldada
    expect((await lab.guardas()).length).toBe(antes.length - 2);
    expect(String((await lab.q("SELECT TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo'"))[0].c)).toBe(cfg.respaldoCotejo); // se reutilizó la tabla existente
    expect(await lab.veredicto()).toMatch(/^COMPLETA/);
  });

  it("efecto de v2: el perfil de costeo 3 se permite y las demás guardas siguen bloqueando al vehículo absorbido (3)", async () => {
    const lab = await armar(cfg, { respaldo: true });
    await expect(lab.insertarPlanConPerfil3()).rejects.toThrow(/fusionado/i); // antes: falso positivo
    await lab.script(MIGRACION);
    await expect(lab.insertarPlanConPerfil3()).resolves.toBeDefined();
    await expect(lab.q("INSERT INTO tms_planes_viaje (empresa_id, codigo, tc_vehiculo_id) VALUES (1,'P-ABS',3)")).rejects.toThrow(/fusionado/i);
    await expect(lab.q("INSERT INTO flota_viajes (empresa_id, vehiculo_id) VALUES (1,3)")).rejects.toThrow(/fusionado/i);
    await expect(lab.q("INSERT INTO flota_viajes (empresa_id, vehiculo_id) VALUES (1,4)")).resolves.toBeDefined();
  });

  it("postcheck y preflight v2 funcionan con los cotejos mezclados (sin cambios en esos scripts)", async () => {
    const lab = await armar(cfg, { respaldo: true });
    const [pre1, pre2] = await lab.sentencias(PREFLIGHT);
    expect(pre1[0]).toMatchObject({ tabla_fusiones: 1, trigger_principal: 1, respaldo_ya_existe: 1 });
    expect(pre2.map((f) => String(f.guarda).slice(0, 4)).sort()).toEqual(["ffi_", "ffu_"]);
    await lab.script(MIGRACION);
    const [falsos, faltantes, respaldo] = await lab.sentencias(POSTCHECK);
    expect([falsos.length, faltantes.length, respaldo.length]).toEqual([0, 0, 2]);
  });

  it("idempotente: reaplicar no duplica el respaldo ni falla", async () => {
    const lab = await armar(cfg, { respaldo: true });
    await lab.script(MIGRACION);
    await lab.script(MIGRACION);
    expect((await lab.respaldo()).length).toBe(2);
  });

  it("rollback con cotejos mezclados: recrea EXACTAMENTE las guardas originales y elimina el respaldo", async () => {
    const lab = await armar(cfg, { respaldo: true });
    const antes = await lab.guardas();
    await lab.script(MIGRACION);
    await lab.script(ROLLBACK);
    expect(await lab.guardas()).toEqual(antes);
    expect(await lab.tabla()).toBe(false);
    await expect(lab.insertarPlanConPerfil3()).rejects.toThrow(/fusionado/i);
  });

  it("ejecución parcial A: ffi respaldada y retirada, ffu intacta -> el diagnóstico dice PARCIAL SEGURO y la migración completa sin perder el respaldo", async () => {
    const lab = await armar(cfg, { respaldo: true });
    const antes = await lab.guardas();
    await lab.q("INSERT INTO flota_fusion_guardas_v2_respaldo (tabla,campo,trigger_nombre,momento,evento,accion) SELECT EVENT_OBJECT_TABLE,'vehiculo_solicitado_perfil_id',TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?", [`ffi_${FP}`]);
    await lab.q(`DROP TRIGGER \`ffi_${FP}\``);
    expect(await lab.veredicto()).toMatch(/^PARCIAL SEGURO/);
    await lab.script(MIGRACION);
    expect((await lab.respaldo()).length).toBe(2);
    expect((await lab.respaldo()).find((r) => r.trigger_nombre === `ffi_${FP}`)!.accion).toBe(antes.find((g) => g.TRIGGER_NAME === `ffi_${FP}`)!.ACTION_STATEMENT);
    await lab.script(ROLLBACK);
    expect(await lab.guardas()).toEqual(antes); // ambas guardas recuperadas
  });

  it("ejecución parcial B: respaldo hecho de ambas y ningún DROP -> PARCIAL SEGURO y la migración completa sin duplicar", async () => {
    const lab = await armar(cfg, { respaldo: true });
    for (const n of [`ffi_${FP}`, `ffu_${FP}`]) await lab.q("INSERT INTO flota_fusion_guardas_v2_respaldo (tabla,campo,trigger_nombre,momento,evento,accion) SELECT EVENT_OBJECT_TABLE,'vehiculo_solicitado_perfil_id',TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?", [n]);
    expect(await lab.veredicto()).toMatch(/^PARCIAL SEGURO/);
    await lab.script(MIGRACION);
    expect((await lab.respaldo()).length).toBe(2);
    expect((await lab.guardas()).some((g) => String(g.TRIGGER_NAME).endsWith(FP))).toBe(false);
  });

  it("respaldo DISTINTO del trigger vigente: el diagnóstico dice PELIGRO y la migración aborta SIN retirar el trigger ni sobrescribir el respaldo", async () => {
    const lab = await armar(cfg, { respaldo: true });
    const antes = await lab.guardas();
    await lab.q("INSERT INTO flota_fusion_guardas_v2_respaldo (tabla,campo,trigger_nombre,momento,evento,accion) VALUES ('tms_planes_viaje','vehiculo_solicitado_perfil_id',?, 'BEFORE','INSERT','BEGIN SET @distinto = 1; END')", [`ffi_${FP}`]);
    expect(await lab.veredicto()).toMatch(/^PELIGRO: el respaldo es DISTINTO/);
    await expect(lab.script(MIGRACION)).rejects.toThrow(/Respaldo de guarda ausente o distinto/);
    expect(await lab.guardas()).toEqual(antes);
    expect((await lab.respaldo())[0].accion).toBe("BEGIN SET @distinto = 1; END");
  });

  it("guarda AUSENTE SIN respaldo: el diagnóstico dice PELIGRO (no reanudar) y nunca se retira un trigger sin respaldo validado", async () => {
    const lab = await armar(cfg, { respaldo: true });
    await lab.q(`DROP TRIGGER \`ffi_${FP}\``);
    expect(await lab.veredicto()).toMatch(/^PELIGRO: hay una guarda AUSENTE SIN respaldo/);
  });
});

describe.skipIf(!PUERTO)("migración v2 en instalación nueva y diagnóstico sin rastro", () => {
  it("sin tabla de respaldo previa (base unicode_ci): la migración la crea en utf8mb4_bin, completa y el diagnóstico (A) funciona antes y después", async () => {
    const cfg = CONFIGS[0];
    const lab = await armar(cfg, { respaldo: false });
    const [antes] = await lab.sentencias(DIAGNOSTICO).catch(async () => [await (async () => (await lab.c.query(sinComentarios(DIAGNOSTICO).split(";")[0]))[0] as Record<string, unknown>[])()]);
    expect(antes.find((f) => f.orden === 1)?.valor).toBe("0"); // sin rastro de v2
    await lab.script(MIGRACION);
    expect(String((await lab.q("SELECT TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo'"))[0].c)).toBe("utf8mb4_bin");
    expect((await lab.respaldo()).length).toBe(2);
    expect(await lab.veredicto()).toMatch(/^COMPLETA/);
  });

  it("los scripts de solo lectura no contienen escritura ni DDL (salvo los literales 'INSERT'/'UPDATE' del evento)", () => {
    for (const ruta of [DIAGNOSTICO, PREFLIGHT, POSTCHECK]) {
      const sql = sinComentarios(ruta).replace(/'[^']*'/g, "''");
      expect(sql, ruta).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL|REPLACE|PREPARE|EXECUTE|RENAME|LOCK|USE|SET|LOAD|INTO)\b/i);
    }
  });
});
