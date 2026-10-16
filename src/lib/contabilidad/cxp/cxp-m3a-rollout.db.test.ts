/** Rollout SQL de CxP M-3A contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407). Una BD nueva por caso; nunca usa DB_* ni credenciales de la app. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const sql = (archivo: string) => readFileSync(`sql/${archivo}-2026-11-cxp-m3a-base.sql`, "utf8");

function sentencias(texto: string) {
  let delimiter = ";", buffer = "";
  const out: string[] = [];
  for (const line of texto.split(/\r?\n/)) {
    const d = line.trim().match(/^DELIMITER (.+)$/);
    if (d) { delimiter = d[1]; continue; }
    buffer += `${line}\n`;
    if (line.trimEnd().endsWith(delimiter)) {
      const stmt = buffer.slice(0, buffer.lastIndexOf(delimiter)).trim();
      if (stmt.replace(/--[^\n]*/g, "").trim()) out.push(stmt);
      buffer = "";
    }
  }
  if (buffer.replace(/--[^\n]*/g, "").trim()) throw new Error("SQL final sin delimitador");
  return out;
}

describe.skipIf(!port)("CxP M-3A rollout SQL / MariaDB 11.8.9 SOLO LOCAL", { timeout: 60_000 }, () => {
  let admin: Connection;
  let db: Connection;
  const creadas: string[] = [];
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true, dateStrings: true });
    expect(String((await admin.query<RowDataPacket[]>("SELECT VERSION() v"))[0][0].v)).toContain("11.8.9");
  });
  afterAll(async () => {
    if (db) await db.end();
    for (const n of creadas) if (/^cxp_roll_[a-f0-9]{32}$/.test(n)) await admin.query(`DROP DATABASE IF EXISTS ${n}`);
    await admin?.end();
  });

  async function script(texto: string) { for (const s of sentencias(texto)) await db.query(s); }
  async function correr(archivo: string) {
    let ultimo: RowDataPacket[] = [];
    for (const s of sentencias(sql(archivo))) { const [r] = await db.query(s); if (Array.isArray(r) && r.length && !("affectedRows" in (r as object))) ultimo = r as RowDataPacket[]; }
    return ultimo;
  }
  async function estado() { await correr("preflight"); return String((await db.query<RowDataPacket[]>("SELECT @cxp_estado e"))[0][0].e); }
  async function fixture() {
    const nombre = `cxp_roll_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${nombre} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    creadas.push(nombre);
    if (db) await db.end();
    db = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", database: nombre, multipleStatements: true, dateStrings: true });
    await db.query(`CREATE TABLE usuarios(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO usuarios VALUES(8);
      CREATE TABLE compras_proveedores(id INT PRIMARY KEY,empresa_id INT NOT NULL,UNIQUE KEY uq_p(empresa_id,id)) ENGINE=InnoDB; INSERT INTO compras_proveedores VALUES(3,1);
      CREATE TABLE cont_entidades(id INT PRIMARY KEY,empresa_id INT NOT NULL,UNIQUE KEY uq_e(empresa_id,id)) ENGINE=InnoDB; INSERT INTO cont_entidades VALUES(5,1);
      CREATE TABLE cont_cuentas(id INT PRIMARY KEY,empresa_id INT NOT NULL,entidad_id INT NULL,tipo VARCHAR(40) NOT NULL,UNIQUE KEY uq_c(empresa_id,entidad_id,id)) ENGINE=InnoDB;
      INSERT INTO cont_cuentas VALUES(10,1,5,'Pasivo'),(11,1,5,'Activo'),(12,1,5,'Gasto');
      CREATE TABLE cont_cxp(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT NOT NULL,proveedor VARCHAR(200) NOT NULL,monto DECIMAL(14,2) NOT NULL,saldo DECIMAL(14,2) NOT NULL) ENGINE=InnoDB;
      INSERT INTO cont_cxp(empresa_id,proveedor,monto,saldo) VALUES(1,'LEGACY',100.00,100.00);`);
  }
  async function snapshot() {
    const out: unknown[] = [];
    for (const t of ["cont_cxp", "compras_proveedores", "cont_entidades", "cont_cuentas", "usuarios"]) out.push((await db.query(`SELECT * FROM ${t} ORDER BY id`))[0]);
    return out;
  }
  const migrarFalla = async (patron: RegExp) => { const antes = await snapshot(); await expect(script(sql("migrate"))).rejects.toThrow(patron); expect(await snapshot()).toEqual(antes); };
  const tablasCxp = async () => Number((await db.query<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'cxp%'"))[0][0].n);

  it("CLEAN → migrate → FINAL; tablas existentes y cont_cxp intactos; postcheck OK", async () => {
    await fixture(); expect(await estado()).toBe("CLEAN");
    const antes = await snapshot();
    const r = (await correr("migrate"))[0];
    expect(r).toMatchObject({ estado_inicial: "CLEAN", estado_final: "FINAL", resultado: "APLICADO", objetos_presentes: "75", objetos_correctos: "75" });
    expect(await estado()).toBe("FINAL");
    expect(await snapshot()).toEqual(antes);
    expect((await correr("postcheck"))[0]).toMatchObject({ estado_cxp_rollout: "FINAL", filas_cont_cxp_legacy: 1 });
  });

  it("FINAL → migrate → NOOP", async () => {
    await fixture(); await script(sql("migrate"));
    const antes = await snapshot();
    expect((await correr("migrate"))[0]).toMatchObject({ estado_inicial: "FINAL", estado_final: "FINAL", resultado: "NOOP" });
    expect(await snapshot()).toEqual(antes);
  });

  it("una sola tabla preexistente → DIVERGENTE y DETENER antes de cualquier DDL", async () => {
    await fixture(); await db.query("CREATE TABLE cxp_facturas (id INT PRIMARY KEY) ENGINE=InnoDB");
    expect(await estado()).toBe("DIVERGENTE");
    await migrarFalla(/DIVERGENTE/);
    expect(await tablasCxp()).toBe(1);
  });

  it.each([
    ["columna de tipo distinto", "ALTER TABLE cxp_facturas MODIFY numero VARCHAR(61) NOT NULL"],
    ["columna con nulabilidad distinta", "ALTER TABLE cxp_facturas MODIFY fecha_documento DATE NULL"],
    ["default distinto", "ALTER TABLE cxp_facturas ALTER COLUMN iva_monto SET DEFAULT 1.00"],
    ["collation distinta", "ALTER TABLE cxp_facturas MODIFY numero VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL"],
    ["columna generada distinta", "ALTER TABLE cxp_facturas DROP INDEX uq_cxpf_documento, MODIFY clave_activa TINYINT(1) GENERATED ALWAYS AS (IF(estado_admin = 'ANULADA', 1, NULL)) PERSISTENT, ADD UNIQUE KEY uq_cxpf_documento (empresa_id, proveedor_id, serie_norm, numero_norm, clave_activa)"],
    ["índice UNIQUE con columnas erróneas", "ALTER TABLE cxp_facturas DROP INDEX uq_cxpf_documento, ADD UNIQUE KEY uq_cxpf_documento (empresa_id, serie_norm, numero_norm, clave_activa)"],
    ["índice UNIQUE degradado a no único", "ALTER TABLE cxp_facturas DROP INDEX uq_cxpf_ambito, ADD KEY uq_cxpf_ambito (empresa_id, entidad_id, id)"],
    ["CHECK con cláusula distinta", "ALTER TABLE cxp_facturas DROP CONSTRAINT ck_cxpf_total, ADD CONSTRAINT ck_cxpf_total CHECK (total_documento >= base_neto + iva_monto)"],
    ["CHECK ausente", "ALTER TABLE cxp_proveedor_fiscal DROP CONSTRAINT ck_cxppf_pequeno"],
    ["FK con referencia incorrecta", "ALTER TABLE cxp_facturas DROP FOREIGN KEY fk_cxpf_anulador"],
  ])("%s → DIVERGENTE y migrate se detiene", async (_caso, ddl) => {
    await fixture(); await script(sql("migrate"));
    if (_caso === "FK con referencia incorrecta") {
      await db.query(ddl);
      await db.query("ALTER TABLE cxp_facturas ADD CONSTRAINT fk_cxpf_anulador FOREIGN KEY (anulado_por) REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE RESTRICT");
    } else await db.query(ddl);
    expect(await estado()).toBe("DIVERGENTE");
    await migrarFalla(/DIVERGENTE/);
    await expect(script(sql("postcheck"))).rejects.toThrow(/FINAL/);
  });

  it("tabla con collation o motor distinto → DIVERGENTE", async () => {
    await fixture(); await script(sql("migrate"));
    await db.query("ALTER TABLE cxp_proveedor_fiscal CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    expect(await estado()).toBe("DIVERGENTE");
  });

  it("prerrequisito ausente (padre sin UNIQUE de ámbito) → DIVERGENTE", async () => {
    await fixture(); await db.query("ALTER TABLE cont_cuentas DROP INDEX uq_c");
    expect(await estado()).toBe("DIVERGENTE");
    await migrarFalla(/DIVERGENTE/);
    expect(await tablasCxp()).toBe(0);
  });

  describe("postcheck: integridad lógica falla con SIGNAL y siempre muestra conteos", () => {
    const config = (extra = "") => db.query(`INSERT INTO cxp_proveedor_fiscal(empresa_id,entidad_id,proveedor_id,regimen_fiscal,sujeto_isr,cuenta_proveedor_id,cuenta_anticipo_id,cuenta_gasto_id,creado_por,actualizado_por) VALUES(1,5,3,'GENERAL',1,10,11,12,8,8)${extra}`);
    const factura = (base: string, pct: string, isr: string, sujeto = 1) => db.query(
      `INSERT INTO cxp_facturas(empresa_id,entidad_id,proveedor_id,tipo_documento,serie,numero,serie_norm,numero_norm,fecha_documento,base_neto,iva_monto,total_documento,isr_porcentaje,isr_monto,total_neto_pagar,regla_isr,regimen_fiscal_snapshot,sujeto_isr_snapshot,creado_por)
       VALUES(1,5,3,'FACTURA','A','1','A','1','2026-11-02',?,0,?,?,?,?, 'M3A_V1:TEST','GENERAL',?,8)`, [base, base, pct, isr, (Number(base) - Number(isr)).toFixed(2), sujeto]);
    it("estado sano pasa y muestra los conteos", async () => {
      await fixture(); await script(sql("migrate")); await config(); await factura("10000.00", "5.00", "500.00");
      const r = (await correr("postcheck"))[0];
      expect(r).toMatchObject({ configuraciones_fiscales: 1, facturas_cxp: 1, cuentas_proveedor_no_pasivo: 0, isr_no_coincide_con_porcentaje: 0 });
    });
    it("cuenta de proveedor que no es Pasivo", async () => {
      await fixture(); await script(sql("migrate"));
      await db.query("INSERT INTO cxp_proveedor_fiscal(empresa_id,entidad_id,proveedor_id,regimen_fiscal,sujeto_isr,cuenta_proveedor_id,creado_por,actualizado_por) VALUES(1,5,3,'GENERAL',1,11,8,8)");
      await expect(script(sql("postcheck"))).rejects.toThrow(/integridad/);
    });
    it("cuenta de anticipo que no es Activo / de gasto que no es Gasto", async () => {
      await fixture(); await script(sql("migrate"));
      await db.query("INSERT INTO cxp_proveedor_fiscal(empresa_id,entidad_id,proveedor_id,regimen_fiscal,sujeto_isr,cuenta_anticipo_id,cuenta_gasto_id,creado_por,actualizado_por) VALUES(1,5,3,'GENERAL',1,10,10,8,8)");
      await expect(script(sql("postcheck"))).rejects.toThrow(/integridad/);
    });
    it("ISR que no coincide con base × porcentaje", async () => {
      await fixture(); await script(sql("migrate")); await config(); await factura("10000.00", "5.00", "400.00");
      await expect(script(sql("postcheck"))).rejects.toThrow(/integridad/);
    });
    it("ISR con porcentaje 0", async () => {
      await fixture(); await script(sql("migrate")); await config(); await factura("10000.00", "0.00", "100.00");
      await expect(script(sql("postcheck"))).rejects.toThrow(/integridad/);
    });
    it("la BD impide ISR en un snapshot no sujeto y totales incoherentes", async () => {
      await fixture(); await script(sql("migrate")); await config();
      await expect(factura("10000.00", "5.00", "500.00", 0)).rejects.toMatchObject({ errno: 4025 });
      await expect(db.query(`INSERT INTO cxp_facturas(empresa_id,entidad_id,proveedor_id,tipo_documento,numero,numero_norm,fecha_documento,base_neto,iva_monto,total_documento,isr_monto,total_neto_pagar,regla_isr,regimen_fiscal_snapshot,sujeto_isr_snapshot,creado_por)
        VALUES(1,5,3,'FACTURA','2','2','2026-11-02',100,12,999,0,999,'x','GENERAL',1,8)`)).rejects.toMatchObject({ errno: 4025 });
    });
  });

  it("anti-duplicado: UNIQUE entre registradas; una ANULADA libera la clave", async () => {
    await fixture(); await script(sql("migrate"));
    await db.query("INSERT INTO cxp_proveedor_fiscal(empresa_id,entidad_id,proveedor_id,regimen_fiscal,sujeto_isr,creado_por,actualizado_por) VALUES(1,5,3,'GENERAL',0,8,8)");
    const ins = (estado = "REGISTRADA") => db.query(
      `INSERT INTO cxp_facturas(empresa_id,entidad_id,proveedor_id,tipo_documento,serie,numero,serie_norm,numero_norm,fecha_documento,base_neto,iva_monto,total_documento,isr_monto,total_neto_pagar,regla_isr,regimen_fiscal_snapshot,sujeto_isr_snapshot,estado_admin,anulado_por,anulado_en,motivo_anulacion,creado_por)
       VALUES(1,5,3,'FACTURA','A','10','A','10','2026-11-02',100,12,112,0,112,'x','GENERAL',0,?,?,?,?,8)`,
      estado === "ANULADA" ? [estado, 8, "2026-11-03 10:00:00", "error de captura"] : [estado, null, null, null]);
    await ins();
    await expect(ins()).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    await db.query("UPDATE cxp_facturas SET estado_admin='ANULADA', anulado_por=8, anulado_en='2026-11-03 10:00:00', motivo_anulacion='error' WHERE numero='10'");
    await ins(); // la clave quedó libre
    await ins("ANULADA"); // varias anuladas con la misma clave no chocan
  });
});
