import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import mysql, { type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// Opt-in SOLO local. Nunca lee .env ni las credenciales de la aplicación.
vi.mock("@/lib/db", () => ({ getPool: () => { throw new Error("Prohibido usar DB de aplicación en esta suite"); }, execute: vi.fn(), query: vi.fn() }));
import { registrarAsientoTx } from "./asientos";
import { registrarEventoContableTx } from "./eventos";
import { resolverCuentaPorRol } from "./cuentas-rol";
import { ROLES_CONTABLES } from "./cuentas-rol";
const port = Number(process.env.CONTA_A_TEST_PORT ?? 0);
const db = "conta_a_test_" + randomUUID().replaceAll("-", "");
const admin = () => mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
let pool: mysql.Pool;
const a = { entidadId: 9, usuarioId: 4, admin: false };
const asiento = (numero: string) => ({ numero, fecha: "2026-10-13", lineas: [{ cuentaId: 1, debe: 10 }, { cuentaId: 2, haber: 10 }] });
const snapshot = { version: 1, versionCalculo: "INFRA_A", origen: { tipo: "FACTURA", id: 5 }, cuentas: [], importes: [], impuestos: [] };
const sql = (name: string) => readFileSync("sql/" + name, "utf8").replaceAll("\r\n", "\n");
// DELIMITER es instrucción del cliente mysql/phpMyAdmin, no del servidor mysql2.
const ejecutable = (name: string) => sql(name).replace(/^DELIMITER.*$/gm, "").replaceAll("END//", "END;");
async function preflight(c: mysql.Connection | PoolConnection, sinTablaCheck = false) {
  const [tablas] = await c.query<RowDataPacket[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('cont_cuentas_rol','cont_eventos')");
  const mode = !tablas.some(t => t.TABLE_NAME==="cont_cuentas_rol") ? "NUEVO" : tablas.some(t => t.TABLE_NAME==="cont_eventos") ? "ACTUAL" : "HISTORICO";
  const archivo = sql("preflight-2026-10-contabilidad-infraestructura-a.sql");
  const fragmento = archivo.split("INICIO_GATE_"+mode)[1].split("FIN_GATE_"+mode)[0].replace(/--[^\n]*/g, "").trim();
  const consulta = sinTablaCheck ? fragmento.replaceAll("information_schema.CHECK_CONSTRAINTS","hostinger_checks") : fragmento;
  const resultadoGate = await c.query<RowDataPacket[]>(consulta);
  expect(resultadoGate[0]).toHaveLength(1);
  return resultadoGate;
}
const tabla = (name: string) => {
  const contenido = sql("schema.sql");
  const inicio = contenido.indexOf("CREATE TABLE IF NOT EXISTS " + name + " (");
  if (inicio < 0) throw new Error("Tabla fixture no encontrada: " + name);
  return contenido.slice(inicio, contenido.indexOf(";", inicio) + 1);
};
async function tx<T>(fn: (c: PoolConnection) => Promise<T>) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const result = await fn(c); await c.commit(); return result; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
describe.skipIf(!port)("PR A / MariaDB desechable local", () => {
  beforeAll(async () => {
    if (port !== 3407) throw new Error("Solo instancia desechable explícita en puerto 3407.");
    const c = await admin();
    try {
      await c.query("CREATE DATABASE " + db + " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
      await c.query("USE " + db);
      await c.query("CREATE TABLE empresas (id INT PRIMARY KEY) ENGINE=InnoDB; CREATE TABLE usuarios (id INT PRIMARY KEY) ENGINE=InnoDB");
      for (const name of ["cont_entidades", "cont_cuentas", "cont_asientos", "cont_asiento_detalle", "cont_cxc", "cont_cxp"]) await c.query(tabla(name));
      await c.query("CREATE TABLE fact_facturas (id INT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NULL) ENGINE=InnoDB; CREATE TABLE auditoria (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB");
      await c.query("INSERT INTO empresas VALUES (7),(8); INSERT INTO usuarios VALUES (4); INSERT INTO cont_entidades (id,empresa_id,codigo,nombre,activa) VALUES (9,7,'A','A',1),(10,8,'B','B',1); INSERT INTO fact_facturas VALUES (5,7,9),(6,7,9),(7,8,10)");
      await c.query("INSERT INTO cont_cuentas (id,empresa_id,entidad_id,codigo,nombre,tipo,nivel,activa) VALUES (1,7,9,'D','D','Activo',1,1),(2,7,9,'H','H','Ingreso',1,1),(3,8,10,'D','D','Activo',1,1),(4,8,10,'H','H','Ingreso',1,1)");
      await preflight(c);
      await c.query(ejecutable("migrate-2026-10-contabilidad-infraestructura-a.sql"));
      await c.query(ejecutable("migrate-2026-10-contabilidad-infraestructura-a.sql"));
      await c.query(ejecutable("verify-2026-10-contabilidad-infraestructura-a.sql"));
      const [rows] = await c.query<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM cont_eventos) AS eventos,(SELECT COUNT(*) FROM cont_cuentas_rol) AS roles");
      expect(rows[0]).toMatchObject({ eventos: 0, roles: 0 });
    } finally { await c.end(); }
    pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database: db, connectionLimit: 4 });
  });
  afterAll(async () => { if (pool) await pool.end(); }); // Sin DROP. Datadir temporal queda recuperable.
  it("migrate repetible y schema tienen el mismo DDL", () => {
    const migration = sql("migrate-2026-10-contabilidad-infraestructura-a.sql");
    expect(migration).toContain(tabla("cont_cuentas_rol"));
    expect(migration).toContain(tabla("cont_eventos"));
  });
  it("instalación nueva permite los ocho roles sin seeds del migrador", async () => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      for (const rol of ROLES_CONTABLES) await c.query("INSERT INTO cont_cuentas_rol (empresa_id,entidad_id,cuenta_id,rol) VALUES (8,10,3,?)", [rol]);
      const [r] = await c.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM cont_cuentas_rol WHERE empresa_id=8");
      expect(Number(r[0].n)).toBe(8);
    } finally { await c.rollback(); c.release(); }
    const [r] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM cont_cuentas_rol WHERE empresa_id=8");
    expect(Number(r[0].n)).toBe(0);
  });
  it("CHECKs/FKs rechazan rol desconocido, cuenta ajena y cobro sin confirmación", async () => {
    await expect(pool.query("INSERT INTO cont_cuentas_rol (empresa_id,entidad_id,cuenta_id,rol) VALUES (7,9,1,'INVENTADO')")).rejects.toThrow();
    await expect(pool.query("INSERT INTO cont_cuentas_rol (empresa_id,entidad_id,cuenta_id,rol) VALUES (7,9,3,'CLIENTES')")).rejects.toThrow();
    await pool.query("INSERT INTO cont_cuentas_rol (empresa_id,entidad_id,cuenta_id,rol) VALUES (7,9,1,'CLIENTES')");
    await tx(async c => expect(await resolverCuentaPorRol({ empresaId: 7, entidadId: 9, rol: "CLIENTES" }, c)).toMatchObject({ id: 1 }));
    await expect(tx(async c => {
      const id = await registrarAsientoTx(c, 7, "actor", asiento("COBRO_PROHIBIDO"), a);
      await c.query("INSERT INTO cont_eventos (empresa_id,entidad_id,factura_id,tipo_evento,asiento_id,clave_evento,huella,fecha_contable,datos_snapshot,creado_por) VALUES (7,9,5,'COBRO_CONFIRMADO',?,'COBRO:1',?,'2026-10-13',?,4)", [id, "a".repeat(64), JSON.stringify(snapshot)]);
    })).rejects.toThrow();
  });
  it("rollback externo deshace asiento, detalle y auditoría", async () => {
    await expect(tx(async c => { await registrarAsientoTx(c, 7, "actor", asiento("ROLLBACK"), a); throw new Error("rollback solicitado"); })).rejects.toThrow("rollback solicitado");
    const [r] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM cont_asientos WHERE numero='ROLLBACK'");
    expect(Number(r[0].n)).toBe(0);
    const [au] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM auditoria");
    expect(Number(au[0].n)).toBe(0);
  });
  it("dos intentos concurrentes iguales crean un solo asiento/evento", async () => {
    const fn = () => tx(c => registrarEventoContableTx(c, 7, "actor", a, { facturaId: 5, tipo: "FACTURA_EMITIDA", snapshot, asiento: asiento("EVENTO5") }));
    const results = await Promise.all([fn(), fn()]);
    expect(results[0].asientoId).toBe(results[1].asientoId);
    expect(results.filter(r => r.reutilizado)).toHaveLength(1);
    await expect(tx(c => registrarEventoContableTx(c, 7, "actor", a, { facturaId: 5, tipo: "FACTURA_EMITIDA", snapshot: { ...snapshot, versionCalculo: "OTRA" }, asiento: asiento("EVENTO5") }))).rejects.toMatchObject({ status: 409 });
  });
  it("otra clave y otra empresa mantienen eventos independientes", async () => {
    const segundo = await tx(c => registrarEventoContableTx(c, 7, "actor", a, { facturaId: 6, tipo: "FACTURA_EMITIDA", snapshot, asiento: asiento("EVENTO6") }));
    const otro = await tx(c => registrarEventoContableTx(c, 8, "actor", { ...a, entidadId: 10 }, { facturaId: 7, tipo: "FACTURA_EMITIDA", snapshot, asiento: { ...asiento("EVENTO7"), lineas: [{ cuentaId: 3, debe: 10 }, { cuentaId: 4, haber: 10 }] } }));
    expect(segundo.eventoId).not.toBe(otro.eventoId);
    await expect(tx(c => registrarEventoContableTx(c, 8, "actor", { ...a, entidadId: 10 }, { facturaId: 5, tipo: "FACTURA_EMITIDA", snapshot, asiento: asiento("AJENO") }))).rejects.toThrow("Factura fuera");
  });
  it("BD impide reutilizar asiento y FK de asiento de otra empresa", async () => {
    const [r] = await pool.query<RowDataPacket[]>("SELECT asiento_id,datos_snapshot,huella FROM cont_eventos WHERE empresa_id=7 ORDER BY id LIMIT 1");
    const valores = [r[0].asiento_id, r[0].huella, typeof r[0].datos_snapshot === "string" ? r[0].datos_snapshot : JSON.stringify(r[0].datos_snapshot)];
    await expect(pool.query("INSERT INTO cont_eventos (empresa_id,entidad_id,factura_id,tipo_evento,asiento_id,clave_evento,huella,fecha_contable,datos_snapshot,creado_por) VALUES (7,9,5,'FACTURA_EMITIDA',?,'OTRA_CLAVE',?,'2026-10-13',?,4)", valores)).rejects.toThrow();
    await expect(pool.query("INSERT INTO cont_eventos (empresa_id,entidad_id,factura_id,tipo_evento,asiento_id,clave_evento,huella,fecha_contable,datos_snapshot,creado_por) VALUES (8,10,7,'FACTURA_EMITIDA',?,'ASIENTO_AJENO',?,'2026-10-13',?,4)", valores)).rejects.toThrow();
  });
  async function instanciaHistorica() {
    const c = await admin();
    const nombre = "conta_a_test_" + randomUUID().replaceAll("-", "");
    await c.query("CREATE DATABASE " + nombre + " CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci");
    await c.query("USE " + nombre);
    await c.query("CREATE TABLE empresas (id INT PRIMARY KEY) ENGINE=InnoDB; CREATE TABLE usuarios (id INT PRIMARY KEY) ENGINE=InnoDB");
    for (const name of ["cont_entidades", "cont_cuentas", "cont_asientos", "cont_asiento_detalle", "cont_cxc", "cont_cxp"]) await c.query(tabla(name));
    await c.query("CREATE TABLE fact_facturas (id INT PRIMARY KEY,empresa_id INT NOT NULL,entidad_id INT NULL) ENGINE=InnoDB");
    await c.query("INSERT INTO empresas VALUES (7); INSERT INTO usuarios VALUES (4); INSERT INTO cont_entidades (id,empresa_id,codigo,nombre,activa) VALUES (1,7,'A','A',1),(2,7,'B','B',1)");
    const historicos = ["CLIENTES","IVA_POR_PAGAR","VENTAS_SERVICIOS","RETENCION_IVA","TRANSITO_BANCARIO","ANTICIPOS","DEVOLUCIONES_VENTAS"];
    const nuevo = tabla("cont_cuentas_rol");
    await c.query(nuevo.replace(",'VENTAS_BIENES'", ""));
    const [checks] = await c.query<RowDataPacket[]>("SELECT CHECK_CLAUSE,LENGTH(CHECK_CLAUSE) AS longitud FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='ck_cont_rol_valido'");
    expect(checks[0]).toMatchObject({ CHECK_CLAUSE: "`rol` in ('CLIENTES','IVA_POR_PAGAR','VENTAS_SERVICIOS','RETENCION_IVA','TRANSITO_BANCARIO','ANTICIPOS','DEVOLUCIONES_VENTAS')", longitud: 126 });
    for (const entidad of [1,2]) for (const [i,rol] of historicos.entries()) {
      const id = (entidad-1)*7+i+1;
      await c.query("INSERT INTO cont_cuentas (id,empresa_id,entidad_id,codigo,nombre,tipo,nivel,activa) VALUES (?,7,?,?,'Fixture','Activo',1,1)", [id, entidad, "F"+id]);
      await c.query("INSERT INTO cont_cuentas_rol (id,empresa_id,entidad_id,rol,cuenta_id,activa,creado_en,actualizado_en) VALUES (?,7,?,?,?,1,'2026-10-12 08:00:00','2026-10-12 09:00:00')", [id, entidad, rol, id]);
    }
    return c;
  }
  function resultado(res: unknown, clave: string): unknown {
    const arrays = res as unknown[][];
    return arrays.flat().find(r => r && typeof r==="object" && clave in r) as Record<string, unknown> | undefined;
  }
  it("upgrade exacto de producción preserva las 14 filas, FK/índices/collation y repite NOOP", async () => {
    const c = await instanciaHistorica();
    try {
      const [antes] = await c.query<RowDataPacket[]>("SELECT * FROM cont_cuentas_rol ORDER BY id");
      const [indicesAntes] = await c.query("SHOW INDEX FROM cont_cuentas_rol");
      const [fkAntes] = await c.query("SELECT CONSTRAINT_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol' ORDER BY CONSTRAINT_NAME");
      const [pre] = await preflight(c);
      expect(resultado(pre,"resultado_preflight")).toMatchObject({ resultado_preflight: "APTO_COMPATIBILIDAD", variante_roles: "HISTORICO" });
      const [m] = await c.query(ejecutable("migrate-2026-10-contabilidad-infraestructura-a.sql"));
      expect(resultado(m,"resultado_migracion")).toMatchObject({ resultado_migracion: "APTO_COMPATIBILIDAD" });
      const [despues] = await c.query<RowDataPacket[]>("SELECT * FROM cont_cuentas_rol ORDER BY id");
      expect(despues).toEqual(antes); expect(despues).toHaveLength(14);
      const [indicesDespues] = await c.query<RowDataPacket[]>("SHOW INDEX FROM cont_cuentas_rol");
      // Cardinality puede cambiar por estadísticas, no forma parte de la definición del índice.
      const sinEstadistica = (r: unknown) => (r as RowDataPacket[]).map(({ Cardinality: _valor, ...resto }) => { void _valor; return resto; });
      expect(sinEstadistica(indicesDespues)).toEqual(sinEstadistica(indicesAntes));
      const [fkDespues] = await c.query("SELECT CONSTRAINT_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol' ORDER BY CONSTRAINT_NAME");
      expect(fkDespues).toEqual(fkAntes);
      const [checks] = await c.query<RowDataPacket[]>("SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='ck_cont_rol_valido'");
      expect(String(checks[0].CHECK_CLAUSE)).toContain("'VENTAS_BIENES'");
      const [conteos] = await c.query<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM cont_cuentas_rol WHERE rol='VENTAS_BIENES') AS bienes,(SELECT COUNT(*) FROM cont_eventos) AS eventos");
      expect(conteos[0]).toMatchObject({ bienes: 0, eventos: 0 });
      const [repetida] = await c.query(ejecutable("migrate-2026-10-contabilidad-infraestructura-a.sql"));
      expect(resultado(repetida,"resultado_migracion")).toMatchObject({ resultado_migracion: "NOOP" });
      const [final] = await c.query("SELECT * FROM cont_cuentas_rol ORDER BY id"); expect(final).toEqual(antes);
      const [coll] = await c.query<RowDataPacket[]>("SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol'");
      expect(coll[0].TABLE_COLLATION).toBe("utf8mb4_uca1400_ai_ci");
      await c.query(ejecutable("verify-2026-10-contabilidad-infraestructura-a.sql"));
      await c.beginTransaction();
      await c.query("INSERT INTO cont_cuentas_rol (empresa_id,entidad_id,cuenta_id,rol) VALUES (7,1,1,'VENTAS_BIENES')");
      await c.rollback();
      const [sinSeed] = await c.query("SELECT * FROM cont_cuentas_rol ORDER BY id"); expect(sinSeed).toEqual(antes);
    } finally { await c.end(); }
  });
  it.each(["nombre CHECK", "columna", "índice", "FK", "CHECK diferente", "datos inválidos", "colisión"])("drift %s detiene antes de ALTER/crear eventos", async caso => {
    const c = await instanciaHistorica();
    try {
      if (caso==="nombre CHECK") await c.query("ALTER TABLE cont_cuentas_rol DROP CONSTRAINT ck_cont_rol_valido, ADD CONSTRAINT otro CHECK (rol IN ('CLIENTES','IVA_POR_PAGAR','VENTAS_SERVICIOS','RETENCION_IVA','TRANSITO_BANCARIO','ANTICIPOS','DEVOLUCIONES_VENTAS'))");
      if (caso==="columna") await c.query("ALTER TABLE cont_cuentas_rol ADD COLUMN inesperada INT NULL");
      if (caso==="índice") await c.query("ALTER TABLE cont_cuentas_rol ADD INDEX inesperado (cuenta_id)");
      if (caso==="FK") await c.query("ALTER TABLE cont_cuentas_rol DROP FOREIGN KEY fk_cont_rol_cuenta");
      if (caso==="CHECK diferente") await c.query("ALTER TABLE cont_cuentas_rol DROP CONSTRAINT ck_cont_rol_valido, ADD CONSTRAINT ck_cont_rol_valido CHECK (rol IS NOT NULL)");
      if (caso==="datos inválidos") await c.query("UPDATE cont_cuentas_rol SET activa=2 WHERE id=1");
      if (caso==="colisión") await c.query("CREATE TABLE colision (id INT, CONSTRAINT ck_cont_evento_tipo CHECK (id>0)) ENGINE=InnoDB");
      const [antes] = await c.query("SELECT * FROM cont_cuentas_rol ORDER BY id");
      const [pre] = await preflight(c);
      expect(resultado(pre,"resultado_preflight")).toMatchObject({ resultado_preflight: "DETENER" });
      await expect(c.query(ejecutable("migrate-2026-10-contabilidad-infraestructura-a.sql"))).rejects.toThrow("DETENER");
      const [despues] = await c.query("SELECT * FROM cont_cuentas_rol ORDER BY id"); expect(despues).toEqual(antes);
      const [tables] = await c.query<RowDataPacket[]>("SHOW TABLES LIKE 'cont_eventos'"); expect(tables).toHaveLength(0);
    } finally { await c.end(); }
  });
  it("Hostinger: CHECK metadata sin TABLE_NAME permite upgrade y NOOP mediante TABLE_CONSTRAINTS", async () => {
    const c = await instanciaHistorica();
    try {
      // Vista sintética omite completamente TABLE_NAME. No modifica information_schema.
      await c.query("CREATE VIEW hostinger_checks AS SELECT CONSTRAINT_SCHEMA,CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS");
      const [columnas] = await c.query<RowDataPacket[]>("SHOW COLUMNS FROM hostinger_checks");
      expect(columnas.map(r => r.Field)).not.toContain("TABLE_NAME");
      await expect(c.query("SELECT * FROM hostinger_checks WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol'")).rejects.toThrow("Unknown column");
      const [checks] = await c.query<RowDataPacket[]>("SELECT * FROM hostinger_checks WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='ck_cont_rol_valido'");
      expect(checks).toHaveLength(1);
      const sinTablaCheck = (nombre: string) => ejecutable(nombre).replaceAll("information_schema.CHECK_CONSTRAINTS", "hostinger_checks");
      const [antes] = await c.query("SELECT * FROM cont_cuentas_rol ORDER BY id");
      const [pre] = await preflight(c, true);
      expect(resultado(pre,"resultado_preflight")).toMatchObject({ resultado_preflight: "APTO_COMPATIBILIDAD" });
      await c.query(sinTablaCheck("migrate-2026-10-contabilidad-infraestructura-a.sql"));
      const [noOp] = await c.query(sinTablaCheck("migrate-2026-10-contabilidad-infraestructura-a.sql"));
      expect(resultado(noOp,"resultado_migracion")).toMatchObject({ resultado_migracion: "NOOP" });
      const [post] = await preflight(c, true);
      expect(resultado(post,"resultado_preflight")).toMatchObject({ resultado_preflight: "NOOP" });
      const [despues] = await c.query("SELECT * FROM cont_cuentas_rol ORDER BY id"); expect(despues).toEqual(antes);
      await c.query(sinTablaCheck("verify-2026-10-contabilidad-infraestructura-a.sql"));
    } finally { await c.end(); }
  });
  it.skipIf(!process.env.CONTA_A_TEST_PHP)("mysqli ejecuta migrate sin resultados internos pendientes y siguiente query funciona", async () => {
    const c = await instanciaHistorica();
    try {
      const [base] = await c.query<RowDataPacket[]>("SELECT DATABASE() AS nombre");
      const php = `
        mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
        if (!preg_match('/^conta_a_test_[a-f0-9]+$/', $argv[2])) { throw new Exception("BD no desechable"); }
        $db = new mysqli("127.0.0.1", "root", "", $argv[2], 3407);
        $script = file_get_contents($argv[1]);
        $partes = explode("END//", $script, 2);
        $compound = preg_replace('/^DELIMITER.*$/m', '', $partes[0]) . "END";
        $db->query($compound);
        if ($db->more_results()) { throw new Exception("Resultados internos pendientes"); }
        $probe = $db->query("SELECT 1 AS siguiente"); $probe->free();
        $resto = preg_replace('/^DELIMITER.*$/m', '', $partes[1]);
        $resto = preg_replace('/--[^\\n]*/', '', $resto);
        foreach (explode(";", $resto) as $stmt) {
          if (!trim($stmt)) { continue; }
          $r = $db->query($stmt);
          if ($r instanceof mysqli_result) { echo json_encode($r->fetch_assoc()); $r->free(); }
          if ($db->more_results()) { throw new Exception("Resultados externos pendientes"); }
        }
      `;
      const args = ["-r", php, "sql/migrate-2026-10-contabilidad-infraestructura-a.sql", String(base[0].nombre)];
      const salida = execFileSync(process.env.CONTA_A_TEST_PHP!, args, { encoding: "utf8" });
      expect(JSON.parse(salida)).toMatchObject({ resultado_migracion: "APTO_COMPATIBILIDAD" });
      const repetida = execFileSync(process.env.CONTA_A_TEST_PHP!, args, { encoding: "utf8" });
      expect(JSON.parse(repetida)).toMatchObject({ resultado_migracion: "NOOP" });
      const [estado] = await preflight(c); expect(resultado(estado,"resultado_preflight")).toMatchObject({ resultado_preflight: "NOOP" });
    } finally { await c.end(); }
  });
  it.skipIf(!process.env.CONTA_A_TEST_PHP)("mysqli ejecuta preflight histórico y SHOW independientes sin Commands out of sync", async () => {
    const c = await instanciaHistorica();
    try {
      const [base] = await c.query<RowDataPacket[]>("SELECT DATABASE() AS nombre");
      const php = `
        mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
        if (!preg_match('/^conta_a_test_[a-f0-9]+$/', $argv[2])) { throw new Exception("BD no desechable"); }
        $db = new mysqli("127.0.0.1", "root", "", $argv[2], 3407);
        $script = file_get_contents($argv[1]);
        $script = preg_replace('~/\\*[\\s\\S]*?\\*/~', '', $script);
        $script = preg_replace('/--[^\\n]*/', '', $script);
        foreach (explode(";", $script) as $stmt) {
          if (!trim($stmt)) { continue; }
          $r = $db->query($stmt);
          if ($r instanceof mysqli_result) {
            $fila = $r->fetch_assoc();
            if (isset($fila["resultado_preflight"])) { echo json_encode($fila); }
            $r->free();
          }
          if ($db->more_results()) { throw new Exception("Resultados pendientes"); }
        }
        $probe = $db->query("SELECT 1 AS siguiente"); $probe->free();
      `;
      const salida = execFileSync(process.env.CONTA_A_TEST_PHP!, ["-r", php, "sql/preflight-2026-10-contabilidad-infraestructura-a.sql", String(base[0].nombre)], { encoding: "utf8" });
      const gate = JSON.parse(salida);
      expect(gate).toMatchObject({ resultado_preflight: "APTO_COMPATIBILIDAD", variante_roles: "HISTORICO" });
      expect(Number(gate.roles_datos_ok)).toBe(1);
    } finally { await c.end(); }
  });
});
